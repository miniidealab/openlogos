import { useEffect, useState } from 'react';
import { useStore } from '../stores/appStore';

interface Record {
  id: number;
  amount: number;
  category_id: number;
  category_name: string;
  category_icon: string;
  created_at: string;
  remark: string | null;
}

function StatisticsPage() {
  const {
    statistics,
    statisticsTimeRange,
    setStatisticsTimeRange,
    statisticsMonth,
    setStatisticsMonth,
    loadStatistics,
    categories,
    loadCategories,
  } = useStore();

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    loadStatistics();
    loadCategories();
  }, [statisticsTimeRange, statisticsMonth, selectedCategoryId]);

  useEffect(() => {
    loadRecords();
  }, [statisticsTimeRange, statisticsMonth, selectedCategoryId, showDetail]);

  const loadRecords = async () => {
    if (!showDetail) return;
    
    let startDate = '';
    let endDate = '';
    const now = new Date();
    
    if (statisticsTimeRange === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = weekAgo.toISOString();
      endDate = now.toISOString();
    } else if (statisticsTimeRange === 'month' && statisticsMonth) {
      const [year, month] = statisticsMonth.split('-');
      startDate = `${year}-${month}-01T00:00:00Z`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      endDate = `${year}-${month}-${lastDay}T23:59:59Z`;
    } else if (statisticsTimeRange === 'custom') {
      // For custom, use current month as default
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00Z`;
      endDate = now.toISOString();
    }

    const result = await window.electronAPI.getRecords({
      start_date: startDate,
      end_date: endDate,
      category_id: selectedCategoryId || undefined,
    });
    
    if (Array.isArray(result)) {
      setRecords(result);
    }
  };

  const handleTimeRangeChange = (range: 'week' | 'month' | 'custom') => {
    setStatisticsTimeRange(range);
  };

  const handleCategoryChange = (categoryId: number | null) => {
    setSelectedCategoryId(categoryId);
  };

  const maxDailyAmount = statistics?.daily.reduce((max, d) => Math.max(max, d.amount), 0) || 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Time Filter */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <button
          onClick={() => handleTimeRangeChange('week')}
          className={`px-4 py-2 rounded-md border text-sm transition-colors ${
            statisticsTimeRange === 'week'
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--primary)]'
          }`}
        >
          本周
        </button>
        <button
          onClick={() => handleTimeRangeChange('month')}
          className={`px-4 py-2 rounded-md border text-sm transition-colors ${
            statisticsTimeRange === 'month'
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--primary)]'
          }`}
        >
          本月
        </button>
        <button
          onClick={() => handleTimeRangeChange('custom')}
          className={`px-4 py-2 rounded-md border text-sm transition-colors ${
            statisticsTimeRange === 'custom'
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--primary)]'
          }`}
        >
          自定义
        </button>
        
        {statisticsTimeRange === 'month' && (
          <select
            value={statisticsMonth}
            onChange={(e) => setStatisticsMonth(e.target.value)}
            className="ml-auto px-3 py-2 border border-[var(--border)] rounded-md text-sm bg-white"
          >
            <option>2026-04</option>
            <option>2026-03</option>
            <option>2026-02</option>
          </select>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => handleCategoryChange(null)}
          className={`px-3.5 py-1.5 rounded-full border text-sm transition-colors ${
            selectedCategoryId === null
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'bg-[var(--background)] border-[var(--border)]'
          }`}
        >
          全部
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`px-3.5 py-1.5 rounded-full border text-sm transition-colors ${
              selectedCategoryId === cat.id
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-[var(--background)] border-[var(--border)]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Chart Area */}
      <div className="bg-[var(--background)] rounded-xl p-6 mb-6 border border-[var(--border)]">
        <div className="text-sm text-[var(--text-muted)] mb-5 font-medium">
          {statisticsMonth || '本周'} 支出趋势
        </div>
        
        {statistics && statistics.daily.length > 0 ? (
          <div className="h-44 flex items-end justify-between gap-3 px-2">
            {statistics.daily.map((day) => (
              <div key={day.date} className="flex flex-col items-center flex-1">
                <div
                  className="w-full max-w-[48px] bg-gradient-to-t from-[var(--cta)] to-amber-600 rounded-t-md transition-all relative"
                  style={{
                    height: maxDailyAmount > 0 ? `${(day.amount / maxDailyAmount) * 160}px` : '0px',
                  }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-[var(--text-muted)] opacity-0 hover:opacity-100 whitespace-nowrap">
                    ¥{day.amount.toFixed(0)}
                  </span>
                </div>
                <span className="text-xs text-[var(--text-muted)] mt-2 text-center">
                  {day.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <div className="text-4xl mb-3">📊</div>
            <div>该时间段暂无记录，开始记账吧</div>
          </div>
        )}
      </div>

      {/* Stats List */}
      {statistics && statistics.by_category.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden mb-6">
          {statistics.by_category.map((cat) => (
            <div
              key={cat.category_id}
              className="flex items-center px-5 py-4 border-b border-[var(--border)] last:border-b-0 hover:bg-gray-50 transition-colors"
            >
              <span className="text-xl mr-4 w-8 text-center">
                {categories.find((c) => c.id === cat.category_id)?.icon || '📦'}
              </span>
              <span className="flex-1 text-sm font-medium">{cat.category_name}</span>
              <span className="text-sm font-semibold font-mono mr-5 min-w-[100px] text-right">
                ¥{cat.amount.toFixed(2)}
              </span>
              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--cta)] rounded-full"
                  style={{ width: `${cat.percent}%` }}
                />
              </div>
            </div>
          ))}
          <div className="flex items-center px-5 py-4 bg-[var(--primary)] text-white">
            <span className="text-xl mr-4 w-8"></span>
            <span className="flex-1 text-sm font-semibold">合计</span>
            <span className="text-sm font-bold font-mono">¥{statistics.total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Detail Toggle */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="w-full py-3 border border-[var(--border)] rounded-lg text-sm text-[var(--text-muted)] hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
      >
        <span>{showDetail ? '▲' : '▼'}</span>
        <span>消费明细 {records.length > 0 ? `(${records.length}条)` : ''}</span>
      </button>

      {/* Detail List */}
      {showDetail && (
        <div className="mt-4 border border-[var(--border)] rounded-xl overflow-hidden">
          {records.length > 0 ? (
            records.map((record) => (
              <div
                key={record.id}
                className="flex items-center px-5 py-3 border-b border-[var(--border)] last:border-b-0 hover:bg-gray-50"
              >
                <span className="text-sm text-[var(--text-muted)] w-16">
                  {formatDate(record.created_at)}
                </span>
                <span className="text-lg mr-3 w-8 text-center">
                  {record.category_icon}
                </span>
                <span className="flex-1 text-sm">{record.category_name}</span>
                <span className="text-sm font-mono font-semibold mr-4">
                  ¥{record.amount.toFixed(2)}
                </span>
                {record.remark && (
                  <span className="text-xs text-[var(--text-muted)] max-w-[150px] truncate">
                    {record.remark}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-[var(--text-muted)] text-sm">
              暂无记录
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default StatisticsPage;