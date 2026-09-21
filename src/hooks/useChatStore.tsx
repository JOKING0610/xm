// React 对话状态 store
// 内存态 + IndexedDB 异步持久化。.tsx 后缀因为包含 Provider 组件。
//
// 隔离设计：
// - 每个流式会话自带独立的 AbortController，按 id 存于 abortsRef。
// - 切换会话不会中止其它会话的流；stop() 仅作用于当前 activeId 的会话。
// - "空白对话"（messages.length === 0）不写入 IndexedDB，避免空记录占用与重复。
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment, ChatMessage, Conversation, ProviderId, Settings, ThinkingLevel } from '../types';
import { DEFAULT_PROVIDER, getProvider } from '../config/api';
import { streamChatSmart } from '../lib/api';
import { dbAll, dbDelete, dbGet, dbPut } from '../lib/db';
import { uuid } from '../lib/uuid';

/** 会话 store 对外暴露的接口 */
export interface ChatStore {
  conversations: Conversation[];
  activeId: string | null;
  activeConversation: Conversation | null;
  settings: Settings;
  /** 当前活跃会话是否正在流式输出（侧边栏/输入区按 activeId 判定） */
  isStreaming: boolean;
  /** 当前正在流式输出的会话 id 集合（侧边栏用于显示转圈加载） */
  streamingIds: ReadonlySet<string>;
  /** 回复已完成但尚未查看的会话 id 集合（侧边栏绿色圆点提醒） */
  unreadIds: ReadonlySet<string>;
  streamError: string | null;
  newConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setModel: (id: ProviderId) => void;
  /** 设置思考强度并持久化 */
  setThinkingLevel: (level: ThinkingLevel) => void;
  /** 发送消息；opts.search 为 true 时先联网搜索再回复 */
  sendMessage: (text: string, attachments?: Attachment[], opts?: { search?: boolean }) => Promise<void>;
  /** 重试：移除最后一条失败回复，重新发送同一条用户消息 */
  retryConversation: (id: string) => Promise<void>;
  stop: () => void;
  clearStreamError: () => void;
}

const ChatStoreContext = createContext<ChatStore | null>(null);

/** 合法的思考强度取值 */
const THINKING_LEVELS: ReadonlySet<string> = new Set([
  'default',
  'off',
  'low',
  'medium',
  'high',
]);

function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === 'string' && THINKING_LEVELS.has(v);
}

/** 统一的对外错误提示文案（不向用户暴露技术细节） */
export const ERROR_BUSY = '服务繁忙,请稍后重试';
/** 上下文上限：会话累计文本（字符）达到该值后禁止继续发送 */
export const MAX_CONTEXT_CHARS = 1_000_000;
/** 上下文达上限时的提示 */
export const CONTEXT_FULL_MSG = '上下文已达上限（1M 字符），请新建对话后继续';

/** 把第一句话截断成会话标题（≤24 字） */
function deriveTitleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '新对话';
  return flat.length > 24 ? flat.slice(0, 24) + '…' : flat;
}

/** 计算会话累计文本字符数（内容长度总和；不含思维链） */
function contextChars(conv: { messages: Array<{ content: string; attachments?: Attachment[] }> }): number {
  let total = 0;
  for (const m of conv.messages) {
    total += m.content?.length ?? 0;
  }
  return total;
}

