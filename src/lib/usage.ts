// 网页版每日 Token 用量限制（本地按日累计，0 点/跨天自动归零）
import { dbGet, dbPut } from './db';

/** 每日 Token 上限 */
export const DAILY_TOKEN_LIMIT = 100_000;

export interface DailyUsage {
  /** 本地时区日期 YYYY-MM-DD */
  date: string;
  /** 当日累计 token（prompt + completion） */
  tokens: number;
}

const USAGE_KEY = 'dailyUsage';

/** 当前本地日期键 */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 读取今日累计用量；记录日期非今天（跨天/首次）视为 0 */
export async function getTodayUsage(): Promise<DailyUsage> {
  const rec = await dbGet<{ key: 'dailyUsage'; value: DailyUsage }>('settings', USAGE_KEY);
  const key = todayKey();
  if (!rec?.value || rec.value.date !== key) return { date: key, tokens: 0 };
  return rec.value;
}

/** 累加今日用量并持久化，返回累计后的值（跨天自动从 0 起算；非有限值忽略） */
export async function addTodayTokens(delta: number): Promise<DailyUsage> {
  const cur = await getTodayUsage();
  const add = Number.isFinite(delta) ? Math.max(0, Math.round(delta)) : 0;
  const next: DailyUsage = {
    date: cur.date,
    tokens: Math.max(0, cur.tokens + add),
  };
  await dbPut('settings', { key: USAGE_KEY, value: next });
  return next;
}

/** 今日用量是否已达上限 */
export async function isOverDailyLimit(): Promise<boolean> {
  const u = await getTodayUsage();
  return u.tokens >= DAILY_TOKEN_LIMIT;
}
