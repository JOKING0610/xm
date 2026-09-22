import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useChatStore } from '../hooks/useChatStore';

/** 删除确认模态窗 */
function DeleteConfirmModal({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="删除会话确认"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-red-50 text-red-500">
            <i className="fa-solid fa-triangle-exclamation" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">删除会话</h3>
            <p className="mt-0.5 max-w-[16rem] truncate text-sm text-slate-400">{title}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">删除后不可恢复，确定要删除这个会话吗？</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

/** 单条会话项：支持点击选中 / 双击重命名 / 悬停删除 / 流式转圈 / 未读绿点 */
function ConversationItem({
  c,
  active,
  streaming,
  unread,
  onSelect,
  onDelete,
  onRename,
}: {
  c: { id: string; title: string; updatedAt: number };
  active: boolean;
  streaming: boolean;
  unread: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.title);

  function startEdit() {
    setDraft(c.title);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== c.title) onRename(trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  return (
    <div
      key={c.id}
      onClick={onSelect}
      onDoubleClick={startEdit}
      className={`group flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-blue-50'
      }`}
    >
      {/* 会话图标：流式转圈 > 未读绿点 > 普通图标 */}
      {streaming ? (
        <i
          className="fa-solid fa-circle-notch fa-spin text-xs text-blue-500"
          aria-label="正在回复"
          title="正在回复"
        />
      ) : unread ? (
        <span
          className="size-2 shrink-0 rounded-full bg-green-500"
          aria-label="有新回复"
          title="有新回复"
        />
      ) : (
        <i className="fa-solid fa-comment text-xs" />
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-2 py-0.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
          aria-label="会话名称"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
      )}
      {!editing && (
        <>
          <i
            onClick={(e) => {
              e.stopPropagation();
              startEdit();
            }}
            title="重命名"
            className="fa-solid fa-pen cursor-pointer text-slate-300 transition-colors hover:text-blue-600"
          />
          <i
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
            className="fa-solid fa-trash cursor-pointer text-slate-300 transition-colors hover:text-red-500"
          />
        </>
      )}
    </div>
  );
}

export default function Sidebar({ open }: { open: boolean }) {
  const store = useChatStore();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  // 按更新时间倒序（最新会话在最上方）
  const sorted = [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  // 当前活跃会话是否为空（无任何消息）：是则禁用"新建对话"按钮
  // （注意：没有活跃会话时不应禁用，否则首次进入应用无法开始）
  const activeIsEmpty =
    !!store.activeConversation && store.activeConversation.messages.length === 0;
  const canCreateNew = !activeIsEmpty;

  return (
    <aside
      className={[
        // 移动端：fixed 抽屉 + 平移动画；桌面端：静态宽度收缩
        'fixed inset-y-0 left-0 z-40 flex h-full overflow-hidden border-r border-blue-100/70 bg-white/90 backdrop-blur md:static md:z-auto md:translate-x-0 md:transition-[width]',
        'transition-transform duration-300',
        open ? 'translate-x-0 md:w-64' : '-translate-x-full md:w-0',
      ].join(' ')}
    >
      {/* 固定内部宽度：桌面收起时由外层 w-0 + overflow-hidden 隐藏 */}
      <div className="flex h-full w-64 flex-col">
        {/* 顶部品牌区 */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img
            src="./avatar.jpg"
            alt="星梦"
            className="size-9 rounded-xl object-cover"
          />
          <span className="font-semibold text-slate-800">星梦</span>
        </div>

        {/* 新建对话：当前会话为空时禁用，避免创建多个空白对话 */}
        <div className="px-3">
          <button
            onClick={() => store.newConversation()}
            disabled={!canCreateNew}
            title={canCreateNew ? '新建对话' : '当前会话为空，无需新建'}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
              canCreateNew
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            <i className="fa-solid fa-plus" />
            新建对话
          </button>
        </div>

        {/* 会话列表 */}
        <div className="mt-3 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
          {sorted.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">暂无对话</p>
          ) : (
            sorted.map((c) => (
              <ConversationItem
                key={c.id}
                c={c}
                active={c.id === store.activeId}
                streaming={store.streamingIds.has(c.id)}
                unread={store.unreadIds.has(c.id)}
                onSelect={() => store.selectConversation(c.id)}
                onDelete={() => setPendingDelete({ id: c.id, title: c.title })}
                onRename={(title) => store.renameConversation(c.id, title)}
              />
            ))
          )}
        </div>
      </div>

      {/* 删除确认模态窗 */}
      {pendingDelete && (
        <DeleteConfirmModal
          title={pendingDelete.title}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            store.deleteConversation(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </aside>
  );
}