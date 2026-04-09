const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');

let mainWindow;
let db;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  db = new Database();
  await db.init();
  createWindow();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

function registerIpcHandlers() {
  // Records
  ipcMain.handle('records:save', async (event, data) => {
    try {
      const result = db.saveRecord(data.amount, data.category_id, data.remark, data.created_at);
      return { success: true, id: result };
    } catch (error) {
      return { code: 'RECORD_SAVE_FAILED', message: error.message };
    }
  });

  ipcMain.handle('records:list', async (event, filters) => {
    try {
      const records = db.getRecords(filters);
      return records;
    } catch (error) {
      return { code: 'RECORD_LIST_FAILED', message: error.message };
    }
  });

  // Statistics
  ipcMain.handle('statistics:get', async (event, params) => {
    try {
      const stats = db.getStatistics(params);
      return stats;
    } catch (error) {
      return { code: 'STATISTICS_GET_FAILED', message: error.message };
    }
  });

  // Categories
  ipcMain.handle('categories:list', async () => {
    try {
      const categories = db.getCategories();
      return categories;
    } catch (error) {
      return { code: 'CATEGORIES_LIST_FAILED', message: error.message };
    }
  });

  ipcMain.handle('categories:add', async (event, data) => {
    try {
      const result = db.addCategory(data.name);
      return { success: true, id: result };
    } catch (error) {
      return { code: 'CATEGORY_ADD_FAILED', message: error.message };
    }
  });

  ipcMain.handle('categories:update', async (event, data) => {
    try {
      db.updateCategory(data.id, data.name);
      return { success: true };
    } catch (error) {
      return { code: 'CATEGORY_UPDATE_FAILED', message: error.message };
    }
  });

  ipcMain.handle('categories:delete', async (event, id) => {
    try {
      db.deleteCategory(id);
      return { success: true };
    } catch (error) {
      return { code: 'CATEGORY_DELETE_FAILED', message: error.message };
    }
  });

  // Settings
  ipcMain.handle('settings:get', async (event, key) => {
    try {
      const value = db.getSetting(key);
      return { key, value };
    } catch (error) {
      return { code: 'SETTINGS_GET_FAILED', message: error.message };
    }
  });

  ipcMain.handle('settings:set', async (event, data) => {
    try {
      db.setSetting(data.key, data.value);
      return { success: true };
    } catch (error) {
      return { code: 'SETTINGS_SET_FAILED', message: error.message };
    }
  });

  // Auth
  ipcMain.handle('auth:verify-password', async (event, data) => {
    try {
      const valid = db.verifyPassword(data.password);
      return { valid };
    } catch (error) {
      return { code: 'PASSWORD_VERIFY_FAILED', message: error.message };
    }
  });

  ipcMain.handle('auth:set-password', async (event, data) => {
    try {
      console.log('[IPC] setPassword called with:', data.password);
      db.setPassword(data.password);
      console.log('[IPC] setPassword completed');
      return { success: true };
    } catch (error) {
      console.error('[IPC] setPassword error:', error);
      return { code: 'PASSWORD_SET_FAILED', message: error.message };
    }
  });

  ipcMain.handle('auth:disable-password', async (event, data) => {
    try {
      const valid = db.verifyPassword(data.password);
      if (!valid) {
        return { code: 'PASSWORD_INCORRECT', message: '密码错误' };
      }
      db.setSetting('password_enabled', '0');
      return { success: true };
    } catch (error) {
      return { code: 'PASSWORD_DISABLE_FAILED', message: error.message };
    }
  });

  // App
  ipcMain.handle('app:reset', async () => {
    try {
      db.resetApp();
      return { success: true };
    } catch (error) {
      return { code: 'APP_RESET_FAILED', message: error.message };
    }
  });
}
