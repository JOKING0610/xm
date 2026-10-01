import { useEffect } from 'react';
import { useChatStore } from '../hooks/useChatStore';

/**
 * 今日用量模态框：点击输入框上方「上下文」胶囊打开，
 * 展示今日 Token 用量、每日上限与进度条。
 */
export default function UsageModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const store = useChatStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const used = store.todayUsage.tokens;
  const limit = store.dailyTokenLimit;
  const pct = Math.min(100, (used / limit) * 100);
  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center px-6 pt-8 pb-2">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
            <i className="fa-solid fa-chart-pie text-2xl text-white" />
          </div>
          <h2
            id="usage-modal-title"
            className="text-lg font-bold text-slate-800 dark:text-slate-100"
          >
            今日用量
          </h2>
          <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">
            今日已使用{' '}
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {fmt(used)}
            </span>{' '}
            / 每日上限{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {fmt(limit)}
            </span>{' '}
            Token
          </p>
        </div>

        <div className="px-6 pt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>已用 {pct.toFixed(1)}%</span>
            <span>剩余 {fmt(Math.max(0, limit - used))} Token</span>
          </div>
        </div>

        <div className="px-6 pt-4 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
