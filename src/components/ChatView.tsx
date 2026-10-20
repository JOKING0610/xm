import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { downloadApk } from '../lib/apk';
import Message from './Message';
import InputBar from './InputBar';

/**
 * 空会话欢迎语的打字机效果：
 * 逐字显示 → 全部显示后等待 5s → 逐字收回 → 收回后等待 3s → 重新打字，循环往复。
 */
function TypewriterQuote({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'full' | 'erasing' | 'empty'>('typing');

  // 打字/收回的逐字推进，以及两个停留阶段的计时
  useEffect(() => {
    if (phase === 'typing' || phase === 'erasing') {
      const step = phase === 'typing' ? 1 : -1;
      const delay = phase === 'typing' ? 180 : 110;
      const timer = window.setInterval(() => setCount((c) => c + step), delay);
      return () => window.clearInterval(timer);
    }
    if (phase === 'full') {
      const timer = window.setTimeout(() => setPhase('erasing'), 5000);
      return () => window.clearTimeout(timer);
    }
    if (phase === 'empty') {
      const timer = window.setTimeout(() => setPhase('typing'), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [phase]);

  // 到达边界时切换阶段
  useEffect(() => {
    if (phase === 'typing' && count >= text.length) setPhase('full');
    if (phase === 'erasing' && count <= 0) setPhase('empty');
  }, [count, phase, text.length]);

  return (
    <p className="flex min-h-[1.5rem] items-center text-sm text-slate-400 dark:text-slate-500">
      <span>{text.slice(0, Math.max(0, count))}</span>
      {/* 打字/收回阶段显示闪烁光标 */}
      {(phase === 'typing' || phase === 'erasing') && (
        <span className="streaming-caret" aria-hidden="true" />
      )}
    </p>
  );
}

export default function ChatView({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const store = useChatStore();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // 消息滚动容器 + "是否接近底部"跟踪：用户上滑浏览历史时不强制被拉回底部
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  // 是否在底部附近：控制"回到底部"悬浮按钮显隐（与 ref 同步，仅变化时 setState）
  const [atBottom, setAtBottom] = useState(true);
  // "对话跳转"下拉是否展开
  const [jumpOpen, setJumpOpen] = useState(false);
  // scroll-spy：当前视口顶部所在轮次（用户消息 id），导航面板实时高亮
  const [activeRound, setActiveRound] = useState<string | null>(null);
  // 各会话离开时的滚动位置：切换会话后恢复原位（在底部附近则仍回到底部）
  const scrollPosRef = useRef<Map<string, { top: number; near: boolean }>>(new Map());
  // scroll-spy 节流定时器（约 120ms）
  const spyTimerRef = useRef<number | null>(null);
  // scroll-spy 跟随暂停：手动滚动导航面板后暂停反向高亮，点击跳转或重开面板后恢复
  const spyPauseRef = useRef(false);
  // 轮次折叠：已展开步次明细的轮（用户消息 id）集合
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set());
  // 导航面板容器 + "程序化居中滚动"标记（其触发的 scroll 事件不算用户手动滚动）
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelAutoScrollRef = useRef(false);
  // 安装包下载中状态：下载期间按钮显示进度并禁用，避免重复触发
  const [downloading, setDownloading] = useState(false);
  const conv = store.activeConversation;
  // 防御性取值：历史/异常数据可能缺 messages 字段
  const msgs = conv?.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  // 是否最后一条为正在流式输出的助手消息
  const isStreamingLast = store.isStreaming && lastMsg?.role === 'assistant';

  // 轮次大纲：每轮 = 用户提问 + 其后归属的助手回复（无提问的前导回复忽略）
  const rounds = useMemo(() => {
    const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 46);
    const out: { userId: string; question: string; steps: { id: string; label: string; isUser: boolean }[] }[] = [];
    for (const m of msgs) {
      if (m.role === 'user') {
        out.push({
          userId: m.id,
          question: m.content || '（附件消息）',
          steps: [{ id: m.id, label: oneLine(m.content) || '（附件消息）', isUser: true }],
        });
      } else if (out.length > 0) {
        out[out.length - 1].steps.push({
          id: m.id,
          label: oneLine(m.content) || (m.reasoning ? '（思考过程）' : '（空回复）'),
          isUser: false,
        });
      }
    }
    return out;
  }, [msgs]);

  /** 切换某轮步次明细的展开/收起 */
  function toggleRound(id: string): void {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** scroll-spy：以滚动容器顶部为基准，找最后一个"顶边已越过基准线"的用户消息作为当前轮次 */
  function updateActiveRound(): void {
    // 用户手动滚动导航面板期间暂停跟随，避免高亮被对话滚动"抢走"
    if (spyPauseRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const base = el.getBoundingClientRect().top;
    let current: string | null = null;
    for (const m of msgs) {
      if (m.role !== 'user') continue;
      const node = document.getElementById(`msg-${m.id}`);
      if (!node) continue;
      if (node.getBoundingClientRect().top - base <= 80) current = m.id;
      else break;
    }
    setActiveRound((v) => (v === current ? v : current));
  }

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    // 距底部小于 80px 视为"在底部"
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    nearBottomRef.current = near;
    setAtBottom((v) => (v === near ? v : near));
    // scroll-spy 节流：滚动停止 ~120ms 后判定一次当前轮次
    if (spyTimerRef.current === null) {
      spyTimerRef.current = window.setTimeout(() => {
        spyTimerRef.current = null;
        updateActiveRound();
      }, 120);
    }
  }

  /** 展开/收起导航面板；展开时恢复跟随并立即判定一次当前轮次 */
  function toggleJump(): void {
    const next = !jumpOpen;
    setJumpOpen(next);
    if (next) {
      spyPauseRef.current = false;
      updateActiveRound();
    }
  }

  /** 回到底部：滚到消息末尾并恢复自动跟随 */
  function scrollToBottom(): void {
    nearBottomRef.current = true;
    setAtBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  /** 对话跳转：按稳定锚点契约 [data-chat-anchor-key] 定位 → 平滑滚动 → 1.2s 品牌蓝高亮环 */
  function jumpToMessage(id: string): void {
    setJumpOpen(false);
    const target = document.querySelector(`[data-chat-anchor-key="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 短暂高亮：先移除再强制回流，保证连点同一目标也能重新触发动画
    target.classList.remove('nav-jump-highlight');
    void (target as HTMLElement).offsetWidth;
    target.classList.add('nav-jump-highlight');
    window.setTimeout(() => target.classList.remove('nav-jump-highlight'), 1200);
    // 点击跳转后恢复 scroll-spy 跟随对话视口
    spyPauseRef.current = false;
  }

  /** 下载安装包（共享实现见 lib/apk.ts）：下载期间按钮显示进度并禁用 */
  async function handleDownloadApk(): Promise<void> {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadApk();
    } finally {
      setDownloading(false);
    }
  }

  // 切换会话：cleanup 记录旧会话滚动位置，setup 恢复新会话位置
  // （上次离开时不在底部 → 回到原位；在底部附近 → 直接定位底部）
  const convId = conv?.id ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && convId) {
      const saved = scrollPosRef.current.get(convId);
      if (saved && !saved.near) {
        nearBottomRef.current = false;
        setAtBottom(false);
        el.scrollTop = saved.top;
      } else {
        nearBottomRef.current = true;
        setAtBottom(true);
        el.scrollTop = el.scrollHeight;
      }
      setActiveRound(null);
      setExpandedRounds(new Set());
      spyPauseRef.current = false;
      updateActiveRound();
    }
    return () => {
      const elNow = scrollRef.current;
      if (elNow && convId) {
        scrollPosRef.current.set(convId, {
          top: elNow.scrollTop,
          near: nearBottomRef.current,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // 消息变化时：仅当用户本就贴近底部时才跟随滚动；上滑浏览历史时保持位置
  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: store.isStreaming ? 'auto' : 'smooth',
      });
    }
  }, [conv?.messages, store.isStreaming]);

  // 面板展开期间：当前轮次变化时把对应条目滚动居中（高亮点持续保持在面板可视区中央）
  useEffect(() => {
    if (!jumpOpen || !activeRound) return;
    const panel = panelRef.current;
    const item = panel?.querySelector<HTMLElement>(`[data-jump-item="${activeRound}"]`);
    if (!panel || !item) return;
    panelAutoScrollRef.current = true;
    panel.scrollTop = item.offsetTop - (panel.clientHeight - item.offsetHeight) / 2;
    // 安全兜底：若 scrollTop 未实际变化不会产生 scroll 事件，超时后复位标记
    window.setTimeout(() => {
      panelAutoScrollRef.current = false;
    }, 300);
  }, [jumpOpen, activeRound]);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 顶部栏：左侧为侧边栏收展按钮 + 当前会话标题 */}
      <header className="flex h-14 shrink-0 items-center border-b border-blue-100/70 bg-white/70 px-3 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70 md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          >
            <i
              className={`fa-solid fa-angles-left text-sm transition-transform duration-300 ${
                sidebarOpen ? '' : 'rotate-180'
              }`}
            />
          </button>
          {/* 会话标题：超长省略号截断 */}
          {conv && (
            <h1 className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
              {conv.title}
            </h1>
          )}
        </div>
        {/* 下载 App：按钮触发取回安装包并以 .apk 文件名保存（详见 APK_URL 注释） */}
        <button
          type="button"
          onClick={() => void handleDownloadApk()}
          disabled={downloading}
          title="下载 App"
          aria-label="下载 App"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i
            className={`fa-solid text-xs ${
              downloading ? 'fa-circle-notch fa-spin' : 'fa-download'
            }`}
          />
          {downloading ? '下载中…' : '下载 App'}
        </button>
      </header>

      {/* 消息区（relative 容器承载悬浮的"回到底部 / 对话跳转"按钮） */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-3 py-6 md:px-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {store.streamError && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              <i className="fa-solid fa-circle-exclamation mt-0.5" />
              <span className="flex-1 break-words">{store.streamError}</span>
              <button
                type="button"
                onClick={() => store.clearStreamError()}
                className="text-red-400 transition hover:text-red-700 dark:text-red-400/70 dark:hover:text-red-300"
                aria-label="关闭错误提示"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}
          {conv?.pending && !store.isStreaming && (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => void store.resumeConversation(conv.id)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-[13px] text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
              >
                <i className="fa-solid fa-rotate-left text-xs" />
                恢复未完成的回复
              </button>
            </div>
          )}
          {!conv || conv.messages.length === 0 ? (
            // 无活跃会话或会话为空（尚未发送消息）：显示背景头像与打字机欢迎语
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <img
                src="./avatar.jpg"
                alt="星梦"
                className="size-14 rounded-2xl object-cover shadow-md"
              />
              <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">星梦</h2>
              <TypewriterQuote text="天生我材必有用，千金散尽还复来" />
            </div>
          ) : (
            conv.messages.map((m) => (
              <div
                key={m.id}
                id={`msg-${m.id}`}
                // 稳定语义锚点契约：导航跳转只认此属性，不依赖文本/类名/索引
                data-chat-anchor-key={m.id}
                className="scroll-mt-2"
              >
                <Message
                  message={m}
                  isStreaming={isStreamingLast && m.id === lastMsg?.id}
                  onRetry={() => void store.retryConversation(conv.id)}
                />
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 悬浮导航按钮：对话跳转（用户提问列表定位）+ 回到底部（离开底部时显示） */}
      {msgs.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 right-3 z-20 flex flex-col items-end gap-2 md:right-6">
          {/* 点击遮罩：收起跳转列表时顺带吞掉外部点击 */}
          {jumpOpen && (
            <div
              className="pointer-events-auto fixed inset-0 z-0"
              onClick={() => setJumpOpen(false)}
            />
          )}
          {jumpOpen && (
            <div
              ref={panelRef}
              onScroll={() => {
                // 用户手动滚动面板 → 暂停 scroll-spy 跟随；程序化居中滚动不触发暂停
                if (!panelAutoScrollRef.current) spyPauseRef.current = true;
              }}
              className="pointer-events-auto relative z-10 max-h-80 w-72 overflow-y-auto rounded-2xl border border-blue-100 bg-white/95 p-1.5 shadow-lg backdrop-blur dark:border-slate-600 dark:bg-slate-800/95"
            >
              {rounds.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">暂无提问</p>
              ) : (
                rounds.map((r, i) => {
                  const active = activeRound === r.userId;
                  const expanded = expandedRounds.has(r.userId);
                  return (
                    <div key={r.userId} className="mb-0.5 last:mb-0">
                      <div
                        className={`flex items-center rounded-xl transition-colors ${
                          active ? 'bg-blue-100/80 dark:bg-blue-500/20' : 'hover:bg-blue-50 dark:hover:bg-blue-500/10'
                        }`}
                      >
                        {/* 轮次行右侧箭头：展开/收起该轮步次明细 */}
                        <button
                          type="button"
                          onClick={() => toggleRound(r.userId)}
                          title={expanded ? '收起本轮步次' : '展开本轮步次'}
                          aria-label={expanded ? '收起本轮步次' : '展开本轮步次'}
                          className="flex size-7 shrink-0 items-center justify-center text-slate-400 transition-colors hover:text-blue-500 dark:text-slate-500 dark:hover:text-blue-400"
                        >
                          <i
                            className={`fa-solid fa-chevron-right text-[9px] transition-transform duration-200 ${
                              expanded ? 'rotate-90' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          data-jump-item={r.userId}
                          onClick={() => jumpToMessage(r.userId)}
                          title={r.question}
                          className={`flex min-w-0 flex-1 items-center gap-2 py-2 pr-2.5 text-left text-[13px] transition-colors ${
                            active
                              ? 'font-medium text-blue-700 dark:text-blue-300'
                              : 'text-slate-600 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-300'
                          }`}
                        >
                          <span
                            className={`shrink-0 rounded-md px-1.5 text-[11px] font-medium ${
                              active
                                ? 'bg-blue-500 text-white dark:bg-blue-400 dark:text-slate-900'
                                : 'bg-blue-50 text-blue-500 dark:bg-blue-500/15 dark:text-blue-300'
                            }`}
                          >
                            {i + 1}
                          </span>
                          <span className="truncate">{r.question}</span>
                        </button>
                      </div>
                      {/* 步次明细：该轮的用户提问与助手回复，点击直达对应消息 */}
                      {expanded && (
                        <div className="ml-3.5 mt-0.5 space-y-0.5 border-l border-blue-100 pl-2 dark:border-slate-700">
                          {r.steps.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => jumpToMessage(s.id)}
                              title={s.label}
                              className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                            >
                              <i
                                className={`fa-solid shrink-0 text-[9px] ${
                                  s.isUser ? 'text-blue-400 fa-user' : 'text-slate-400 fa-comment-dots dark:text-slate-500'
                                }`}
                              />
                              <span className="truncate">{s.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
          <button
            type="button"
            onClick={toggleJump}
            title="对话跳转"
            aria-label="对话跳转"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-100 bg-white/90 px-3.5 py-2 text-[13px] text-slate-600 shadow-md backdrop-blur transition-colors hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <i className="fa-solid fa-list-ul text-xs" />
            对话跳转
          </button>
          {!atBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              title="回到底部"
              aria-label="回到底部"
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-100 bg-white/90 px-3.5 py-2 text-[13px] text-slate-600 shadow-md backdrop-blur transition-colors hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {isStreamingLast && (
                <span className="size-1.5 animate-bounce rounded-full bg-blue-400" />
              )}
              <i className="fa-solid fa-arrow-down text-xs" />
              回到底部
            </button>
          )}
        </div>
      )}
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-blue-100/70 dark:border-slate-700/70">
        <InputBar />
      </div>
    </main>
  );
}