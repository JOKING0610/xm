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
  // scroll-spy：当前视口顶部所在轮次（用户消息 id），钢琴键实时变色联动
  const [activeRound, setActiveRound] = useState<string | null>(null);
  // 各会话离开时的滚动位置：切换会话后恢复原位（在底部附近则仍回到底部）
  const scrollPosRef = useRef<Map<string, { top: number; near: boolean }>>(new Map());
  // scroll-spy 节流定时器（约 120ms）
  const spyTimerRef = useRef<number | null>(null);
  // 钢琴键悬停的轮（用户消息 id）：控制阶梯展开与预览气泡
  const [hoverKey, setHoverKey] = useState<string | null>(null);
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
  // 悬停键索引：用于计算 ±1/±2 阶梯长度
  const hoveredIdx = hoverKey === null ? null : rounds.findIndex((r) => r.userId === hoverKey);

  /** scroll-spy：以滚动容器顶部为基准，找最后一个"顶边已越过基准线"的用户消息作为当前轮次 */
  function updateActiveRound(): void {
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

  /** 回到底部：滚到消息末尾并恢复自动跟随 */
  function scrollToBottom(): void {
    nearBottomRef.current = true;
    setAtBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  /** 对话跳转：按稳定锚点契约 [data-chat-anchor-key] 定位 → 平滑滚动 → 1.2s 品牌蓝高亮环 */
  function jumpToMessage(id: string): void {
    const target = document.querySelector(`[data-chat-anchor-key="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 短暂高亮：先移除再强制回流，保证连点同一目标也能重新触发动画
    target.classList.remove('nav-jump-highlight');
    void (target as HTMLElement).offsetWidth;
    target.classList.add('nav-jump-highlight');
    window.setTimeout(() => target.classList.remove('nav-jump-highlight'), 1200);
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
      setHoverKey(null);
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

      {/* 钢琴键式轮次导航：右侧竖条，每键锚定一条用户提问；
          悬停键变长变色、上下相邻键阶梯展开，并弹出「提问+回复」预览气泡；
          非悬停时当前键仅随滚动变色（长度不变）；点击平滑跳转并高亮目标；
          真实用户提问不足 2 条时不显示（设计如此） */}
      {rounds.length >= 2 && (
        <div className="pointer-events-none absolute right-2 top-1/2 z-20 flex max-h-[70vh] -translate-y-1/2 flex-col items-end justify-center gap-1.5 md:right-4">
          {rounds.map((r, i) => {
            const active = activeRound === r.userId;
            const d = hoveredIdx === null ? null : Math.abs(hoveredIdx - i);
            const sizeClass =
              d === 0
                ? 'w-9 bg-blue-500'
                : d === 1
                  ? 'w-7 bg-blue-400'
                  : d === 2
                    ? 'w-5 bg-blue-300 dark:bg-blue-400/60'
                    : active
                      ? 'w-4 bg-blue-500'
                      : 'w-4 bg-blue-200 dark:bg-slate-600';
            const reply = r.steps.filter((s) => !s.isUser).pop();
            return (
              <div
                key={r.userId}
                className="pointer-events-auto relative flex justify-end"
                onMouseEnter={() => setHoverKey(r.userId)}
                onMouseLeave={() => setHoverKey(null)}
              >
                {d === 0 && (
                  <div className="pointer-events-none absolute right-full top-1/2 z-10 mr-3 w-60 -translate-y-1/2 rounded-xl border border-blue-100 bg-white/95 p-2.5 shadow-lg backdrop-blur dark:border-slate-600 dark:bg-slate-800/95">
                    <p className="mb-1 flex gap-1.5 text-[12px] leading-snug text-slate-700 dark:text-slate-200">
                      <i className="fa-solid fa-user mt-1 shrink-0 text-[9px] text-blue-400" />
                      <span className="line-clamp-2 break-words">{r.question}</span>
                    </p>
                    <p className="flex gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                      <i className="fa-solid fa-comment-dots mt-1 shrink-0 text-[9px] text-slate-400" />
                      <span className="line-clamp-2 break-words">{reply ? reply.label : '（暂无回复）'}</span>
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`跳转到第 ${i + 1} 轮`}
                  title={`第 ${i + 1} 轮`}
                  onClick={() => jumpToMessage(r.userId)}
                  className={`h-1.5 rounded-full transition-all duration-150 ${sizeClass}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* 回到底部：圆形纯图标按钮，离开底部时显示；流式输出中右上角跳动圆点提示 */}
      {!atBottom && msgs.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="回到底部"
          aria-label="回到底部"
          className="absolute bottom-4 right-3 z-20 flex size-10 items-center justify-center rounded-full border border-blue-100 bg-white/90 text-slate-600 shadow-md backdrop-blur transition-colors hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700 md:right-6"
        >
          {isStreamingLast && (
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-bounce rounded-full bg-blue-400" />
          )}
          <i className="fa-solid fa-arrow-down text-sm" />
        </button>
      )}
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-blue-100/70 dark:border-slate-700/70">
        <InputBar />
      </div>
    </main>
  );
}