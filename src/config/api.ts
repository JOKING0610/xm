// 内置 API 提供方配置
// 密钥按用户明示需求自「新建文本文档.txt」硬编码于此（仅用于可变 API，勿外泄）。
import type { ProviderId, ProviderMeta } from '../types';

/** 内置提供方列表 */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'yunzhiapi',
    label: 'MiniMax-M3',
    baseURL: 'https://yunzhiapi.cn/v1',
    model: 'MiniMax-M3',
    apiKey: 'sk-Ugq5F4PTv3IOxKfNXqrqhVmsgIeDbgtjmojTM1EYm8SehQ20',
  },
  {
    id: 'agnes-ai',
    label: 'AGNES-3.0-Flash',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-3.0-flash',
    apiKey: 'sk-PYYijmjaNuvweucqyy1nKTTlmMXTo2Q7vKqKXROdMKANrhzb',
  },
];

/** 默认提供方 */
export const DEFAULT_PROVIDER: ProviderId = 'yunzhiapi';

/** 按 id 获取提供方配置 */
export function getProvider(id: ProviderId): ProviderMeta {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`未知的提供方: ${id}`);
  return p;
}

/**
 * 获取备用提供方（互为备份：yunzhiapi <-> agnes-ai）。
 * 用于主提供方请求失败时的自动回退。
 */
export function getBackupProvider(id: ProviderId): ProviderMeta {
  return id === 'yunzhiapi' ? getProvider('agnes-ai') : getProvider('yunzhiapi');
}