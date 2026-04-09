import { useStore } from '../stores/appStore';

function Toast() {
  const { toast } = useStore();

  if (!toast) return null;

  const bgColor = {
    success: 'bg-[var(--success)]',
    error: 'bg-[var(--danger)]',
    info: 'bg-[var(--primary)]',
  }[toast.type];

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2">
      <div
        className={`${bgColor} text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium transform transition-all duration-300 animate-fade-in-down`}
      >
        {toast.message}
      </div>
    </div>
  );
}

export default Toast;
