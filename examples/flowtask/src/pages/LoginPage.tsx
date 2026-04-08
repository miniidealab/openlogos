import { useState } from "react";
import { login, CommandError } from "../lib/ipc";
import { useAppStore } from "../store/appStore";

interface FieldErrors {
  username?: string;
  password?: string;
  general?: string;
}

export default function LoginPage() {
  const setSession = useAppStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const e: FieldErrors = {};
    if (!username) e.username = "用户名不能为空";
    if (!password) e.password = "密码不能为空";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const session = await login({ username, password });
      setSession(session);
    } catch (err) {
      const cmdErr = err as CommandError;
      if (cmdErr.code === "INVALID_CREDENTIALS") {
        setErrors({ general: "用户名或密码错误" });
        setPassword("");
      } else {
        setErrors({ general: "登录失败，请重试" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">欢迎回来</h1>
        <p className="text-sm text-gray-500 mb-6">登录继续管理你的任务</p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                ${errors.username ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.username && (
              <p className="mt-1 text-xs text-red-500">{errors.username}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                ${errors.password ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-500">{errors.password}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-xs text-red-500">{errors.general}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50
              text-white text-sm font-medium py-2 transition"
          >
            {loading ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
