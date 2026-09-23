import { useEffect, useRef } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import Message from './Message';
import InputBar from './InputBar';

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
      {/* 顶部栏：左侧为侧边栏收展按钮 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-blue-100/70 bg-white/70 px-3 backdrop-blur md:px-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex size-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
          aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
        >
          <i
            className={`fa-solid fa-angles-left text-sm transition-transform duration-300 ${
              sidebarOpen ? '' : 'rotate-180'
            }`}
          />
        </button>
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
            // 无活跃会话或会话为空（尚未发送消息）：显示背景头像
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <img
                src="./avatar.jpg"
                alt="星梦"
                className="size-14 rounded-2xl object-cover shadow-md"
              />
              <h2 className="text-2xl font-semibold text-slate-800">星梦</h2>
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