import { memo, useState } from 'react';
import type { Attachment, ChatMessage } from '../types';
import Markdown from './Markdown';
import ImageLightbox from './ImageLightbox';

interface MessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  /** 失败回复的重试回调（未传则不显示重试按钮） */
  onRetry?: () => void;
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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
          {hasAttachments && <AttachmentsGrid items={message.attachments!} />}
          {message.content && (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  // 助手消息：左侧头像 + 右侧 Markdown 气泡
  const empty = isStreaming && message.content === '';
  const hasReasoning = !!message.reasoning;
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
      <div className="max-w-[85%] flex-1 rounded-2xl rounded-bl-md border border-blue-100/70 bg-white px-4 py-3 shadow-sm">
        {hasReasoning && (
          <div className="mb-2 border-b border-blue-50 pb-2">
            <details className="group">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-blue-600">
                <i className="fa-solid fa-brain text-blue-400" />
                思考过程
                <i className="fa-solid fa-chevron-right text-[10px] transition-transform group-open:rotate-90" />
                {isStreaming && <i className="fa-solid fa-circle-notch fa-spin" />}
              </summary>
              <div className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
                {message.reasoning}
              </div>
            </details>
          </div>
        )}
        {empty && !hasReasoning ? (
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
            <Markdown text={message.content} isStreaming={isStreaming} />
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
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100"
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