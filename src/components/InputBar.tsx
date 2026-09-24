import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { Attachment, ThinkingLevel } from '../types';
import { uuid } from '../lib/uuid';
import {
  useChatStore,
  ERROR_BUSY,
  MAX_CONTEXT_CHARS,
  CONTEXT_FULL_MSG,
} from '../hooks/useChatStore';
import ImageLightbox from './ImageLightbox';

/** 思考强度选项（菜单内仅显示档位名，前缀"思考："由按钮单独拼接） */
const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

/** 思考强度自定义下拉菜单（胶囊按钮 + 向上展开面板） */
function ThinkingMenu({
  level,
  onChange,
}: {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const current =
    THINKING_OPTIONS.find((o) => o.value === level) ?? THINKING_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
          open
            ? 'border-blue-400 text-blue-600 dark:border-blue-500/60 dark:text-blue-400'
            : 'border-blue-100 bg-white text-slate-500 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-500/10 dark:hover:text-blue-400'
        }`}
      >
        <i className="fa-solid fa-brain text-xs" />
        思考：{current.label}
        <i
          className={`fa-solid fa-chevron-down text-[10px] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="absolute bottom-full left-0 z-20 mb-1 w-40 overflow-hidden rounded-xl border border-blue-100 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/40"
          >
            {THINKING_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === level}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  o.value === level
                    ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                    : 'text-slate-600 hover:bg-blue-50 dark:text-slate-300 dark:hover:bg-blue-500/10'
                }`}
              >
                {o.label}
                {o.value === level && (
                  <i className="fa-solid fa-check text-[10px]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 普通文件大小上限（图片不做大小限制，统一走前端压缩）
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

// 图片压缩参数
const MAX_IMAGE_DIM = 2048; // 最长边缩放上限
const JPEG_QUALITY = 0.85; // 照片类典型值
// PNG/GIF/WebP 都统一压成 JPEG 以获得最佳体积
const COMPRESSIBLE_MIME = new Set([
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

/** 把 File 读取成 dataURL */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 把 dataURL 还原成字节大小（base64 体积约为原字节 * 4/3） */
function dataUrlByteSize(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  // 去掉 base64 padding '='，每 4 个 base64 字符还原 3 字节
  const padding = (b64.match(/=+$/)?.[0].length) ?? 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** 加载一个 File 到 HTMLImageElement */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 加载完即可释放对象 URL
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`图片解析失败：${file.name}`));
    };
    img.src = url;
  });
}

/**
 * 图片压缩策略：
 *  - 最长边 > MAX_IMAGE_DIM → 等比缩到 MAX_IMAGE_DIM
 *  - PNG/GIF/WebP/BMP → 统一转 JPEG（避免原压缩后体积可能比 JPEG 还大）
 *  - 已是 JPEG 且压缩后更大 → 保留原图（不增不减）
 *  - 其它（如 SVG、ico）按字节取原样
 */
async function compressImage(
  file: File,
): Promise<{ dataUrl: string; mime: string; size: number; originalSize: number }> {
  const originalSize = file.size;
  // SVG 之类矢量 / 不在压缩白名单的格式：直接转 dataURL
  const mime = file.type || 'application/octet-stream';
  const needsCompress =
    mime.startsWith('image/') &&
    mime !== 'image/svg+xml' &&
    mime !== 'image/x-icon' &&
    mime !== 'image/vnd.microsoft.icon';

  if (!needsCompress) {
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mime, size: originalSize, originalSize };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch (e) {
    // 解析失败：回退到原始 dataURL
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mime, size: originalSize, originalSize };
  }

  // 计算目标尺寸
  let { width, height } = img;
  const longest = Math.max(width, height);
  if (longest > MAX_IMAGE_DIM) {
    if (width >= height) {
      height = Math.round((height * MAX_IMAGE_DIM) / width);
      width = MAX_IMAGE_DIM;
    } else {
      width = Math.round((width * MAX_IMAGE_DIM) / height);
      height = MAX_IMAGE_DIM;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // 拿不到 2D 上下文（极少见）：回退
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mime, size: originalSize, originalSize };
  }
  // 白底，避免 PNG 透明背景转 JPEG 后变黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const targetMime = COMPRESSIBLE_MIME.has(mime) ? 'image/jpeg' : mime;
  const compressedDataUrl = canvas.toDataURL(targetMime, JPEG_QUALITY);
  const compressedSize = dataUrlByteSize(compressedDataUrl);

  // JPEG 已是压缩格式；若压缩后比原图还大，回退原图
  if (targetMime === 'image/jpeg' && mime === 'image/jpeg' && compressedSize >= originalSize) {
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mime, size: originalSize, originalSize };
  }
  return {
    dataUrl: compressedDataUrl,
    mime: targetMime,
    size: compressedSize,
    originalSize,
  };
}

/** 把一次 file input 选择转成 Attachment[]（含大小/类型校验 + 图片自动压缩） */
async function readFilesAsAttachments(
  files: FileList | File[],
  kind: 'image' | 'file',
  onCompress?: (fileName: string, busy: boolean) => void,
): Promise<Attachment[]> {
  const list = Array.from(files);
  const result: Attachment[] = [];
  for (const f of list) {
    if (kind === 'file' && f.size > MAX_FILE_BYTES) {
      throw new Error(
        `文件过大：${f.name}（${(f.size / 1024 / 1024).toFixed(2)} MB 上限 ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB）`,
      );
    }
    if (kind === 'image') {
      // 图片：不限制原始大小，前端统一压缩
      onCompress?.(f.name, true);
      try {
        const { dataUrl, mime, size, originalSize } = await compressImage(f);
        result.push({
          id: uuid(),
          kind,
          name: f.name,
          mime,
          dataUrl,
          size,
          originalSize: originalSize !== size ? originalSize : undefined,
        });
      } finally {
        onCompress?.(f.name, false);
      }
    } else {
      const dataUrl = await fileToDataUrl(f);
      result.push({
        id: uuid(),
        kind,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        dataUrl,
        size: f.size,
      });
    }
  }
  return result;
}

/** 友好显示文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 单个待发送附件的缩略图/卡片（图片点击放大） */
function AttachmentPreview({
  att,
  onRemove,
}: {
  att: Attachment;
  onRemove: (id: string) => void;
}): ReactNode {
  const [zoomed, setZoomed] = useState(false);
  const isImage = att.kind === 'image';
  // 仅显示原文件大小（压缩前），若未压缩则与当前一致
  const displaySize = isImage ? (att.originalSize ?? att.size) : att.size;
  return (
    <div className="group relative flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-2 py-1.5 shadow-sm dark:border-slate-600 dark:bg-slate-800">
      {isImage ? (
        <div
          className="size-10 shrink-0 cursor-zoom-in overflow-hidden rounded-md"
          onClick={() => setZoomed(true)}
          title="点击放大"
        >
          <img src={att.dataUrl} alt={att.name} className="size-10 object-cover" />
        </div>
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
          <i className="fa-solid fa-file-lines" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-slate-700 dark:text-slate-200" title={att.name}>
          {att.name}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500">{formatSize(displaySize)}</div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(att.id)}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-white text-slate-400 shadow ring-1 ring-slate-200 transition hover:text-red-500 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 dark:hover:text-red-400"
        aria-label="移除附件"
      >
        <i className="fa-solid fa-xmark text-[10px]" />
      </button>
      {zoomed && isImage && (
        <ImageLightbox
          src={att.dataUrl}
          name={att.name}
          size={displaySize}
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}

export default function InputBar() {
  const store = useChatStore();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 正在压缩中的图片（占位卡片，压缩完成后替换为真实附件卡片）
  const [compressing, setCompressing] = useState<{ key: string; name: string }[]>([]);
  // 联网搜索开关：开启后发送前先联网搜索再回复
  const [searchEnabled, setSearchEnabled] = useState(false);
  // 待发送内容：无当前会话时先新建会话，待会话激活后由 effect 发送
  const [pending, setPending] = useState<{
    text: string;
    attachments: Attachment[] | null;
    search: boolean;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 文本域自动增高：随内容伸缩，上限为屏幕高度的 20%
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.2) + 'px';
  }

  // 窗口尺寸变化（如移动端键盘弹出/横竖屏）时重算高度上限
  useEffect(() => {
    const onResize = () => {
      if (textareaRef.current) autoResize(textareaRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 发送后清空输入框并重置高度
  function resetInput() {
    setText('');
    setAttachments([]);
    setErrorMsg(null);
    if (textareaRef.current) autoResize(textareaRef.current);
  }

  // 无会话场景：新建会话后需等 React 状态更新（activeConversation 就绪）再发送
  useEffect(() => {
    if (pending !== null && store.activeConversation) {
      void store.sendMessage(pending.text, pending.attachments ?? undefined, {
        search: pending.search,
      });
      setPending(null);
    }
  }, [pending, store.activeConversation]);

  // 上下文限制：当前会话累计文本达到上限后禁止再发送
  const conv = store.activeConversation;
  const totalChars =
    conv?.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) ?? 0;
  const contextFull = totalChars >= MAX_CONTEXT_CHARS;

  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || store.isStreaming || contextFull) return;
    resetInput();
    if (store.activeConversation) {
      void store.sendMessage(trimmed, attachments.length > 0 ? attachments : undefined, {
        search: searchEnabled,
      });
    } else {
      store.newConversation(); // 创建并激活新会话
      setPending({
        text: trimmed,
        attachments: attachments.length > 0 ? attachments : null, // 交由 effect 发送
        search: searchEnabled,
      });
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 直接换行；Ctrl/Cmd + Enter 发送（输入法候选中 Enter 不拦截）
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    }
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>, kind: 'image' | 'file'): Promise<void> {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    try {
      const list = await readFilesAsAttachments(files, kind, (name, busy) => {
        setCompressing((prev) =>
          busy
            ? [...prev, { key: `${name}-${Date.now()}`, name }]
            : prev.filter((p) => p.name !== name),
        );
      });
      setAttachments((prev) => [...prev, ...list]);
    } catch (err) {
      void err;
      setErrorMsg(ERROR_BUSY);
    } finally {
      // 清空 input 以便同一文件能再次选择
      e.target.value = '';
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="px-3 py-3 md:px-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* 工具箱：思考强度 + 联网搜索（输入框上方）；窄屏自动换行避免挤压 */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* 思考强度：自定义胶囊下拉菜单 */}
          <ThinkingMenu
            level={store.settings.thinkingLevel ?? 'default'}
            onChange={store.setThinkingLevel}
          />
          {/* 联网搜索：胶囊开关（状态仅由内嵌迷你开关指示，按钮本身不染色） */}
          <button
            type="button"
            onClick={() => setSearchEnabled((v) => !v)}
            title={searchEnabled ? '联网搜索：已开启' : '联网搜索：已关闭'}
            aria-pressed={searchEnabled}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
          >
            <i className="fa-solid fa-earth-asia" />
            联网搜索
            {/* 迷你开关：底色指示状态（蓝=开 / 灰=关），滑块始终白色 */}
            <span
              className={`ml-1 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                searchEnabled ? 'bg-blue-500' : 'bg-slate-200'
              }`}
            >
              <span
                className={`size-3 rounded-full bg-white shadow transition-transform ${
                  searchEnabled ? 'translate-x-2.5' : 'translate-x-0'
                }`}
              />
            </span>
          </button>
        </div>

        {contextFull && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
            <i className="fa-solid fa-triangle-exclamation" />
            {CONTEXT_FULL_MSG}
          </div>
        )}
        {errorMsg && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            <i className="fa-solid fa-circle-exclamation mt-0.5" />
            <span className="flex-1">{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-400 transition hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-300"
              aria-label="关闭错误提示"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        )}

        {(compressing.length > 0 || attachments.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {/* 压缩中占位卡片（与完成后的样式一致，仅图标区域为加载动画） */}
            {compressing.map((p) => (
              <div
                key={p.key}
                className="flex w-44 items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 px-2 py-1.5 dark:border-blue-500/40 dark:bg-blue-500/10"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-500 dark:bg-blue-500/20 dark:text-blue-300">
                  <i className="fa-solid fa-circle-notch fa-spin" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-slate-700 dark:text-slate-200" title={p.name}>
                    {p.name}
                  </div>
                  <div className="text-[10px] text-blue-500 dark:text-blue-400">压缩中...</div>
                </div>
              </div>
            ))}
            {attachments.map((a) => (
              <div key={a.id} className="w-44">
                <AttachmentPreview att={a} onRemove={removeAttachment} />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-blue-100 bg-white p-2 shadow-sm ring-blue-100 transition focus-within:border-blue-400 focus-within:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/20 dark:ring-blue-500/20 dark:focus-within:border-blue-500 dark:focus-within:ring-2">
          {/* 图片上传 */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e, 'image')}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={store.isStreaming}
            title="上传图片"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
          >
            <i className="fa-regular fa-image" />
          </button>

          {/* 文件上传 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e, 'file')}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={store.isStreaming}
            title="上传文件"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
          >
            <i className="fa-solid fa-paperclip" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            aria-label="输入消息"
            className="max-h-[20vh] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {store.isStreaming ? (
            // 流式期间显示停止按钮，避免重复发送
            <button
              onClick={store.stop}
              title="停止生成"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 transition-colors hover:bg-red-100 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!canSend || contextFull}
              title="发送（Ctrl+Enter）"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
            >
              <i className="fa-solid fa-paper-plane" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}