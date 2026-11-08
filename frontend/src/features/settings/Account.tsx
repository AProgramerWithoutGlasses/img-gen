import { useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import {
  roleLabel,
  formatTime,
  messageOf,
  validPassword,
  Heading,
  Field,
} from "./shared";

export function Account() {
  const { currentUser, actions } = useStudio();
  const [changing, setChanging] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirmation: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    setChanging(false);
    setPasswords({ current: "", next: "", confirmation: "" });
    setError("");
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validPassword(passwords.next))
      return setError("新密码需要 4–128 字节。");
    if (passwords.next !== passwords.confirmation)
      return setError("两次输入的新密码不一致。");
    setBusy(true);
    setError("");
    try {
      await actions.changePassword(passwords.current, passwords.next);
      close();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="账户与安全" />
      <section className="settings-card">
        <div className="settings-card-heading">
          <h2>账号信息</h2>
          <span className="settings-muted">当前账号</span>
        </div>
        <dl className="account-details">
          <dt>用户名</dt>
          <dd>{currentUser.username}</dd>
          <dt>角色</dt>
          <dd>{roleLabel(currentUser.role)}</dd>
          <dt>账号状态</dt>
          <dd>{currentUser.status === "enabled" ? "启用" : "停用"}</dd>
          <dt>创建时间</dt>
          <dd>{formatTime(currentUser.createdAt)}</dd>
        </dl>
      </section>
      <section className="settings-card settings-row">
        <div>
          <h2>登录密码</h2>
          <p>密码不会在此显示。</p>
        </div>
        <button className="btn" onClick={() => setChanging(true)}>
          修改密码
        </button>
      </section>
      <section className="settings-card settings-row">
        <div>
          <h2>当前登录</h2>
          <p>{currentUser.username}</p>
        </div>
        <button className="btn" onClick={actions.signOut}>
          退出登录
        </button>
      </section>
      {changing && (
        <Modal
          title="修改密码"
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close} disabled={busy}>
                取消
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                form="change-password"
                disabled={
                  busy ||
                  !passwords.current ||
                  !passwords.next ||
                  !passwords.confirmation
                }
              >
                {busy ? "提交中…" : "修改密码"}
              </button>
            </>
          }
        >
          <form
            id="change-password"
            className="settings-form"
            onSubmit={submit}
          >
            <Field label="当前密码">
              <input
                type="password"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(e) =>
                  setPasswords({ ...passwords, current: e.target.value })
                }
                required
              />
            </Field>
            <Field label="新密码" hint="4–128 字节">
              <input
                type="password"
                autoComplete="new-password"
                value={passwords.next}
                onChange={(e) =>
                  setPasswords({ ...passwords, next: e.target.value })
                }
                required
              />
            </Field>
            <Field label="确认新密码">
              <input
                type="password"
                autoComplete="new-password"
                value={passwords.confirmation}
                onChange={(e) =>
                  setPasswords({ ...passwords, confirmation: e.target.value })
                }
                required
              />
            </Field>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
