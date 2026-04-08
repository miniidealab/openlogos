import { useState } from "react";
import { login, register, CommandError } from "../lib/ipc";
import { useAppStore } from "../store/appStore";

type Tab = "register" | "login";

interface FieldErrors {
  username?: string;
  password?: string;
  confirm?: string;
  general?: string;
}

// 密码显示/隐藏按钮
function PwToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
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

// 字段错误提示
function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#DC2626]">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {msg}
    </p>
  );
}

export default function AuthPage() {
  const setSession = useAppStore((s) => s.setSession);
  const [tab, setTab] = useState<Tab>("register");

  // 注册字段
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [showRegPw, setShowRegPw] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [regErrors, setRegErrors] = useState<FieldErrors>({});
  const [regSuccess, setRegSuccess] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  // 登录字段
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loginErrors, setLoginErrors] = useState<FieldErrors>({});
  const [loginLoading, setLoginLoading] = useState(false);

  function switchTab(t: Tab) {
    setTab(t);
    setRegErrors({});
    setLoginErrors({});
    setRegSuccess(false);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    const errs: FieldErrors = {};
    if (!regUsername) errs.username = "用户名不能为空";
    else if (regUsername.length < 2 || regUsername.length > 20) errs.username = "用户名需为 2–20 个字符";
    if (!regPassword || regPassword.length < 8) errs.password = "密码至少需要 8 位字符";
    if (regPassword !== regConfirm) errs.confirm = "两次输入的密码不一致";
    if (Object.keys(errs).length) { setRegErrors(errs); return; }

    setRegLoading(true);
    setRegErrors({});
    try {
      const session = await register({ username: regUsername, password: regPassword });
      setRegSuccess(true);
      setTimeout(() => setSession(session), 600);
    } catch (err) {
      const cmdErr = err as CommandError;
      if (cmdErr.code === "USERNAME_EXISTS") setRegErrors({ username: cmdErr.message });
      else setRegErrors({ general: cmdErr.message ?? "注册失败，请重试" });
    } finally {
      setRegLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const errs: FieldErrors = {};
    if (!loginUsername) errs.username = "用户名不能为空";
    if (!loginPassword) errs.password = "密码不能为空";
    if (Object.keys(errs).length) { setLoginErrors(errs); return; }

    setLoginLoading(true);
    setLoginErrors({});
    try {
      const session = await login({ username: loginUsername, password: loginPassword });
      setSession(session);
    } catch (err) {
      const cmdErr = err as CommandError;
      if (cmdErr.code === "INVALID_CREDENTIALS") {
        setLoginErrors({ password: "用户名或密码错误" });
        setLoginPassword("");
      } else {
        setLoginErrors({ general: cmdErr.message ?? "登录失败，请重试" });
      }
    } finally {
      setLoginLoading(false);
    }
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-[8px] border px-3 py-[9px] text-[14px] text-[#09090B] bg-white outline-none transition-all
    focus:border-[#2563EB] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]
    ${hasErr ? "border-[#DC2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]" : "border-[#E4E4E7]"}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA]">
      {/* macOS 窗口 */}
      <div className="w-[420px] bg-white rounded-[12px] border border-[#E4E4E7] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)] overflow-hidden">
        {/* 标题栏 */}
        <div className="bg-[#F5F5F5] border-b border-[#E4E4E7] px-4 py-3 flex items-center gap-2 select-none">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F57] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#FEBC2E] border-[0.5px] border-black/10" />
            <div className="w-3 h-3 rounded-full bg-[#28C840] border-[0.5px] border-black/10" />
          </div>
          <span className="flex-1 text-center text-[12px] font-medium text-[#71717A] mr-[54px]">FlowTask</span>
        </div>

        {/* 卡片内容 */}
        <div className="px-8 pt-9 pb-8">
          {/* 品牌 */}
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-11 h-11 bg-[#18181B] rounded-[10px] mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h1 className="text-[18px] font-bold text-[#09090B] tracking-[-0.3px]">FlowTask</h1>
            <p className="text-[13px] text-[#71717A] mt-0.5">简洁的个人任务管理工具</p>
          </div>

          {/* Tab 切换 */}
          <div className="flex bg-[#E8ECF0] rounded-[8px] p-[3px] mb-6">
            {(["register", "login"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`flex-1 py-[7px] px-3 rounded-[6px] text-[13px] font-medium transition-all
                  ${tab === t
                    ? "bg-white text-[#09090B] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-[#71717A] hover:text-[#3F3F46]"}`}
              >
                {t === "register" ? "注册账号" : "登录"}
              </button>
            ))}
          </div>

          {/* 注册面板 */}
          {tab === "register" && (
            <form onSubmit={handleRegister} noValidate>
              {regSuccess && (
                <div className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-[8px] px-3 py-2.5 text-[13px] text-[#16A34A] mb-3.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  账号创建成功，正在进入…
                </div>
              )}
              <div className="mb-3.5">
                <label className="block text-[13px] font-medium text-[#3F3F46] mb-[5px]">
                  用户名<span className="text-[#DC2626] ml-0.5">*</span>
                </label>
                <input type="text" value={regUsername} onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="2–20 个字符" autoComplete="username" autoFocus
                  className={inputCls(!!regErrors.username)} />
                <FieldError msg={regErrors.username} />
              </div>
              <div className="mb-3.5">
                <label className="block text-[13px] font-medium text-[#3F3F46] mb-[5px]">
                  密码<span className="text-[#DC2626] ml-0.5">*</span>
                </label>
                <div className="relative">
                  <input type={showRegPw ? "text" : "password"} value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="至少 8 位字符" autoComplete="new-password"
                    className={inputCls(!!regErrors.password)} />
                  <PwToggle show={showRegPw} onToggle={() => setShowRegPw(!showRegPw)} />
                </div>
                <FieldError msg={regErrors.password} />
              </div>
              <div className="mb-3.5">
                <label className="block text-[13px] font-medium text-[#3F3F46] mb-[5px]">
                  确认密码<span className="text-[#DC2626] ml-0.5">*</span>
                </label>
                <div className="relative">
                  <input type={showRegConfirm ? "text" : "password"} value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    placeholder="再次输入密码" autoComplete="new-password"
                    className={inputCls(!!regErrors.confirm)} />
                  <PwToggle show={showRegConfirm} onToggle={() => setShowRegConfirm(!showRegConfirm)} />
                </div>
                <FieldError msg={regErrors.confirm} />
              </div>
              {regErrors.general && <FieldError msg={regErrors.general} />}
              <button type="submit" disabled={regLoading}
                className="w-full mt-1.5 py-[10px] bg-[#18181B] hover:opacity-[0.88] disabled:opacity-50
                  text-white text-[14px] font-semibold rounded-[8px] transition-opacity flex items-center justify-center gap-2">
                {regLoading && (
                  <svg className="w-[15px] h-[15px] animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="white" strokeWidth="3"/>
                    <path className="opacity-90" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
                创建账号
              </button>
              <p className="text-center text-[12px] text-[#A1A1AA] mt-[18px]">
                已有账号？
                <button type="button" onClick={() => switchTab("login")}
                  className="text-[#2563EB] font-medium hover:underline ml-0.5">立即登录</button>
              </p>
            </form>
          )}

          {/* 登录面板 */}
          {tab === "login" && (
            <form onSubmit={handleLogin} noValidate>
              <div className="mb-3.5">
                <label className="block text-[13px] font-medium text-[#3F3F46] mb-[5px]">
                  用户名<span className="text-[#DC2626] ml-0.5">*</span>
                </label>
                <input type="text" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="输入用户名" autoComplete="username" autoFocus
                  className={inputCls(!!loginErrors.username)} />
                <FieldError msg={loginErrors.username} />
              </div>
              <div className="mb-3.5">
                <label className="block text-[13px] font-medium text-[#3F3F46] mb-[5px]">
                  密码<span className="text-[#DC2626] ml-0.5">*</span>
                </label>
                <div className="relative">
                  <input type={showLoginPw ? "text" : "password"} value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="输入密码" autoComplete="current-password"
                    className={inputCls(!!loginErrors.password)} />
                  <PwToggle show={showLoginPw} onToggle={() => setShowLoginPw(!showLoginPw)} />
                </div>
                <FieldError msg={loginErrors.password} />
              </div>
              {loginErrors.general && <FieldError msg={loginErrors.general} />}
              <button type="submit" disabled={loginLoading}
                className="w-full mt-1.5 py-[10px] bg-[#18181B] hover:opacity-[0.88] disabled:opacity-50
                  text-white text-[14px] font-semibold rounded-[8px] transition-opacity flex items-center justify-center gap-2">
                {loginLoading && (
                  <svg className="w-[15px] h-[15px] animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="white" strokeWidth="3"/>
                    <path className="opacity-90" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
                登录
              </button>
              <p className="text-center text-[12px] text-[#A1A1AA] mt-[18px]">
                还没有账号？
                <button type="button" onClick={() => switchTab("register")}
                  className="text-[#2563EB] font-medium hover:underline ml-0.5">免费注册</button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
