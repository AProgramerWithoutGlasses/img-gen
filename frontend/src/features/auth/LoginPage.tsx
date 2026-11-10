import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";
import { passwordLengthError, USERNAME_PATTERN } from "../../lib/auth";

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin, onRegister }: Props) {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !username.trim() || !password) return;
    if (!USERNAME_PATTERN.test(username.trim())) {
      setError("用户名须为 3–32 位字母、数字、_、.、-，以字母、数字或 _ 开头。");
      return;
    }
    const lengthError = passwordLengthError(password, registering);
    if (lengthError) return setError(lengthError);
    if (registering && password !== confirmation) return setError("两次输入的密码不一致。");
    setSubmitting(true);
    setError("");
    try {
      await (registering ? onRegister : onLogin)(username.trim(), password);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : registering ? "注册失败，请重试" : "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      {import.meta.env.MODE === "preview" && <span className="preview-badge login-preview-badge">本地预览</span>}
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand login-brand">
          <BrandMark size={32} />
          <strong>AiCraft</strong>
        </div>
        <h1 id="login-title">{registering ? "创建账号" : "登录"}</h1>
        <form className="login-form" onSubmit={submit} noValidate>
          <label className="login-field">
            <span>用户名</span>
            <input
              name="username"
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="请输入用户名"
              maxLength={32}
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
                autoComplete={registering ? "new-password" : "current-password"}
                placeholder="请输入密码"
                maxLength={128}
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
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </span>
            {registering && <small className="login-hint">8–128 字节，建议混合使用字母和数字。</small>}
          </label>
          {registering && <label className="login-field">
            <span>确认密码</span>
            <input name="password-confirmation" aria-label="确认密码" type={showPassword ? "text" : "password"}
              autoComplete="new-password" placeholder="请再次输入密码" maxLength={128} value={confirmation}
              onChange={event => { setConfirmation(event.target.value); setError(""); }} disabled={submitting}
              aria-invalid={!!error} aria-describedby={error ? errorId : undefined} required />
          </label>}
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary login-submit"
            type="submit"
            disabled={submitting || !username.trim() || !password || (registering && !confirmation)}
          >
            {submitting ? registering ? "注册中…" : "登录中…" : registering ? "注册并登录" : "登录"}
          </button>
        </form>
        <div className="login-account-switch">
          <span>{registering ? "已有账号？" : "还没有账号？"}</span>
          <button type="button" disabled={submitting} onClick={() => {
            setRegistering(value => !value); setPassword(""); setConfirmation(""); setError(""); setShowPassword(false);
          }}>{registering ? "返回登录" : "注册账号"}</button>
        </div>
        {registering && <p className="login-registration-note">新账号为普通用户，初始积分为 0。</p>}
      </section>
    </main>
  );
}
