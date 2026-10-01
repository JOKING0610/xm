// 每日用量统计单元测试（测试环境无 IndexedDB，db 自动回退 localStorage）
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_TOKEN_LIMIT,
  addTodayTokens,
  getTodayUsage,
  isOverDailyLimit,
  todayKey,
} from './usage';

describe('usage 每日用量', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('todayKey 输出本地时区 YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('无记录时今日用量为 0', async () => {
    expect(await getTodayUsage()).toEqual({ date: todayKey(), tokens: 0 });
    expect(await isOverDailyLimit()).toBe(false);
  });

  it('累加并返回累计值', async () => {
    expect(await addTodayTokens(300)).toMatchObject({ tokens: 300 });
    expect(await addTodayTokens(700)).toMatchObject({ tokens: 1000 });
    expect((await getTodayUsage()).tokens).toBe(1000);
  });

  it('非数字/负值输入被忽略或归零', async () => {
    await addTodayTokens(500);
    // NaN/非有限值不写入，保持原值
    expect(await addTodayTokens(Number.NaN)).toMatchObject({ tokens: 500 });
    // 负数按 0 累加（忽略），不会凭空扣减总量，也不会为负
    expect(await addTodayTokens(-999_999)).toMatchObject({ tokens: 500 });
    expect((await getTodayUsage()).tokens).toBeGreaterThanOrEqual(0);
  });

  it('跨天记录视为 0 并重新起算', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = todayKey(yesterday);
    localStorage.setItem(
      'xingmeng:settings:dailyUsage',
      JSON.stringify({ key: 'dailyUsage', value: { date: yKey, tokens: 999_999 } }),
    );
    expect(await getTodayUsage()).toEqual({ date: todayKey(), tokens: 0 });
    expect(await isOverDailyLimit()).toBe(false);
    // 今日重新累计
    expect(await addTodayTokens(10)).toMatchObject({ date: todayKey(), tokens: 10 });
  });

  it('达到上限后 isOverDailyLimit 为 true（含恰好等于上限）', async () => {
    await addTodayTokens(DAILY_TOKEN_LIMIT - 1);
    expect(await isOverDailyLimit()).toBe(false);
    await addTodayTokens(1);
    expect(await isOverDailyLimit()).toBe(true);
    // 超限后继续累计仍为 true
    await addTodayTokens(100);
    expect(await isOverDailyLimit()).toBe(true);
  });
});
