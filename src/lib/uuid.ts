/**
 * 生成 UUID v4。
 * 优先使用 crypto.randomUUID（仅 HTTPS / localhost 安全上下文可用），
 * 否则回退到 Math.random 实现，保证 http / 旧环境不抛错。
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}