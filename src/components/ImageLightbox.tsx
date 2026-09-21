import { useEffect } from 'react';

/** 友好显示文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 图片放大查看层（点击遮罩或 ESC 关闭），输入区 / 消息区共用 */
export default function ImageLightbox({
  src,
  name,
  size,
  onClose,
}: {
  src: string;
  name: string;
  size: number | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片：${name}`}
    >
      <figure
        className="relative max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={name}
          className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
        />
        <figcaption className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[12px] text-white">
          {name}
          {typeof size === 'number' && <>（{formatSize(size)}）</>}
        </figcaption>
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-3 -top-3 flex size-8 items-center justify-center rounded-full bg-white text-slate-600 shadow transition-colors hover:text-red-500"
          aria-label="关闭图片"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </figure>
    </div>
  );
}