// 内置 API 提供方配置
// 密钥按用户明示需求硬编码于此（仅用于可变 API，勿外泄）。
// DeepSeek 官方接口实测支持 CORS 动态放行，浏览器可直连，无需代理。
import type { ProviderId, ProviderMeta } from '../types';

/** 内置提供方列表（仅保留 deepseek-flash，实测支持流式与原生视觉） */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek-Flash',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    apiKey: 'sk-e29dcfc0dd5841dd969d2db929888238',
    // DeepSeek 官方无 /v1/moderations 端点（实测 404），跳过审核请求避免控制台报错
    moderationSupported: false,
  },
];

/** 默认提供方 */
export const DEFAULT_PROVIDER: ProviderId = 'deepseek';

/** 按 id 获取提供方配置 */
export function getProvider(id: ProviderId): ProviderMeta {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`未知的提供方: ${id}`);
  return p;
}
