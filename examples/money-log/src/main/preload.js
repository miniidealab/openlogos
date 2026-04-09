const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Records
  saveRecord: (data) => ipcRenderer.invoke('records:save', data),
  getRecords: (filters) => ipcRenderer.invoke('records:list', filters),

  // Statistics
  getStatistics: (params) => ipcRenderer.invoke('statistics:get', params),

  // Categories
  getCategories: () => ipcRenderer.invoke('categories:list'),
  addCategory: (data) => ipcRenderer.invoke('categories:add', data),
  updateCategory: (data) => ipcRenderer.invoke('categories:update', data),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (data) => ipcRenderer.invoke('settings:set', data),

  // Auth
  verifyPassword: (data) => ipcRenderer.invoke('auth:verify-password', data),
  setPassword: (data) => ipcRenderer.invoke('auth:set-password', data),
  disablePassword: (data) => ipcRenderer.invoke('auth:disable-password', data),

  // App
  resetApp: () => ipcRenderer.invoke('app:reset'),
});
