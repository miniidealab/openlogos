import { useState } from 'react';
import { useStore } from '../stores/appStore';

function LockPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const { showToast, checkPasswordEnabled } = useStore();

  const handleInput = async (digit: string) => {
    if (password.length >= 6) return;
    
    const newPassword = password + digit;
    setPassword(newPassword);
    setError('');

    if (newPassword.length === 6) {
      try {
        const result = await window.electronAPI.verifyPassword({ password: newPassword });
        console.log('Verify result:', result);
        
        if (result.valid) {
          showToast('解锁成功 ✓', 'success');
          useStore.setState({ isLocked: false });
        } else {
          setError('密码错误');
          setShake(true);
          setTimeout(() => {
            setShake(false);
            setPassword('');
          }, 500);
        }
      } catch (e) {
        console.error('Verify error:', e);
        setError('验证失败');
        setPassword('');
      }
    }
  };

  const handleDelete = () => {
    setPassword(password.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPassword('');
    setError('');
  };

  const handleForgot = async () => {
    if (confirm('忘记密码将清除所有数据，是否继续？')) {
      await window.electronAPI.resetApp();
      showToast('数据已清除', 'success');
      checkPasswordEnabled({ syncLockState: true });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--primary)] to-[#0f172a] flex flex-col items-center justify-center">
      {/* Lock Icon */}
      <div className="w-24 h-24 bg-amber-500/20 rounded-3xl flex items-center justify-center mb-8">
        <span className="text-5xl">🔒</span>
      </div>

      {/* Title */}
      <h1 className="text-4xl font-bold text-white mb-3">轻记账</h1>
      <p className="text-white/50 text-base mb-12">输入密码解锁</p>

      {/* Password Dots */}
      <div className="flex gap-5 mb-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              i < password.length
                ? 'bg-[var(--cta)] border-[var(--cta)]'
                : 'bg-transparent border-white/30'
            }`}
          />
        ))}
      </div>

      {/* Error Message */}
      <div className={`text-base text-[var(--danger)] mb-6 min-h-6 ${shake ? 'animate-pulse' : ''}`}>
        {error}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-4 w-80">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map((key) => (
          <button
            key={key}
            onClick={() => {
              if (key === 'C') handleClear();
              else if (key === '⌫') handleDelete();
              else handleInput(String(key));
            }}
            className="py-6 text-3xl font-medium bg-white/10 rounded-2xl text-white hover:bg-white/20 active:bg-white/30 transition-colors"
          >
            {key}
          </button>
        ))}
      </div>

      {/* Forgot Link */}
      <button
        onClick={handleForgot}
        className="mt-10 text-[var(--cta)] text-base underline opacity-80 hover:opacity-100 transition-opacity"
      >
        忘记密码？
      </button>
    </div>
  );
}

export default LockPage;
