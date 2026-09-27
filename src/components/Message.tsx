import { memo, useState, useRef, useEffect } from 'react';
import type { Attachment, ChatMessage } from '../types';
import Markdown from './Markdown';
import ImageLightbox from './ImageLightbox';

interface MessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  /** 失败回复的重试回调（未传则不显示重试按钮） */
  onRetry?: () => void;
}

/** 思考过程块：可折叠；流式思考中默认展开并带呼吸点，完成后可收折 */
function ThinkingBlock({
  reasoning,
  isStreaming,
  isWaitingContent,
}: {
  reasoning: string;
  isStreaming: boolean;
  /** 思考已可见但正文还未开始输出（模型仍在思考） */
  isWaitingContent: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const thinking = isStreaming && isWaitingContent;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 思考过程内部自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [reasoning]);

  // 模型回复结束后自动收起思考过程
  useEffect(() => {
    if (!isStreaming && expanded) {
      setExpanded(false);
    }
  }, [isStreaming, expanded]);

  return (
    <div className="mb-2 overflow-hidden rounded-xl bg-blue-50/70 ring-1 ring-blue-100/70 dark:bg-slate-900/60 dark:ring-slate-700/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-blue-500 transition-colors hover:bg-blue-100/60 dark:text-slate-300 dark:hover:bg-slate-800/70"
      >
        <i
          className={`fa-solid fa-chevron-down text-[10px] transition-transform duration-200 ${
            expanded ? '' : '-rotate-90'
          }`}
        />
        {thinking ? (
          <span className="flex items-center gap-1.5">
            思考中
            <span className="flex gap-0.5">
              {[0, 180, 360].map((d) => (
                <span
                  key={d}
                  className="size-[3px] animate-bounce rounded-full bg-blue-400"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
          </span>
        ) : (
          <span>思考过程</span>
        )}
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          className="max-h-64 overflow-y-auto overscroll-contain border-t border-blue-100/60 px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-slate-500 dark:border-slate-700/60 dark:text-white/85"
        >
          {reasoning}
          {thinking && <span className="streaming-caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

/** 友好显示文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 用户消息里的附件预览（图片缩略图，点击放大；文件以图标 + 文件名） */
function AttachmentsGrid({ items }: { items: Attachment[] }) {
  const [zoomed, setZoomed] = useState<Attachment | null>(null);

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {items.map((a) => {
        if (a.kind === 'image') {
          const displaySize = a.originalSize ?? a.size;
          return (
            <div
              key={a.id}
              title={`${a.name}（${formatSize(displaySize)}）`}
              className="block cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-white/40 transition-transform hover:scale-[1.02]"
              onClick={() => setZoomed(a)}
            >
              <img
                src={a.dataUrl}
                alt={a.name}
                className="size-20 object-cover"
              />
            </div>
          );
        }
        const displaySize = a.originalSize ?? a.size;
        return (
          <a
            key={a.id}
            href={a.dataUrl}
            download={a.name}
            title={`${a.name}（${formatSize(displaySize)}）`}
            className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-[12px] text-white ring-1 ring-white/20 transition-colors hover:bg-white/25"
          >
            <i className="fa-solid fa-file-lines" />
            <span className="max-w-[10rem] truncate">{a.name}</span>
          </a>
        );
      })}
      {zoomed && (
        <ImageLightbox
          src={zoomed.dataUrl}
          name={zoomed.name}
          size={zoomed.originalSize ?? zoomed.size}
          onClose={() => setZoomed(null)}
        />
      )}
    </div>
  );
}

function Message({ message, isStreaming, onRetry }: MessageProps) {
  // 用户消息：右侧蓝色气泡，纯文本 + 附件预览
  if (message.role === 'user') {
    const hasAttachments = !!message.attachments && message.attachments.length > 0;
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
          {hasAttachments && <AttachmentsGrid items={message.attachments!} />}
          {message.content && (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>
        {/* 审核状态标签：气泡下方显示 */}
        {message.moderating && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-500 dark:text-amber-400">
            <i className="fa-solid fa-shield-halved" />
            <span>审核中</span>
          </div>
        )}
        {message.moderated && !message.moderating && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-green-500 dark:text-green-400">
            <i className="fa-solid fa-circle-check" />
            <span>审核通过</span>
          </div>
        )}
      </div>
    );
  }

  // 助手消息：左侧头像 + 右侧 Markdown 气泡
  const hasReasoning = !!message.reasoning;
  // 仅当内容/思考都为空才算占位等待（思考流式到达时先展示思考块）
  const empty = isStreaming && message.content === '' && !hasReasoning;
  // 思考已开始但正文未输出：仍在思考（块内显示"思考中"）
  const waitingContent = hasReasoning && message.content === '';
  // 流式输出追加闪烁光标，让"正在生成"更明显；
  // 若内容以代码围栏结尾（CodeBlock 自身已带光标），跳过外部光标避免双光标
  const trimmedEnd = message.content.trimEnd();
  const lastLine = trimmedEnd.slice(trimmedEnd.lastIndexOf('\n') + 1);
  const endsWithCodeBlock =
    /^\s*(```+|~~~+)/.test(lastLine) || /(```+|~~~+)\s*$/.test(trimmedEnd);
  const showStreamCaret = isStreaming && !empty && !endsWithCodeBlock;
  return (
    <div className="flex justify-start gap-3">
      <img
        src="./avatar.jpg"
        alt="星梦"
        className="size-8 shrink-0 rounded-full object-cover"
      />
      <div className="max-w-[85%] flex-1 rounded-2xl rounded-bl-md border border-blue-100/70 bg-white px-4 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
        {empty ? (
          // 尚未输出时的三点省略动画
          <div className="flex gap-1 py-0.5">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="size-1.5 animate-bounce rounded-full bg-blue-400"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        ) : (
          <>
            {hasReasoning && (
              <ThinkingBlock
                reasoning={message.reasoning!}
                isStreaming={isStreaming}
                isWaitingContent={waitingContent}
              />
            )}
            {message.content && (
              <Markdown text={message.content} isStreaming={isStreaming} />
            )}
            {/* 流式光标：闪烁 ▍ 提示正在生成 */}
            {showStreamCaret && (
              <span className="streaming-caret" aria-hidden="true" />
            )}
          </>
        )}
        {/* 失败回复：提供重试，重新发送同一用户消息 */}
        {!isStreaming && message.failed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:hover:bg-blue-500/25"
          >
            <i className="fa-solid fa-rotate-right" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(Message);