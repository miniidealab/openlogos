import { invoke } from "@tauri-apps/api/core";

export interface UserSession {
  user_id: number;
  username: string;
  tasks: TaskItem[];
  categories: CategoryItem[];
}

export interface TaskItem {
  id: number;
  user_id: number;
  category_id: number | null;
  name: string;
  note: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryItem {
  id: number;
  name: string;
}

export interface CommandError {
  code: string;
  message: string;
}

export interface TaskStatusResult {
  task_id: number;
  done: boolean;
}

export interface SuccessResult {
  success: boolean;
}

// ── auth ──────────────────────────────────────────────────────
export async function checkHasUser(): Promise<{ has_user: boolean }> {
  return invoke("check_has_user");
}

export async function register(params: {
  username: string;
  password: string;
}): Promise<UserSession> {
  return invoke("register", { params });
}

export async function login(params: {
  username: string;
  password: string;
}): Promise<UserSession> {
  return invoke("login", { params });
}

// ── tasks ─────────────────────────────────────────────────────
export async function createTask(params: {
  user_id: number;
  name: string;
  category_id?: number | null;
  note?: string | null;
}): Promise<TaskItem> {
  return invoke("create_task", { params });
}

export async function updateTask(params: {
  task_id: number;
  name: string;
  category_id?: number | null;
  note?: string | null;
}): Promise<TaskItem> {
  return invoke("update_task", { params });
}

export async function updateTaskStatus(params: {
  task_id: number;
  done: boolean;
}): Promise<TaskStatusResult> {
  return invoke("update_task_status", { params });
}

export async function deleteTask(params: {
  task_id: number;
  user_id: number;
}): Promise<SuccessResult> {
  return invoke("delete_task", { params });
}

// ── categories ────────────────────────────────────────────────
export async function createCategory(params: {
  user_id: number;
  name: string;
}): Promise<CategoryItem> {
  return invoke("create_category", { params });
}

export async function deleteCategory(params: {
  category_id: number;
}): Promise<SuccessResult> {
  return invoke("delete_category", { params });
}

// ── S04 ───────────────────────────────────────────────────────
export async function changePassword(params: {
  user_id: number;
  current_password: string;
  new_password: string;
}): Promise<SuccessResult> {
  return invoke("change_password", { params });
}
