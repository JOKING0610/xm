import { useState, useEffect } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { downloadApk } from '../lib/apk';

/**
 * 每日用量上限提醒模态框：
 * 网页版每日 1M Token 用尽后禁止继续发送，弹窗说明用量并引导下载 App。
 */
export default function UsageLimitModal() {
  const store = useChatStore();
  const [downloading, setDownloading] = useState(false);

  // 打开时锁定滚动并监听 Esc 关闭
  useEffect(() => {
    if (!store.limitModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeLimitModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store.limitModalOpen, store]);

  if (!store.limitModalOpen) return null;

  async function handleDownload(): Promise<void> {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadApk();
    } finally {
      setDownloading(false);
    }
  }

  const used = store.todayUsage.tokens;
  const limit = store.dailyTokenLimit;
  const over = used >= limit;
  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={store.closeLimitModal}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-limit-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部图标区 */}
        <div className="flex flex-col items-center px-6 pt-8 pb-2">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-orange-500/30">
            <i className="fa-solid fa-gauge-high text-2xl text-white" />
          </div>
          <h2
            id="usage-limit-title"
            className="text-lg font-bold text-slate-800 dark:text-slate-100"
          >
            {over ? '今日用量已达上限' : '每日用量提醒'}
          </h2>
          <p className="mt-2 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
            网页版每日最多使用{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {fmt(limit)} Token
            </span>
            ，今天已使用{' '}
            <span className="font-semibold text-orange-500">{fmt(used)}</span>。
            <br />
            {over
              ? '用量已达上限，明日 00:00 重置后可继续在网页版使用。'
              : '用量将于明日 00:00 重置。'}
          </p>
        </div>

        {/* 用量进度条 */}
        <div className="px-6 pt-3">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
              style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
            />
          </div>
        </div>

        {/* App 引导卡片 */}
        <div className="mx-6 mt-5 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-500/25 dark:bg-blue-500/10">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm">
              <i className="fa-solid fa-mobile-screen-button" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                推荐下载 App 使用
              </p>
              <p className="mt-1 text-xs leading-5 text-blue-600/80 dark:text-blue-300/70">
                App 端不受网页版每日额度限制。
              </p>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2.5 px-6 pt-5 pb-6">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] disabled:opacity-60"
          >
            <i className={downloading ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-download'} />
            {downloading ? '下载中…' : '下载 App'}
          </button>
          <button
            type="button"
            onClick={store.closeLimitModal}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
