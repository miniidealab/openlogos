import { create } from 'zustand';

interface Record {
  id: number;
  amount: number;
  category_id: number;
  category_name: string;
  category_icon: string;
  created_at: string;
  remark: string | null;
}

interface Category {
  id: number;
  name: string;
  icon: string;
  is_default: number;
  created_at: string;
}

interface Statistics {
  total: number;
  daily: { date: string; amount: number }[];
  by_category: { category_id: number; category_name: string; amount: number; percent: number }[];
}

interface CheckPasswordOptions {
  syncLockState?: boolean;
}

interface AppState {
  // UI State
  currentPage: 'accounting' | 'statistics' | 'settings';
  setCurrentPage: (page: 'accounting' | 'statistics' | 'settings') => void;

  // Categories
  categories: Category[];
  loadCategories: () => Promise<void>;

  // Selected Category
  selectedCategoryId: number | null;
  setSelectedCategoryId: (id: number | null) => void;

  // Amount
  amount: string;
  setAmount: (amount: string) => void;

  // Records
  todayTotal: number;
  loadTodayTotal: () => Promise<void>;

  // Statistics
  statistics: Statistics | null;
  statisticsTimeRange: 'week' | 'month' | 'custom';
  statisticsMonth: string;
  loadStatistics: () => Promise<void>;

  // Password
  passwordEnabled: boolean;
  isLocked: boolean;
  checkPasswordEnabled: (options?: CheckPasswordOptions) => Promise<void>;

  // Toast
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

declare global {
  interface Window {
    electronAPI: {
      saveRecord: (data: { amount: number; category_id: number; remark?: string }) => Promise<{ success: boolean; id?: number; code?: string; message?: string }>;
      getRecords: (filters?: { start_date?: string; end_date?: string; category_id?: number }) => Promise<Record[]>;
      getStatistics: (params: { time_range: string; month?: string; start_date?: string; end_date?: string; category_id?: number }) => Promise<Statistics>;
      getCategories: () => Promise<Category[]>;
      addCategory: (data: { name: string }) => Promise<{ success: boolean; id?: number; code?: string; message?: string }>;
      updateCategory: (data: { id: number; name: string }) => Promise<{ success: boolean; code?: string; message?: string }>;
      deleteCategory: (id: number) => Promise<{ success: boolean; code?: string; message?: string }>;
      getSetting: (key: string) => Promise<{ key: string; value: string }>;
      setSetting: (data: { key: string; value: string }) => Promise<{ success: boolean }>;
      verifyPassword: (data: { password: string }) => Promise<{ valid: boolean; code?: string; message?: string }>;
      setPassword: (data: { password: string }) => Promise<{ success: boolean; code?: string; message?: string }>;
      disablePassword: (data: { password: string }) => Promise<{ success: boolean; code?: string; message?: string }>;
      resetApp: () => Promise<{ success: boolean }>;
    };
  }
}

export const useStore = create<AppState>((set, get) => ({
  // UI State
  currentPage: 'accounting',
  setCurrentPage: (page) => set({ currentPage: page }),

  // Categories
  categories: [],
  loadCategories: async () => {
    const categories = await window.electronAPI.getCategories();
    set({ categories });
  },

  // Selected Category
  selectedCategoryId: null,
  setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),

  // Amount
  amount: '',
  setAmount: (amount) => set({ amount }),

  // Records
  todayTotal: 0,
  loadTodayTotal: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const stats = await window.electronAPI.getStatistics({
      time_range: 'custom',
      start_date: today + 'T00:00:00Z',
      end_date: today + 'T23:59:59Z',
    });
    set({ todayTotal: stats.total });
  },

  // Statistics
  statistics: null,
  statisticsTimeRange: 'month',
  statisticsMonth: new Date().toISOString().slice(0, 7),
  loadStatistics: async () => {
    const { statisticsTimeRange, statisticsMonth } = get();
    const stats = await window.electronAPI.getStatistics({
      time_range: statisticsTimeRange,
      month: statisticsTimeRange === 'month' ? statisticsMonth : undefined,
    });
    set({ statistics: stats });
  },

  // Password
  passwordEnabled: false,
  isLocked: false,
  checkPasswordEnabled: async (options: CheckPasswordOptions = {}) => {
    const { syncLockState = false } = options;
    try {
      const result = await window.electronAPI.getSetting('password_enabled');
      const enabled = result.value === '1';
      set((state) => ({
        passwordEnabled: enabled,
        isLocked: syncLockState ? enabled : enabled ? state.isLocked : false,
      }));
    } catch (e) {
      set({ passwordEnabled: false, isLocked: false });
    }
  },

  // Toast
  toast: null,
  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 1500);
  },
}));
