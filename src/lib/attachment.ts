// 附件类型判定（InputBar / Message 共用）

/** 常见图片扩展名（补充 MIME 为空的场景） */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i;

/** 按 MIME/文件名判断是否为图片类型文件 */
export function isImageFileMeta(mime: string, name: string): boolean {
  return mime.startsWith('image/') || IMAGE_EXT_RE.test(name);
}

/** 判断 File 是否为图片类型文件（MIME 或扩展名命中即算） */
export function isImageFile(f: File): boolean {
  return isImageFileMeta(f.type, f.name);
}
