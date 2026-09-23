import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../hooks/useChatStore';
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
    <p className="flex min-h-[1.5rem] items-center text-sm text-slate-400">
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
  const conv = store.activeConversation;
  // 防御性取值：历史/异常数据可能缺 messages 字段
  const msgs = conv?.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  // 是否最后一条为正在流式输出的助手消息
  const isStreamingLast = store.isStreaming && lastMsg?.role === 'assistant';

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    // 距底部小于 80px 视为"在底部"
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

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
      <header className="flex h-14 shrink-0 items-center border-b border-blue-100/70 bg-white/70 px-3 backdrop-blur md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
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
            <h1 className="truncate text-sm font-medium text-slate-700">
              {conv.title}
            </h1>
          )}
        </div>
      </header>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-6 md:px-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {store.streamError && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-[13px] text-red-700">
              <i className="fa-solid fa-circle-exclamation mt-0.5" />
              <span className="flex-1 break-words">{store.streamError}</span>
              <button
                type="button"
                onClick={() => store.clearStreamError()}
                className="text-red-400 transition hover:text-red-700"
                aria-label="关闭错误提示"
              >
                <i className="fa-solid fa-xmark" />
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
              <h2 className="text-2xl font-semibold text-slate-800">星梦</h2>
              <TypewriterQuote text="天生我材必有用，千金散尽还复来" />
            </div>
          ) : (
            conv.messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                isStreaming={isStreamingLast && m.id === lastMsg?.id}
                onRetry={() => void store.retryConversation(conv.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-blue-100/70">
        <InputBar />
      </div>
    </main>
  );
}