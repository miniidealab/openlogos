import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { createCategory, deleteCategory, CommandError } from "../lib/ipc";

interface ConfirmDeleteProps {
  name: string;
  taskCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDelete({ name, taskCount, onConfirm, onCancel }: ConfirmDeleteProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25">
      <div className="bg-white rounded-[10px] border border-[#E4E4E7] shadow-[0_10px_32px_rgba(0,0,0,0.12)] px-[22px] pt-[22px] pb-[18px] w-[300px]">
        <p className="text-[14px] font-semibold text-[#09090B] mb-1.5">删除分类</p>
        <p className="text-[13px] text-[#71717A] mb-[18px] leading-[1.55]">
          {taskCount > 0
            ? `该分类下有 ${taskCount} 个任务，删除后这些任务将变为未分类，是否继续？`
            : `确认删除分类「${name}」？`}
        </p>
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

interface CategoryManagerProps {
  onClose: () => void;
}

export default function CategoryManager({ onClose }: CategoryManagerProps) {
  const { currentUser, categories, tasks, addCategory, removeCategory } = useAppStore();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNameError("分类名称不能为空"); return; }
    if (categories.some((c) => c.name === trimmed)) { setNameError("该分类名称已存在"); return; }

    setNameError(""); setGeneralError("");
    setLoading(true);
    try {
      const created = await createCategory({ user_id: currentUser!.user_id, name: trimmed });
      addCategory(created);
      setName("");
    } catch (err) {
      const cmdErr = err as CommandError;
      if (cmdErr.code === "CATEGORY_EXISTS") setNameError("该分类名称已存在");
      else setGeneralError(cmdErr.message ?? "创建失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteCategory({ category_id: deleteTarget.id });
    } catch { /* 静默 */ }
    removeCategory(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25">
        <div className="bg-white rounded-[12px] border border-[#E4E4E7] shadow-[0_10px_40px_rgba(0,0,0,0.12)] w-[340px] flex flex-col max-h-[80vh] overflow-hidden">
          {/* 标题 */}
          <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-[#E4E4E7]">
            <h2 className="text-[14px] font-semibold text-[#09090B]">管理分类</h2>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#A1A1AA] hover:bg-[#E8ECF0] hover:text-[#09090B] transition-colors text-[16px]"
            >
              ×
            </button>
          </div>

          {/* 新增输入行 */}
          <div className="px-[18px] pt-4 pb-3">
            <form onSubmit={handleAdd} className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="输入分类名称" maxLength={20}
                  className={`w-full rounded-[8px] border px-[10px] py-2 text-[13px] text-[#09090B] outline-none transition-all
                    focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]
                    ${nameError ? "border-[#DC2626]" : "border-[#E4E4E7]"}`}
                />
                {nameError && <p className="mt-1 text-[12px] text-[#DC2626]">{nameError}</p>}
                {generalError && <p className="mt-1 text-[12px] text-[#DC2626]">{generalError}</p>}
              </div>
              <button
                type="submit" disabled={loading}
                className="px-[14px] py-2 bg-[#18181B] hover:opacity-[0.85] disabled:opacity-50
                  text-white text-[13px] font-medium rounded-[8px] transition-opacity flex-shrink-0"
              >
                添加
              </button>
            </form>
          </div>

          {/* 分类列表 */}
          <div className="flex-1 overflow-y-auto px-[18px] pb-4">
            {categories.length === 0 && (
              <p className="text-[13px] text-[#A1A1AA] py-2">暂无分类</p>
            )}
            {categories.map((c) => {
              const count = tasks.filter((t) => t.category_id === c.id).length;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2 border-b border-[#E4E4E7] last:border-b-0 text-[13px] font-medium text-[#09090B]"
                >
                  <span>{c.name}</span>
                  <div className="flex items-center gap-2">
                    {count > 0 && (
                      <span className="text-[12px] text-[#A1A1AA]">{count}</span>
                    )}
                    <button
                      onClick={() => setDeleteTarget({ id: c.id, name: c.name })}
                      className="w-[22px] h-[22px] flex items-center justify-center rounded-[4px]
                        text-[#D4D4D8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-all text-[14px]"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDelete
          name={deleteTarget.name}
          taskCount={tasks.filter((t) => t.category_id === deleteTarget.id).length}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