export function ChatProvider({ children }: { children: ReactNode }): ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    model: DEFAULT_PROVIDER,
    thinkingLevel: 'default',
  });
  // 正在流式输出的会话 id 集合；切换会话不会中止其它会话的流
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // 回复完成但未查看的会话 id 集合（侧边栏绿点）
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [streamError, setStreamError] = useState<string | null>(null);

  // 竞态防护（React 19 开发模式 effect 双执行）：
  // hydratedRef 标记是否已发起恢复；initRef 标记恢复是否已完成为 true，之后才接受操作。
  const hydratedRef = useRef(false);
  const initRef = useRef(false);
  // 每个流式会话独立的中止控制器，按会话 id 索引
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  // 最新 activeId（供异步回调内判断"当前正在看哪个会话"）
  const activeIdRef = useRef<string | null>(null);

  // activeId 变化时同步到 ref（onDone 绿点判断依赖最新值）
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 挂载时仅执行一次：从 db 恢复会话与设置
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true; // 提前置位，防 StrictMode 二次触发
    (async () => {
      // 恢复出的模型（供自动新建会话使用；setSettings 是异步的，闭包里拿不到新值）
      let recoveredModel: ProviderId = DEFAULT_PROVIDER;
      try {
        const [rawConvs, st] = await Promise.all([
          dbAll<Conversation>('conversations'),
          dbGet<{ key: 'global'; value: Settings }>('settings', 'global'),
        ]);
        // 归一化恢复的数据：防御历史/异常记录（缺字段、无效 id）避免渲染崩溃
        const normalized: Conversation[] = (rawConvs ?? [])
          .filter((c) => c && typeof c.id === 'string' && c.id !== '')
          .map((c) => ({
            id: c.id,
            title: typeof c.title === 'string' && c.title ? c.title : '新对话',
            messages: Array.isArray(c.messages) ? c.messages : [],
            model: c.model === 'yunzhiapi' || c.model === 'agnes-ai' ? c.model : DEFAULT_PROVIDER,
            createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
            updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : Date.now(),
          }));
        setConversations(normalized);
        if (st?.value && (st.value.model === 'yunzhiapi' || st.value.model === 'agnes-ai')) {
          setSettings({
            model: st.value.model,
            thinkingLevel: isThinkingLevel(st.value.thinkingLevel)
              ? st.value.thinkingLevel
              : 'default',
          });
          recoveredModel = st.value.model;
        }
        // 迁移：清理 IndexedDB 里残留的空白会话（修复前留下的脏数据）
        const emptyIds = normalized.filter((c) => c.messages.length === 0).map((c) => c.id);
        for (const id of emptyIds) {
          void dbDelete('conversations', id);
        }
        if (emptyIds.length > 0) {
          setConversations((prev) => prev.filter((c) => c.messages.length > 0));
          // 若被清掉的正好是当前活跃会话，activeId 置空
          setActiveId((prev) => (prev && emptyIds.includes(prev) ? null : prev));
        }
      } finally {
        initRef.current = true;
        // 打开页面：自动创建新会话并切换至该新会话（空白不落盘，刷新后重新创建）
        // 传 recoveredModel：此时 settings 闭包仍是初始值，须显式带上恢复的模型
        newConversation(recoveredModel);
      }
    })();
  }, []);

  /** 把会话 id 加入流式集合（不可变更新） */
  function markStreaming(id: string): void {
    setStreamingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  /** 从流式集合移除会话 id，并清理其 AbortController */
  function unmarkStreaming(id: string): void {
    setStreamingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    abortsRef.current.delete(id);
  }

  /** 智能持久化：空白会话不入库；非空白才 dbPut。
   *  空白但存在于 db 中（历史遗留）则顺手清除，避免脏数据。 */
  function safePersist(conv: Conversation): void {
    if (conv.messages.length === 0) {
      void dbDelete('conversations', conv.id);
    } else {
      void dbPut('conversations', conv);
    }
  }

  /** 在内存中更新并按需持久化单个会话 */
  function patchConversation(conv: Conversation): void {
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? conv : c)),
    );
    safePersist(conv);
  }

  /** 等待初始化完成 */
  async function ensureReady(): Promise<boolean> {
    while (!initRef.current) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    return true;
  }

  /** 创建新会话：仅入内存；空白不入 IndexedDB（直到首条消息发送才落盘） */
  function newConversation(initialModel?: ProviderId): string {
    const now = Date.now();
    const conv: Conversation = {
      id: uuid(),
      title: '新对话',
      messages: [],
      model: initialModel ?? settings.model,
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => [...prev, conv]);
    setActiveId(conv.id);
    setStreamError(null);
    // 空白会话不写库；safePersist 内部已做此判断
    safePersist(conv);
    return conv.id;
  }

  /** 标记某会话"回复已完成但未查看"（侧边栏绿点） */
  function markUnread(id: string): void {
    setUnreadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  /** 清除某会话的未读标记 */
  function clearUnread(id: string): void {
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** 切换当前会话（不中止其它正在流式的会话）；查看后清除该会话的绿点 */
  function selectConversation(id: string): void {
    setActiveId(id);
    setStreamError(null);
    clearUnread(id);
  }

  /** 删除会话：先中止其可能正在进行的流；再从内存与 db 移除 */
  function deleteConversation(id: string): void {
    // 若该会话正在流式输出，先中止（静默，UI 不报错）
    const ctrl = abortsRef.current.get(id);
    if (ctrl) {
      ctrl.abort();
      unmarkStreaming(id);
    }
    void dbDelete('conversations', id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
    clearUnread(id);
  }

  /** 重命名会话：更新标题；按是否空白决定是否持久化 */
  function renameConversation(id: string, title: string): void {
    const trimmed = title.trim();
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    const updated: Conversation = {
      ...conv,
      title: trimmed || '新对话',
      updatedAt: Date.now(),
    };
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    safePersist(updated);
  }

  /** 切换模型：更新全局设置 + 当前会话 model；空白会话不写库 */
  function setModel(id: ProviderId): void {
    setSettings({ model: id });
    void dbPut('settings', { key: 'global', value: { model: id } });
    const conv = conversations.find((c) => c.id === activeId);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, model: id, updatedAt: Date.now() } : c,
      ),
    );
    if (conv) safePersist({ ...conv, model: id, updatedAt: Date.now() });
  }

  /** 设置思考强度（全局），持久化到 IndexedDB */
  function setThinkingLevel(level: ThinkingLevel): void {
    const next: Settings = { ...settings, thinkingLevel: level };
    setSettings(next);
    void dbPut('settings', { key: 'global', value: next });
  }

  /** 发送消息并触发智能流式回复 */
  async function sendMessage(
    text: string,
    attachments?: Attachment[],
    opts?: { search?: boolean },
  ): Promise<void> {
    const trimmed = text.trim();
    if ((!trimmed && !(attachments && attachments.length > 0)) || !activeId) return;
    await ensureReady();

    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;

    // 上下文上限：已达上限禁止继续发送
    if (contextChars(conv) >= MAX_CONTEXT_CHARS) {
      setStreamError(CONTEXT_FULL_MSG);
      return;
    }

    // 联网搜索：允许模型自主调用搜索工具（结果作为 tool 消息，不进入用户气泡）
    const now = Date.now();
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: trimmed,
      createdAt: now,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };

    // 首条消息：用其内容生成会话标题（截断到 24 字）
    const isFirstUserMessage = conv.messages.length === 0;
    const working: Conversation = {
      ...conv,
      title: isFirstUserMessage ? deriveTitleFromMessage(trimmed) : conv.title,
      messages: [...conv.messages, userMsg],
      updatedAt: now,
    };
    // 会话已含将要发送的 user 消息；runStream 负责追加占位并启动流式
    await runStream(working, { allowSearch: opts?.search });
  }

  /**
   * 在"已包含最后一条用户消息"的会话基础上：追加占位消息并启动流式回复。
   * sendMessage 与 retryConversation 共用同一流式链路。
   */
  async function runStream(
    seed: Conversation,
    extra?: { allowSearch?: boolean },
  ): Promise<void> {
    const now = Date.now();
    const placeholder: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: now,
      reasoning: '',
    };
    const working: Conversation = {
      ...seed,
      messages: [...seed.messages, placeholder],
      updatedAt: now,
    };
    setConversations((prev) => prev.map((c) => (c.id === working.id ? working : c)));
    setStreamError(null);

    // 流式过程中会话的最新引用（供 onDelta 累加与最终保存；闭包内共享）
    let workingCurrent: Conversation = working;

    // 提交最新会话：更新 ref + 内存态 + db 持久化（此时已非空白，会真正落盘）
    const commit = (c: Conversation) => {
      workingCurrent = c;
      patchConversation(c);
    };

    // 对占位消息做追加/替换（content / reasoning 分开累积）
    const mutatePlaceholder = (fn: (m: ChatMessage) => ChatMessage) =>
      commit({
        ...workingCurrent,
        updatedAt: Date.now(),
        messages: workingCurrent.messages.map((m) =>
          m.id === placeholder.id ? fn(m) : m,
        ),
      });

    // 请求历史：排除空占位与失败的占位消息，其余按顺序
    // 仅用户消息可能含 attachments；助手消息不带图
    const history = workingCurrent.messages
      .filter((m) => !(m.role === 'assistant' && (m.content.length === 0 || m.failed)))
      .map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));

    // 创建独立的 AbortController，按会话 id 登记；切走 / 删掉其它会话都不会影响这个流
    const abort = new AbortController();
    abortsRef.current.set(working.id, abort);
    markStreaming(working.id);

    await streamChatSmart({
      provider: getProvider(workingCurrent.model),
      messages: history,
      signal: abort.signal,
      thinkingLevel: settings.thinkingLevel ?? 'default',
      allowSearch: extra?.allowSearch,
      onDelta: (d) =>
        mutatePlaceholder((m) => ({ ...m, content: (m.content ?? '') + d })),
      // 思维链增量累积
      onReasoning: (d) =>
        mutatePlaceholder((m) => ({ ...m, reasoning: (m.reasoning ?? '') + d })),
      // 备用模型提示：静默切换，不向前端注入任何提示文本
      onFallback: () => {
        // 留空：主模型不可用时自动切备用模型，但 UI 无感知
      },
      // 警告类（如图片自动剥离）：stream 仍会继续，仅顶部展示
      onWarning: (m) => {
        setStreamError(m);
      },
      onError: (e) => {
        // 对外统一文案，不暴露底层错误细节；标记失败以显示重试按钮
        void e;
        setStreamError(ERROR_BUSY);
        mutatePlaceholder((m) => ({ ...m, content: ERROR_BUSY, failed: true }));
        unmarkStreaming(working.id);
      },
      onDone: () => {
        // 流正常结束：清掉该会话的流式标记与 AbortController
        unmarkStreaming(working.id);
        // 回复完成时用户已切到其它会话 → 侧边栏绿点提醒
        if (working.id !== activeIdRef.current) {
          markUnread(working.id);
        }
      },
    });

    // streamChat 返回后统一复位并保存最终会话（防御性清理；onDone 已清过）
    unmarkStreaming(working.id);
    patchConversation(workingCurrent);
  }

  /**
   * 重试：移除最后一条失败回复，重新发送同一条用户消息。
   * 目标会话若不在当前视图则先切换过去，保证用户能看到重试过程。
   */
  async function retryConversation(id: string): Promise<void> {
    await ensureReady();
    const conv = conversations.find((c) => c.id === id);
    if (!conv || conv.messages.length === 0) return;

    // 定位最后一条用户消息
    let lastUserIdx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    // 截断到最后一条用户消息（丢弃其后的失败回复）
    const trimmed: Conversation = {
      ...conv,
      messages: conv.messages.slice(0, lastUserIdx + 1),
      updatedAt: Date.now(),
    };
    setConversations((prev) => prev.map((c) => (c.id === id ? trimmed : c)));

    // 目标会话非当前活跃 → 切换过去（activeIdRef 由 effect 同步；runStream 不依赖它）
    if (id !== activeIdRef.current) {
      setActiveId(id);
      setStreamError(null);
    }

    if (contextChars(trimmed) >= MAX_CONTEXT_CHARS) {
      setStreamError(CONTEXT_FULL_MSG);
      return;
    }
    await runStream(trimmed);
  }

  /** 中止当前活跃会话的流（不影响其它会话的流） */
  function stop(): void {
    if (!activeId) return;
    const ctrl = abortsRef.current.get(activeId);
    if (!ctrl) return;
    ctrl.abort();
    unmarkStreaming(activeId);
  }

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  // 当前活跃会话是否在流式输出（按 activeId 判定）
  const isStreaming = activeId !== null && streamingIds.has(activeId);

  /** 清空错误条 */
  function clearStreamError(): void {
    setStreamError(null);
  }

  const value: ChatStore = {
    conversations,
    activeId,
    activeConversation,
    settings,
    isStreaming,
    streamingIds,
    unreadIds,
    streamError,
    newConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    setModel,
    setThinkingLevel,
    sendMessage,
    retryConversation,
    stop,
    clearStreamError,
  };

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

/** 在 Provider 内使用 store 的 hook */
export function useChatStore(): ChatStore {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error('useChatStore 必须在 <ChatProvider> 内使用');
  return ctx;
}