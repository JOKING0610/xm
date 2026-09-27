// 云智API 内容审核接口封装
import type { ProviderMeta } from '../types';
import { newIdempotencyKey } from './api';

export interface ModerationCategories {
  hate?: boolean;
  'hate/threatening'?: boolean;
  harassment?: boolean;
  'harassment/threatening'?: boolean;
  'self-harm'?: boolean;
  'self-harm/intent'?: boolean;
  'self-harm/instructions'?: boolean;
  sexual?: boolean;
  'sexual/minors'?: boolean;
  violence?: boolean;
  'violence/graphic'?: boolean;
  [key: string]: boolean | undefined;
}

export interface ModerationResult {
  flagged: boolean;
  categories: ModerationCategories;
  category_scores: Record<string, number>;
}

export interface ModerationResponse {
  id: string;
  model: string;
  results: ModerationResult[];
}

/** 内容审核：检测文本是否包含违规内容（不计费） */
export async function createModeration(
  provider: ProviderMeta,
  input: string | string[],
  opts?: { model?: string; signal?: AbortSignal },
): Promise<ModerationResponse> {
  const maxRetries = 5;
  let res: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const status = res?.status ?? 0;
      const retryable = res === null || status === 429 || (status >= 500 && status <= 599);
      if (!retryable) break;
      if (attempt === maxRetries) break;
      let retryAfter: number | null = null;
      const ra = res?.headers.get('Retry-After');
      if (ra) {
        const n = Number(ra);
        if (Number.isFinite(n)) retryAfter = n;
      }
      const exp = Math.min(0.5 * 2 ** (attempt - 1), 30);
      const base = retryAfter !== null && retryAfter > 0 ? retryAfter : exp;
      const delay = base * 1000 + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      res = await fetch(`${provider.baseURL}/moderations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          'X-Idempotency-Key': newIdempotencyKey(),
        },
        body: JSON.stringify({
          model: opts?.model ?? 'text-moderation-latest',
          input,
        }),
        signal: opts?.signal,
      });
    } catch {
      res = null;
    }
  }

  if (!res) throw new Error('网络请求失败');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`审核请求失败 (${res.status})${text ? `: ${text}` : ''}`);
  }
  return (await res.json()) as ModerationResponse;
}
