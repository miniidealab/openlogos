import { create } from "zustand";
import { UserSession, TaskItem, CategoryItem } from "../lib/ipc";

interface AuthState {
  currentUser: { user_id: number; username: string } | null;
  tasks: TaskItem[];
  categories: CategoryItem[];
  setSession: (session: UserSession) => void;
  logout: () => void;
  // 任务操作
  addTask: (task: TaskItem) => void;
  updateTask: (task: TaskItem) => void;
  updateTaskStatus: (task_id: number, done: boolean) => void;
  removeTask: (task_id: number) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  tasks: [],
  categories: [],

  setSession: (session) =>
    set({
      currentUser: { user_id: session.user_id, username: session.username },
      tasks: session.tasks,
      categories: session.categories,
    }),

  logout: () => set({ currentUser: null, tasks: [], categories: [] }),

  addTask: (task) =>
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
}));
