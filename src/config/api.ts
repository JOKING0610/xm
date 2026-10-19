// 内置模型配置
// 密钥按用户明示需求硬编码于此（仅用于可变 API，勿外泄）。
// 实测：agnes-ai.cn / apihub.agnes-ai.com 支持浏览器 CORS 直连；
//       yunzhiapi.cn 无 CORS 放行（OPTIONS 预检 404、POST 无 ACAO 头），浏览器直连会被拦截，
//       故 gemini 系走相对路径 /yunzhi-api（由 vite.config.ts 的 dev 代理转发到
//       https://yunzhiapi.cn）。生产静态部署需自建反代才能使用 gemini 系模型。
import type { ProviderId, ProviderMeta } from '../types';

/** 内置模型列表（每个条目 = 一个可切换模型） */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'agnes-cn',
    label: '星梦',
    baseURL: 'https://api.agnes-ai.cn/v1',
    model: 'agnes-3.0-flash',
    apiKey: 'sk-FfpfE5soCYWDcc7xgtsKacIbMSIX6U4np3p7vyfCCU0JUMDb',
    moderationSupported: false,
    supportsThinking: true,
    contextTokens: 512_000,
    maxOutputTokens: 64_000,
  },
  {
    id: 'gemini-3.8',
    label: 'Gemini-3.8-Flash',
    baseURL: '/yunzhi-api/v1',
    model: 'Gemini-3.8-Flash',
    apiKey: 'sk-nLJBba2R2xvTUYe7uGiE7xSprQSMFCmvcjwTxzVyfoEaKJ2e',
    moderationSupported: false,
    supportsThinking: false,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
  },
  {
    id: 'gemini-3.7',
    label: 'Gemini-3.7-Flash',
    baseURL: '/yunzhi-api/v1',
    model: 'Gemini-3.7-Flash',
    apiKey: 'sk-nLJBba2R2xvTUYe7uGiE7xSprQSMFCmvcjwTxzVyfoEaKJ2e',
    moderationSupported: false,
    supportsThinking: false,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
  },
  {
    id: 'gemini-3.6',
    label: 'Gemini-3.6-Flash',
    baseURL: '/yunzhi-api/v1',
    model: 'Gemini-3.6-Flash',
    apiKey: 'sk-nLJBba2R2xvTUYe7uGiE7xSprQSMFCmvcjwTxzVyfoEaKJ2e',
    moderationSupported: false,
    supportsThinking: false,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
  },
  {
    id: 'agnes-hub',
    label: 'Agnes 3.0 Flash',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-3.0-flash',
    apiKey: 'sk-PYYijmjaNuvweucqyy1nKTTlmMXTo2Q7vKqKXROdMKANrhzb',
    moderationSupported: false,
    supportsThinking: true,
    contextTokens: 512_000,
    maxOutputTokens: 64_000,
  },
];

/** 默认模型（星梦/agnes-cn：实测浏览器可直连且支持思考过程） */
export const DEFAULT_PROVIDER: ProviderId = 'agnes-cn';

/** 按 id 获取模型配置 */
export function getProvider(id: ProviderId): ProviderMeta {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`未知的模型: ${id}`);
  return p;
}

/** 判断任意值是否为合法的内置模型 id（用于恢复持久化数据时校验） */
export function isProviderId(v: unknown): v is ProviderId {
  return PROVIDERS.some((p) => p.id === v);
}
