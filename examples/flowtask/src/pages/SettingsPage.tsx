import { useState, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { changePassword, CommandError } from "../lib/ipc";

interface SettingsPageProps {
  onBack: () => void;
}

function PwToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#3F3F46] transition-colors"
      aria-label="显示/隐藏密码"
    >
      {show ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const currentUser = useAppStore((s) => s.currentUser);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [curPwError, setCurPwError] = useState("");
  const [newPwError, setNewPwError] = useState("");
  const [confirmPwError, setConfirmPwError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const currentPwRef = useRef<HTMLInputElement>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearErrors() {
    setCurPwError(""); setNewPwError(""); setConfirmPwError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    setSuccessMsg("");

    if (!currentPw) { setCurPwError("请输入当前密码"); return; }
    if (!newPw) { setNewPwError("请输入新密码"); return; }
    if (!confirmPw) { setConfirmPwError("请输入确认密码"); return; }
    if (newPw.length < 8) { setNewPwError("密码至少需要 8 位字符"); return; }
    if (newPw === currentPw) { setNewPwError("新密码不能与当前密码相同"); return; }
    if (newPw !== confirmPw) { setConfirmPwError("两次输入的密码不一致"); return; }

    setLoading(true);
    try {
      await changePassword({
        user_id: currentUser!.user_id,
        current_password: currentPw,
        new_password: newPw,
      });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setSuccessMsg("密码修改成功");
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      const cmdErr = err as CommandError;
      if (cmdErr.code === "WRONG_PASSWORD") {
        setCurPwError("当前密码不正确");
        setCurrentPw("");
        currentPwRef.current?.focus();
      } else {
        setCurPwError(cmdErr.message ?? "保存失败，请重试");
      }
    } finally {
      setLoading(false);
    }
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-[8px] border px-3 py-[9px] pr-9 text-[14px] text-[#09090B] bg-white outline-none transition-all
    focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]
    ${hasErr ? "border-[#DC2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]" : "border-[#E4E4E7]"}`;

  const avatarLetter = currentUser?.username?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      {/* macOS 窗口 520px */}
      <div className="w-[520px] bg-white rounded-[12px] border border-[#E4E4E7]
        shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)] overflow-hidden">

        {/* 标题栏 */}
        <div className="bg-[#F5F5F5] border-b border-[#E4E4E7] px-4 py-3 flex items-center gap-2 select-none">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F57] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#FEBC2E] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#28C840] border-[0.5px] border-black/10" />
          </div>
          <span className="flex-1 text-center text-[12px] font-medium text-[#71717A] mr-[54px]">FlowTask — 账号设置</span>
        </div>

        {/* 页面头部 */}
        <div className="flex items-center gap-2.5 px-5 py-[14px] border-b border-[#E4E4E7]">
          <button
            onClick={onBack}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#2563EB] hover:bg-[#E8ECF0] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 className="text-[15px] font-bold text-[#09090B] tracking-[-0.2px]">账号设置</h1>
        </div>

        <div className="px-6 py-5">
          {/* 用户信息卡片 */}
          <div className="flex items-center gap-3 px-4 py-[14px] bg-[#FAFAFA] border border-[#E4E4E7] rounded-[8px] mb-5">
            <div className="w-11 h-11 bg-[#18181B] rounded-full flex items-center justify-center text-white text-[16px] font-semibold flex-shrink-0">
              {avatarLetter}
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#09090B]">{currentUser?.username}</p>
              <p className="text-[12px] text-[#A1A1AA] mt-0.5">本地账号 · 数据仅存储在此设备</p>
            </div>
          </div>

          {/* 修改密码 */}
          <p className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-[0.6px] mb-2.5">修改密码</p>
          <div className="border border-[#E4E4E7] rounded-[8px] overflow-hidden">
            <div className="px-5 py-[18px]">
              {/* 成功提示条 */}
              {successMsg && (
                <div className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-[8px] px-3 py-2.5 text-[13px] text-[#16A34A] mb-[14px]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {successMsg}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                {/* 当前密码 */}
                <div className="mb-[13px]">
                  <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">当前密码</label>
                  <div className="relative">
                    <input ref={currentPwRef} type={showCur ? "text" : "password"}
                      value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                      placeholder="输入当前密码" autoComplete="current-password"
                      className={inputCls(!!curPwError)} />
                    <PwToggle show={showCur} onToggle={() => setShowCur(!showCur)} />
                  </div>
                  {curPwError && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#DC2626]">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {curPwError}
                    </p>
                  )}
                </div>

                {/* 新密码 */}
                <div className="mb-[13px]">
                  <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">新密码</label>
                  <div className="relative">
                    <input type={showNew ? "text" : "password"}
                      value={newPw} onChange={(e) => setNewPw(e.target.value)}
                      placeholder="至少 8 位字符" autoComplete="new-password"
                      className={inputCls(!!newPwError)} />
                    <PwToggle show={showNew} onToggle={() => setShowNew(!showNew)} />
                  </div>
                  {newPwError && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#DC2626]">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {newPwError}
                    </p>
                  )}
                </div>

                {/* 确认新密码 */}
                <div className="mb-0">
                  <label className="block text-[12px] font-medium text-[#3F3F46] mb-1">确认新密码</label>
                  <div className="relative">
                    <input type={showConfirm ? "text" : "password"}
                      value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                      placeholder="再次输入新密码" autoComplete="new-password"
                      className={inputCls(!!confirmPwError)} />
                    <PwToggle show={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
                  </div>
                  {confirmPwError && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#DC2626]">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {confirmPwError}
                    </p>
                  )}
                </div>

                <div className="flex justify-end mt-4">
                  <button
                    type="submit" disabled={loading}
                    className="flex items-center gap-2 px-[22px] py-[9px] bg-[#18181B] hover:opacity-[0.85]
                      disabled:opacity-50 text-white text-[13px] font-semibold rounded-[8px] transition-opacity"
                  >
                    {loading && (
                      <svg className="w-[13px] h-[13px] animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-30" cx="12" cy="12" r="10" stroke="white" strokeWidth="3"/>
                        <path className="opacity-90" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    )}
                    保存修改
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
