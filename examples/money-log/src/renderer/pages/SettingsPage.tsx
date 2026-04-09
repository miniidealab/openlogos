import { useState, useEffect } from 'react';
import { useStore } from '../stores/appStore';

function SettingsPage() {
  const { categories, loadCategories, checkPasswordEnabled, passwordEnabled, showToast } = useStore();
  const [localPasswordEnabled, setLocalPasswordEnabled] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  useEffect(() => {
    loadCategories();
    setLocalPasswordEnabled(passwordEnabled);
  }, [passwordEnabled]);

  const handleTogglePassword = async () => {
    if (!localPasswordEnabled) {
      setShowPasswordModal(true);
    } else {
      setShowPasswordModal(true);
    }
  };

  const handleSetPassword = async () => {
    if (password.length < 6) {
      setPasswordError('密码至少6位');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('两次密码不一致');
      return;
    }
    if (!/^\d+$/.test(password)) {
      setPasswordError('密码必须为数字');
      return;
    }

    const result = await window.electronAPI.setPassword({ password });
    if (result.success) {
      showToast('密码锁已开启', 'success');
      setLocalPasswordEnabled(true);
      useStore.setState({ passwordEnabled: true, isLocked: false });
      checkPasswordEnabled();
      closeModal();
    } else {
      setPasswordError(result.message || '设置失败');
    }
  };

  const handleDisablePassword = async () => {
    const result = await window.electronAPI.disablePassword({ password });
    if (result.success) {
      showToast('密码锁已关闭', 'success');
      setLocalPasswordEnabled(false);
      useStore.setState({ passwordEnabled: false, isLocked: false });
      checkPasswordEnabled();
      closeModal();
    } else {
      setPasswordError(result.message || '密码错误');
    }
  };

  const closeModal = () => {
    setShowPasswordModal(false);
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const closeCategoryModal = () => {
    setShowCategoryModal(false);
    setNewCategoryName('');
    setCategoryError('');
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      setCategoryError('请输入分类名称');
      return;
    }
    const result = await window.electronAPI.addCategory({ name: newCategoryName.trim() });
    if (result.success) {
      showToast('分类已添加', 'success');
      loadCategories();
      closeCategoryModal();
    } else {
      setCategoryError(result.message || '添加失败');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Password Lock Setting */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-3">
          <span className="w-1 h-6 bg-[var(--cta)] rounded"></span>
          密码锁设置
        </h2>
        
        <div className="bg-[var(--background)] rounded-xl p-5 border border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">开启密码锁</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">打开应用时需要输入密码</div>
            </div>
            <div
              className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${
                localPasswordEnabled ? 'bg-[var(--success)]' : 'bg-gray-300'
              }`}
              onClick={handleTogglePassword}
            >
              <div
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  localPasswordEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Category Management */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-3">
          <span className="w-1 h-6 bg-[var(--cta)] rounded"></span>
          分类管理
        </h2>

        <div className="space-y-2">
          <div className="text-xs uppercase text-[var(--text-muted)] tracking-wide mb-3">预设分类</div>
          {categories.filter((c) => c.is_default).map((cat) => (
            <div
              key={cat.id}
              className="flex items-center px-4 py-3.5 bg-[var(--background)] rounded-lg"
            >
              <span className="text-lg mr-3.5 w-7 text-center">{cat.icon}</span>
              <span className="flex-1 text-sm font-medium">{cat.name}</span>
              <span className="text-xs text-gray-400">不可删除</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 mt-4">
          <div className="text-xs uppercase text-[var(--text-muted)] tracking-wide mb-3">自定义分类</div>
          {categories.filter((c) => !c.is_default).length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] text-center py-4">暂无自定义分类</div>
          ) : (
            categories
              .filter((c) => !c.is_default)
              .map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center px-4 py-3.5 bg-white border border-[var(--border)] rounded-lg"
                >
                  <span className="text-lg mr-3.5 w-7 text-center">{cat.icon}</span>
                  <span className="flex-1 text-sm font-medium">{cat.name}</span>
                  <button
                    onClick={async () => {
                      if (confirm('确定删除分类「' + cat.name + '」吗？')) {
                        await window.electronAPI.deleteCategory(cat.id);
                        loadCategories();
                        showToast('分类已删除', 'success');
                      }
                    }}
                    className="text-xs text-[var(--danger)] hover:bg-red-50 px-3 py-1.5 rounded transition-colors"
                  >
                    删除
                  </button>
                </div>
              ))
          )}
        </div>

        <button
          onClick={() => setShowCategoryModal(true)}
          className="w-full mt-4 py-3.5 border-2 border-dashed border-[var(--border)] rounded-lg text-[var(--secondary)] text-sm font-medium hover:border-[var(--secondary)] hover:bg-blue-50 transition-colors"
        >
          + 新增分类
        </button>
      </div>

      {/* Add Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeCategoryModal}>
          <div className="bg-white rounded-xl p-6 w-[340px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold mb-5">新增分类</div>
            
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="请输入分类名称"
              className="w-full px-4 py-3 border border-[var(--border)] rounded-lg mb-3 text-sm"
              autoFocus
            />
            
            <div className="text-xs text-[var(--danger)] mb-4 min-h-[18px]">{categoryError}</div>
            
            <div className="flex gap-3">
              <button
                onClick={closeCategoryModal}
                className="flex-1 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm"
              >
                取消
              </button>
              <button
                onClick={handleAddCategory}
                className="flex-1 py-3 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-white rounded-xl p-6 w-[340px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold mb-5">
              {localPasswordEnabled ? '关闭密码锁' : '设置密码'}
            </div>
            
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={localPasswordEnabled ? '请输入原密码' : '请输入密码（6位数字）'}
              className="w-full px-4 py-3 border border-[var(--border)] rounded-lg mb-3 text-sm"
              maxLength={6}
            />
            
            {!localPasswordEnabled && (
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请确认密码"
                className="w-full px-4 py-3 border border-[var(--border)] rounded-lg mb-3 text-sm"
                maxLength={6}
              />
            )}
            
            <div className="text-xs text-[var(--danger)] mb-4 min-h-[18px]">{passwordError}</div>
            
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm"
              >
                取消
              </button>
              <button
                onClick={localPasswordEnabled ? handleDisablePassword : handleSetPassword}
                className="flex-1 py-3 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
