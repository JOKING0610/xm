// 内置 API 提供方配置
// 密钥按用户明示需求自「新建文本文档.txt」硬编码于此（仅用于可变 API，勿外泄）。
import type { ProviderId, ProviderMeta } from '../types';

/** 内置提供方列表（仅保留 GLM-5.3-Flash，实测支持流式、原生视觉、思考强度与工具调用） */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'glm',
    label: 'GLM-5.3-Flash',
    baseURL: 'https://yunzhiapi.cn/v1',
    model: 'GLM-5.3-Flash',
    apiKey: 'sk-Ugq5F4PTv3IOxKfNXqrqhVmsgIeDbgtjmojTM1EYm8SehQ20',
  },
];

/** 默认提供方 */
export const DEFAULT_PROVIDER: ProviderId = 'glm';

/** 按 id 获取提供方配置 */
export function getProvider(id: ProviderId): ProviderMeta {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`未知的提供方: ${id}`);
  return p;
}
