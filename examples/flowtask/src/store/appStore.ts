import { create } from "zustand";
import { UserSession, TaskItem, CategoryItem } from "../lib/ipc";

interface AppState {
  currentUser: { user_id: number; username: string } | null;
  tasks: TaskItem[];
  categories: CategoryItem[];
  currentCategory: number | null; // S03.2 筛选状态

  // 会话
  setSession: (session: UserSession) => void;
  logout: () => void;

  // 任务
  prependTask: (task: TaskItem) => void;
  updateTask: (task: TaskItem) => void;
  updateTaskStatus: (task_id: number, done: boolean) => void;
  removeTask: (task_id: number) => void;

  // 分类
  addCategory: (category: CategoryItem) => void;
  removeCategory: (category_id: number) => void;
  setCurrentCategory: (category_id: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  tasks: [],
  categories: [],
  currentCategory: null,

  setSession: (session) =>
    set({
      currentUser: { user_id: session.user_id, username: session.username },
      tasks: session.tasks,
      categories: session.categories,
      currentCategory: null,
    }),

  logout: () =>
    set({ currentUser: null, tasks: [], categories: [], currentCategory: null }),

  prependTask: (task) =>
    set((s) => ({ tasks: [task, ...s.tasks] })),

  updateTask: (task) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  updateTaskStatus: (task_id, done) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task_id ? { ...t, done } : t)),
    })),

  removeTask: (task_id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task_id) })),

  addCategory: (category) =>
    set((s) => ({ categories: [...s.categories, category] })),

  // S03.3 Step 9: 删除分类后将关联任务的 category_id 置 null
  removeCategory: (category_id) =>
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== category_id),
      tasks: s.tasks.map((t) =>
        t.category_id === category_id ? { ...t, category_id: null } : t
      ),
      // 若当前正在筛选该分类，切回"全部"
      currentCategory:
        s.currentCategory === category_id ? null : s.currentCategory,
    })),

  setCurrentCategory: (category_id) =>
    set({ currentCategory: category_id }),
}));
