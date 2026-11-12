import { useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import type { CreateUserInput, StudioUser } from "../../types";
import { USERNAME_PATTERN } from "../../lib/auth";
import {
  roleLabel,
  formatTime,
  messageOf,
  validPassword,
  Heading,
  Field,
} from "./shared";
import type { Props } from "./types";

export function Users({
  notify,
  onNavigate,
}: Pick<Props, "notify" | "onNavigate">) {
  const { data, currentUser, actions } = useStudio();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StudioUser | null>(null);
  const [creditTarget, setCreditTarget] = useState<StudioUser | null>(null);
  const users = data.users.filter((user) =>
    user.username.toLowerCase().includes(appliedSearch.toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(users.length / 8));
  const visiblePage = Math.min(page, totalPages);
  return (
    <>
      <Heading title="用户管理" />
      <div className="settings-toolbar">
        <form
          className="settings-search"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search.trim());
            setPage(1);
          }}
        >
          <input
            placeholder="搜索用户名"
            aria-label="搜索用户名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" type="submit">
            搜索
          </button>
        </form>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          创建用户
        </button>
      </div>
      <div className="settings-table-wrap">
        <table className="settings-table users-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>可用积分</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.slice((visiblePage - 1) * 8, visiblePage * 8).map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.username}</strong>
                  {user.id === currentUser.id && <small>当前账号</small>}
                </td>
                <td>{roleLabel(user.role)}</td>
                <td>
                  <span
                    className={`status-chip ${user.status === "disabled" ? "muted" : ""}`}
                  >
                    {user.status === "enabled" ? "启用" : "停用"}
                  </span>
                </td>
                <td>{user.balance.toLocaleString("zh-CN")}</td>
                <td className="settings-date">{formatTime(user.createdAt)}</td>
                <td>
                  <div className="table-actions">
                    <button onClick={() => setEditing(user)}>管理</button>
                    <button onClick={() => setCreditTarget(user)}>积分</button>
                    <button onClick={() => onNavigate("requests", user.id)}>
                      请求记录 <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  没有匹配的用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="settings-pagination">
        <span>共 {users.length} 位用户</span>
        <div>
          <button
            className="icon-button"
            aria-label="上一页用户"
            disabled={visiblePage === 1}
            onClick={() => setPage(visiblePage - 1)}
          >
            <Icon name="chevronLeft" />
          </button>
          <span>
            {visiblePage} / {totalPages}
          </span>
          <button
            className="icon-button"
            aria-label="下一页用户"
            disabled={visiblePage === totalPages}
            onClick={() => setPage(visiblePage + 1)}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      {creating && (
        <UserForm
          onClose={() => setCreating(false)}
          onCreated={(user) => {
            setCreating(false);
            setSearch("");
            setAppliedSearch("");
            setPage(1);
            notify(`已创建用户 ${user.username}`);
          }}
        />
      )}
      {editing && (
        <EditUser
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await actions.updateUser(editing.id, patch);
            setEditing(null);
            notify("账号已更新");
          }}
        />
      )}
      {creditTarget && (
        <CreditAdjustment
          user={
            data.users.find((u) => u.id === creditTarget.id) ?? creditTarget
          }
          onClose={() => setCreditTarget(null)}
          onSave={async (amount) => {
            await actions.adjustCredits(creditTarget.id, amount);
            setCreditTarget(null);
            notify("积分已调整");
          }}
        />
      )}
    </>
  );
}

function UserForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: StudioUser) => void;
}) {
  const { data, actions } = useStudio();
  const [input, setInput] = useState<CreateUserInput>({
    username: "",
    role: "user",
    status: "enabled",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = input.username.trim();
  const nameError = !USERNAME_PATTERN.test(name)
    ? "使用 3–32 位字母、数字、下划线、点或连字符；不能以点或连字符开头。"
    : data.users.some(
          (user) => user.username.toLowerCase() === name.toLowerCase(),
        )
      ? "此用户名已被使用。"
      : "";
  const passwordError = validPassword(input.password)
    ? ""
    : "初始密码需要 4–128 字节。";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ username: true, password: true });
    if (nameError || passwordError) return;
    setBusy(true);
    setError("");
    try {
      const user = await actions.createUser({ ...input, username: name });
      setInput({ ...input, password: "" });
      onCreated(user);
    } catch (cause) {
      setError(messageOf(cause));
      setInput({ ...input, password: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="创建用户"
      onClose={onClose}
      className="settings-drawer"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form="create-user"
            disabled={busy || !!nameError || !!passwordError}
          >
            {busy ? "创建中…" : "创建用户"}
          </button>
        </>
      }
    >
      <form
        id="create-user"
        className="settings-form"
        onSubmit={submit}
        autoComplete="off"
      >
        <Field
          label="用户名"
          error={touched.username ? nameError : ""}
          hint="3–32 位；字母、数字、下划线、点、连字符"
        >
          <input
            autoFocus
            autoComplete="off"
            value={input.username}
            onChange={(e) => setInput({ ...input, username: e.target.value })}
            onBlur={() => setTouched({ ...touched, username: true })}
            maxLength={32}
            required
          />
        </Field>
        <Field label="角色">
          <select
            value={input.role}
            onChange={(e) =>
              setInput({ ...input, role: e.target.value as StudioUser["role"] })
            }
          >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </Field>
        <Field label="账号状态">
          <select
            value={input.status}
            onChange={(e) =>
              setInput({
                ...input,
                status: e.target.value as StudioUser["status"],
              })
            }
          >
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
        </Field>
        <Field
          label="初始密码"
          error={touched.password ? passwordError : ""}
          hint="4–128 字节"
        >
          <span className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              aria-label="初始密码"
              autoComplete="new-password"
              value={input.password}
              onChange={(e) => setInput({ ...input, password: e.target.value })}
              onBlur={() => setTouched({ ...touched, password: true })}
              required
            />
            <button
              type="button"
              aria-label={showPassword ? "隐藏初始密码" : "显示初始密码"}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "隐藏" : "显示"}
            </button>
          </span>
        </Field>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function EditUser({
  user,
  onClose,
  onSave,
}: {
  user: StudioUser;
  onClose: () => void;
  onSave: (patch: Pick<StudioUser, "role" | "status">) => Promise<void>;
}) {
  const { currentUser } = useStudio();
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSelf = user.id === currentUser.id;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ role, status });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`管理用户 · ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            form="edit-user"
            type="submit"
            className="btn btn-primary"
            disabled={
              busy || isSelf || (role === user.role && status === user.status)
            }
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <form className="settings-form" id="edit-user" onSubmit={submit}>
        <Field label="角色">
          <select
            value={role}
            disabled={isSelf}
            onChange={(e) => setRole(e.target.value as StudioUser["role"])}
          >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </Field>
        <Field label="账号状态">
          <select
            value={status}
            disabled={isSelf}
            onChange={(e) => setStatus(e.target.value as StudioUser["status"])}
          >
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
        </Field>
        {isSelf && (
          <p className="field-hint">当前账号的角色和状态不可在此更改。</p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function CreditAdjustment({
  user,
  onClose,
  onSave,
}: {
  user: StudioUser;
  onClose: () => void;
  onSave: (amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(amount);
  const valid =
    amount.trim() !== "" &&
    Number.isSafeInteger(value) &&
    value !== 0 &&
    user.balance + value >= 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      await onSave(value);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`调整积分 · ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            form="adjust-credits"
            type="submit"
            disabled={!valid || busy}
          >
            {busy ? "保存中…" : "确认调整"}
          </button>
        </>
      }
    >
      <form id="adjust-credits" className="settings-form" onSubmit={submit}>
        <p>
          当前余额：<strong>{user.balance}</strong> 积分
        </p>
        <Field
          label="变动积分"
          hint="正数增加，负数扣减；调整后余额不能小于 0。"
        >
          <input
            type="number"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <p>
          调整后余额：<strong>{valid ? user.balance + value : "—"}</strong>
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
