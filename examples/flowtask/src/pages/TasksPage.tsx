import { useState } from "react";
import { useAppStore } from "../store/appStore";
import {
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  TaskItem,
  CommandError,
} from "../lib/ipc";
import CategoryManager from "../components/CategoryManager";

// ── 任务面板（新建 / 编辑）────────────────────────────────────
interface TaskPanelProps {
  task?: TaskItem;
  userId: number;
  onClose: () => void;
}

function TaskPanel({ task, userId, onClose }: TaskPanelProps) {
  const { prependTask, updateTask: storeUpdateTask, categories } = useAppStore();
  const [name, setName] = useState(task?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(task?.category_id ?? null);
  const [note, setNote] = useState(task?.note ?? "");
  const [nameError, setNameError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setNameError("任务名称不能为空"); return; }
    setNameError(""); setGeneralError("");
    setLoading(true);
    try {
      if (task) {
        const updated = await updateTask({
          task_id: task.id, name: name.trim(),
          category_id: categoryId, note: note.trim() || null,
        });
        storeUpdateTask(updated);
      } else {
        const created = await createTask({
          user_id: userId, name: name.trim(),
          category_id: categoryId, note: note.trim() || null,
        });
        prependTask(created);
      }
      onClose();
    } catch (err) {
      setGeneralError((err as CommandError).message ?? "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-[8px] border px-[10px] py-2 text-[13px] text-[#09090B] bg-white outline-none transition-all
    focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]
    ${hasErr ? "border-[#DC2626]" : "border-[#E4E4E7]"}`;

  return (
    <div className="w-[272px] border-l border-[#E4E4E7] bg-white flex flex-col flex-shrink-0">
      {/* 面板头部 */}
      <div className="flex items-center justify-between px-4 py-[14px] border-b border-[#E4E4E7]">
        <h2 className="text-[14px] font-semibold text-[#09090B]">
          {task ? "编辑任务" : "新建任务"}
        </h2>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#A1A1AA] hover:bg-[#E8ECF0] hover:text-[#09090B] transition-colors text-[16px]"
        >
          ×
        </button>
      </div>

      {/* 面板内容 */}
      <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-4 py-[14px] space-y-3">
        <div>
          <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">
            任务名称 <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            autoFocus maxLength={100} placeholder="输入任务名称"
            className={inputCls(!!nameError)}
          />
          {nameError && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-[#DC2626]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">分类</label>
          <select
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-[8px] border border-[#E4E4E7] px-[10px] py-2 text-[13px] text-[#09090B]
              outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)] bg-white transition-all"
          >
            <option value="">无分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">备注</label>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            maxLength={500} placeholder="添加备注（可选）"
            className="w-full rounded-[8px] border border-[#E4E4E7] px-[10px] py-2 text-[13px] text-[#09090B]
              outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)] resize-vertical min-h-[72px] bg-white transition-all"
          />
        </div>

        {generalError && <p className="text-[11px] text-[#DC2626]">{generalError}</p>}
      </form>

      {/* 面板底部按钮 */}
      <div className="flex gap-2 px-4 py-[10px] border-t border-[#E4E4E7]">
        <button
          type="button" onClick={onClose}
          className="px-[14px] py-2 bg-[#E8ECF0] hover:bg-[#E4E4E7] text-[#3F3F46] text-[13px] font-medium rounded-[8px] transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSave} disabled={loading}
          className="flex-1 py-2 bg-[#18181B] hover:opacity-[0.85] disabled:opacity-50
            text-white text-[13px] font-semibold rounded-[8px] transition-opacity"
        >
          {loading ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

// ── 确认删除对话框 ─────────────────────────────────────────────
function ConfirmDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25">
      <div className="bg-white rounded-[10px] border border-[#E4E4E7] shadow-[0_10px_32px_rgba(0,0,0,0.12)] px-[22px] pt-[22px] pb-[18px] w-[300px]">
        <p className="text-[14px] font-semibold text-[#09090B] mb-1.5">确认删除</p>
        <p className="text-[13px] text-[#71717A] mb-[18px] leading-[1.55]">确认删除该任务？此操作不可恢复。</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-[14px] py-[7px] bg-[#E8ECF0] hover:bg-[#E4E4E7] text-[#3F3F46] text-[13px] font-medium rounded-[8px] transition-colors">
            取消
          </button>
          <button onClick={onConfirm}
            className="px-[14px] py-[7px] bg-[#DC2626] hover:opacity-[0.88] text-white text-[13px] font-medium rounded-[8px] transition-opacity">
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 任务卡片 ──────────────────────────────────────────────────
function TaskCard({ task, categories, onEdit, onDelete }: {
  task: TaskItem;
  categories: { id: number; name: string }[];
  onEdit: (task: TaskItem) => void;
  onDelete: (task: TaskItem) => void;
}) {
  const storeUpdateStatus = useAppStore((s) => s.updateTaskStatus);

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await updateTaskStatus({ task_id: task.id, done: !task.done });
      storeUpdateStatus(task.id, !task.done);
    } catch { /* 静默 */ }
  }

  const catName = categories.find((c) => c.id === task.category_id)?.name;

  return (
    <div
      onClick={() => onEdit(task)}
      className={`flex items-start gap-2.5 px-3 py-[10px] border border-[#E4E4E7] rounded-[8px] mb-1.5
        cursor-pointer bg-white hover:border-[#D4D4D8] hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all group
        ${task.done ? "opacity-45" : ""}`}
    >
      {/* 勾选圆圈 */}
      <button
        onClick={handleToggle}
        className={`mt-0.5 w-[17px] h-[17px] rounded-full border-[1.5px] flex-shrink-0 flex items-center justify-center transition-all
          ${task.done
            ? "bg-[#18181B] border-[#18181B] text-white"
            : "border-[#E4E4E7] hover:border-[#2563EB]"}`}
      >
        {task.done && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </button>

      {/* 任务内容 */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-medium text-[#09090B] mb-[3px] ${task.done ? "line-through text-[#A1A1AA]" : ""}`}>
          {task.name}
        </p>
        {(catName || task.note) && (
          <div className="flex items-center gap-[5px] flex-wrap">
            {catName && (
              <span className="text-[11px] font-medium px-[7px] py-[1px] rounded-[20px] bg-[#E8ECF0] text-[#3F3F46] border border-[#E4E4E7]">
                {catName}
              </span>
            )}
            {task.note && (
              <span className="text-[11px] text-[#A1A1AA] truncate">{task.note}</span>
            )}
          </div>
        )}
      </div>

      {/* 删除按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(task); }}
        className="opacity-0 group-hover:opacity-100 text-[#D4D4D8] hover:text-[#DC2626] transition-all flex-shrink-0 flex items-center p-0.5"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  );
}

// ── 任务主界面 ────────────────────────────────────────────────
interface TasksPageProps {
  onSettings: () => void;
}

export default function TasksPage({ onSettings }: TasksPageProps) {
  const {
    currentUser, tasks, categories,
    currentCategory, setCurrentCategory,
    removeTask,
  } = useAppStore();

  const [panelTask, setPanelTask] = useState<TaskItem | undefined>(undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskItem | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const filteredTasks = currentCategory === null
    ? tasks
    : tasks.filter((t) => t.category_id === currentCategory);

  const pending = filteredTasks.filter((t) => !t.done);
  const done = filteredTasks.filter((t) => t.done);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteTask({ task_id: deleteTarget.id, user_id: currentUser!.user_id });
    } catch { /* TASK_NOT_FOUND 静默 */ }
    removeTask(deleteTarget.id);
    if (panelOpen && panelTask?.id === deleteTarget.id) setPanelOpen(false);
    setDeleteTarget(null);
  }

  // 侧边栏分类计数（未完成）
  const countAll = tasks.filter((t) => !t.done).length;

  const avatarLetter = currentUser?.username?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      {/* macOS 窗口 860×580 */}
      <div className="w-[860px] h-[580px] bg-white rounded-[12px] border border-[#E4E4E7]
        shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">

        {/* 标题栏 */}
        <div className="bg-[#F5F5F5] border-b border-[#E4E4E7] px-4 py-3 flex items-center gap-2 select-none flex-shrink-0">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F57] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#FEBC2E] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#28C840] border-[0.5px] border-black/10" />
          </div>
          <span className="flex-1 text-center text-[12px] font-medium text-[#71717A] mr-[54px]">FlowTask</span>
        </div>

        {/* 主体三栏 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 侧边栏 180px */}
          <aside className="w-[180px] bg-[#F4F4F5] border-r border-[#E4E4E7] flex flex-col flex-shrink-0">
            <p className="px-4 pt-[14px] pb-1.5 text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-[0.6px]">分类</p>

            {/* 全部 */}
            <button
              onClick={() => setCurrentCategory(null)}
              className={`flex items-center justify-between mx-2 px-3 py-[7px] rounded-[6px] text-[13px] font-medium transition-all
                ${currentCategory === null
                  ? "bg-white text-[#09090B] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  : "text-[#3F3F46] hover:bg-[#E8ECF0]"}`}
            >
              <span>全部</span>
              <span className={`text-[11px] font-medium px-1.5 py-[1px] rounded-[10px] min-w-[18px] text-center
                ${currentCategory === null ? "bg-[#E4E4E7] text-[#3F3F46]" : "bg-[#E8ECF0] text-[#A1A1AA]"}`}>
                {countAll}
              </span>
            </button>

            {/* 分类列表 */}
            {categories.map((c) => {
              const cnt = tasks.filter((t) => t.category_id === c.id && !t.done).length;
              return (
                <button
                  key={c.id}
                  onClick={() => setCurrentCategory(c.id)}
                  className={`flex items-center justify-between mx-2 px-3 py-[7px] rounded-[6px] text-[13px] font-medium transition-all truncate
                    ${currentCategory === c.id
                      ? "bg-white text-[#09090B] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                      : "text-[#3F3F46] hover:bg-[#E8ECF0]"}`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className={`text-[11px] font-medium px-1.5 py-[1px] rounded-[10px] min-w-[18px] text-center flex-shrink-0
                    ${currentCategory === c.id ? "bg-[#E4E4E7] text-[#3F3F46]" : "bg-[#E8ECF0] text-[#A1A1AA]"}`}>
                    {cnt}
                  </span>
                </button>
              );
            })}

            {/* 管理分类 */}
            <div className="mt-auto px-2 py-3 border-t border-[#E4E4E7]">
              <button
                onClick={() => setCategoryManagerOpen(true)}
                className="w-full px-[10px] py-[7px] border-[1.5px] border-dashed border-[#E4E4E7]
                  hover:border-[#2563EB] hover:text-[#2563EB] text-[#A1A1AA] text-[12px] font-medium
                  rounded-[8px] transition-all"
              >
                + 管理分类
              </button>
            </div>
          </aside>

          {/* 中央主内容区 */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* 顶栏 */}
            <header className="px-5 py-[14px] border-b border-[#E4E4E7] flex items-center justify-between flex-shrink-0">
              <h1 className="text-[16px] font-bold text-[#09090B] tracking-[-0.2px]">
                {currentCategory === null
                  ? "全部任务"
                  : categories.find((c) => c.id === currentCategory)?.name ?? "任务"}
              </h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSettings}
                  className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#71717A]
                    hover:bg-[#E8ECF0] hover:text-[#09090B] transition-colors"
                  title="账号设置"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
                <div
                  className="w-7 h-7 bg-[#18181B] rounded-full flex items-center justify-center
                    text-white text-[11px] font-semibold cursor-pointer"
                  title={currentUser?.username}
                >
                  {avatarLetter}
                </div>
              </div>
            </header>

            {/* 任务列表 */}
            <main className="flex-1 overflow-y-auto px-4 py-[10px]">
              {pending.length === 0 && done.length === 0 && (
                <div className="text-center py-[60px] text-[#A1A1AA]">
                  <svg className="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D4D4D8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  <p className="text-[13px]">还没有任务，点击 + 开始添加</p>
                </div>
              )}

              {pending.map((task) => (
                <TaskCard key={task.id} task={task} categories={categories}
                  onEdit={(t) => { setPanelTask(t); setPanelOpen(true); }}
                  onDelete={setDeleteTarget}
                />
              ))}

              {done.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-[0.5px] mt-[14px] mb-1.5">
                    已完成 ({done.length})
                  </p>
                  {done.map((task) => (
                    <TaskCard key={task.id} task={task} categories={categories}
                      onEdit={(t) => { setPanelTask(t); setPanelOpen(true); }}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </>
              )}
            </main>

            {/* FAB 按钮 */}
            <button
              onClick={() => { setPanelTask(undefined); setPanelOpen(true); }}
              className="absolute bottom-5 right-5 w-10 h-10 rounded-full bg-[#18181B]
                hover:scale-[1.06] text-white text-[20px] shadow-[0_4px_12px_rgba(0,0,0,0.15)]
                flex items-center justify-center transition-all leading-none"
            >
              +
            </button>
          </div>

          {/* 右侧任务面板 272px */}
          {panelOpen && currentUser && (
            <TaskPanel
              task={panelTask}
              userId={currentUser.user_id}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      </div>

      {/* 删除确认 */}
      {deleteTarget && (
        <ConfirmDialog
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 分类管理弹窗 */}
      {categoryManagerOpen && (
        <CategoryManager onClose={() => setCategoryManagerOpen(false)} />
      )}
    </div>
  );
}
