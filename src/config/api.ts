// 内置模型配置
// 密钥按用户明示需求硬编码于此（仅用于可变 API，勿外泄）。
// 实测：agnes-ai.cn / apihub.agnes-ai.com 支持浏览器 CORS 直连；
//       yunzhiapi.cn 已于 2026-10 复测开放 CORS（OPTIONS 预检 204、POST/流式均带
//       Access-Control-Allow-Origin: *），浏览器可直连 https://yunzhiapi.cn/v1。
//       旧版走相对路径 /yunzhi-api 依赖 vite dev 代理，生产静态部署（GitHub Pages）
//       无此代理 → nginx 对不存在的静态路径 POST 返回 405 Not Allowed，已废弃。
//       注：跨域响应默认只暴露 safelist 头，yunzhiapi 未设 Access-Control-Expose-Headers，
//       故 gemini 系读不到 X-Resume-Token，断点续传对其降级为"断开即重新生成"。
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
    baseURL: 'https://yunzhiapi.cn/v1',
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
    baseURL: 'https://yunzhiapi.cn/v1',
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
    baseURL: 'https://yunzhiapi.cn/v1',
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
