import { useId, useState } from "react";
import type { FormEvent } from "react";

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setSubmitting(true);
    setError("");
    try {
      await onLogin(username.trim(), password);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <span className="preview-badge login-preview-badge">本地预览</span>
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">
            △
          </span>
          <strong>AI 图像</strong>
        </div>
        <h1 id="login-title">登录</h1>
        <form className="login-form" onSubmit={submit}>
          <label className="login-field">
            <span>用户名</span>
            <input
              name="username"
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="请输入用户名"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError("");
              }}
              disabled={submitting}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              required
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <span className="login-password">
              <input
                name="password"
                aria-label="密码"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                disabled={submitting}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showPassword}
                disabled={submitting}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </span>
          </label>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary login-submit"
            type="submit"
            disabled={submitting || !username.trim() || !password}
          >
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
