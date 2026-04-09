import { useEffect } from 'react';
import { useStore } from './stores/appStore';
import AccountingPage from './pages/AccountingPage';
import StatisticsPage from './pages/StatisticsPage';
import SettingsPage from './pages/SettingsPage';
import LockPage from './pages/LockPage';
import Toast from './components/Toast';

function App() {
  const { currentPage, loadCategories, checkPasswordEnabled, passwordEnabled, isLocked } = useStore();

  useEffect(() => {
    checkPasswordEnabled({ syncLockState: true });
    loadCategories();
  }, []);

  if (passwordEnabled && isLocked) {
    return <LockPage />;
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Navigation */}
      <nav className="bg-[var(--primary)] px-4">
        <div className="flex">
          <button
            onClick={() => useStore.getState().setCurrentPage('accounting')}
            className={`px-5 py-3.5 text-sm border-b-2 transition-colors ${
              currentPage === 'accounting'
                ? 'text-white border-[var(--cta)]'
                : 'text-white/60 border-transparent hover:text-white'
            }`}
          >
            记账
          </button>
          <button
            onClick={() => useStore.getState().setCurrentPage('statistics')}
            className={`px-5 py-3.5 text-sm border-b-2 transition-colors ${
              currentPage === 'statistics'
                ? 'text-white border-[var(--cta)]'
                : 'text-white/60 border-transparent hover:text-white'
            }`}
          >
            统计
          </button>
          <button
            onClick={() => useStore.getState().setCurrentPage('settings')}
            className={`px-5 py-3.5 text-sm border-b-2 transition-colors ${
              currentPage === 'settings'
                ? 'text-white border-[var(--cta)]'
                : 'text-white/60 border-transparent hover:text-white'
            }`}
          >
            设置
          </button>
        </div>
      </nav>

      {/* Page Content */}
      <main>
        {currentPage === 'accounting' && <AccountingPage />}
        {currentPage === 'statistics' && <StatisticsPage />}
        {currentPage === 'settings' && <SettingsPage />}
      </main>

      {/* Toast */}
      <Toast />
    </div>
  );
}

export default App;
