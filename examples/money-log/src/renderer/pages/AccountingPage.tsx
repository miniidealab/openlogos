import { useEffect, useState } from 'react';
import { useStore } from '../stores/appStore';

function AccountingPage() {
  const {
    categories,
    loadCategories,
    selectedCategoryId,
    setSelectedCategoryId,
    amount,
    setAmount,
    todayTotal,
    loadTodayTotal,
    showToast,
  } = useStore();

  const [remark, setRemark] = useState('');
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadCategories();
    loadTodayTotal();
  }, []);

  const isButtonDisabled = !selectedCategoryId || !amount || parseFloat(amount) <= 0;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/[^0-9.]/g, '');
    const parts = value.split('.');
    if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
    if (parts[1] && parts[1].length > 2) value = parts[0] + '.' + parts[1].substring(0, 2);
    setAmount(value);
  };

  const handleRemarkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (value.length > 200) {
      value = value.substring(0, 200);
    }
    setRemark(value);
  };

  const handleRecord = async () => {
    if (isButtonDisabled) return;

    const result = await window.electronAPI.saveRecord({
      amount: parseFloat(amount),
      category_id: selectedCategoryId!,
      remark: remark || undefined,
      created_at: recordDate + 'T12:00:00Z',
    });

    if (result.success) {
      showToast('已记录 ✓', 'success');
      setAmount('');
      setRemark('');
      setRecordDate(new Date().toISOString().slice(0, 10));
      loadTodayTotal();
    } else {
      showToast(result.message || '保存失败，请重试', 'error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Category Selection */}
      <div className="mb-6">
        <div className="text-sm text-[var(--text-muted)] font-medium mb-3">选择分类</div>
        <div className="flex flex-wrap gap-2.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`px-5 py-3 rounded-lg border transition-all min-w-[100px] flex items-center justify-center gap-2 ${
                selectedCategoryId === cat.id
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-md'
                  : 'bg-[var(--background)] border-[var(--border)] hover:border-[var(--secondary)] hover:bg-gray-50'
              }`}
            >
              <span>{cat.icon}</span>
              <span className="text-sm">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Date Picker */}
      <div className="mb-4">
        <div className="text-sm text-[var(--text-muted)] font-medium mb-3">日期</div>
        <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)]">
          <input
            type="date"
            value={recordDate}
            onChange={(e) => setRecordDate(e.target.value)}
            className="w-full text-sm bg-transparent outline-none"
          />
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <div className="text-sm text-[var(--text-muted)] font-medium mb-3">金额</div>
        <div className="bg-[var(--background)] rounded-xl p-6 border border-[var(--border)]">
          <div className="flex items-center bg-white rounded-lg border-2 border-[var(--border)] px-5 py-4 focus-within:border-[var(--primary)] focus-within:shadow-sm transition-all">
            <span className="text-2xl text-[var(--text-muted)] font-semibold mr-3 font-mono">¥</span>
            <input
              type="text"
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              className="flex-1 text-3xl font-semibold font-mono text-[var(--text)] outline-none bg-transparent placeholder:text-gray-300"
            />
          </div>
        </div>
      </div>

      {/* Remark Input */}
      <div className="mb-6">
        <div className="text-sm text-[var(--text-muted)] font-medium mb-3">备注（可选）</div>
        <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)]">
          <input
            type="text"
            value={remark}
            onChange={handleRemarkChange}
            placeholder="添加备注..."
            className="w-full text-sm text-[var(--text)] outline-none bg-transparent placeholder:text-gray-300"
            maxLength={200}
          />
          <div className="text-xs text-[var(--text-muted)] mt-2 text-right">{remark.length}/200</div>
        </div>
      </div>

      {/* Record Button */}
      <button
        onClick={handleRecord}
        disabled={isButtonDisabled}
        className={`w-full py-4 rounded-lg text-base font-semibold transition-all ${
          isButtonDisabled
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-[var(--primary)] text-white hover:bg-[var(--secondary)] hover:-translate-y-0.5 hover:shadow-md'
        }`}
      >
        记一笔
      </button>

      {/* Today Summary */}
      <div className="mt-5 p-4 bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] rounded-xl text-white flex justify-between items-center">
        <span className="opacity-80">今日支出</span>
        <span className="text-xl font-bold font-mono">¥{todayTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}

export default AccountingPage;