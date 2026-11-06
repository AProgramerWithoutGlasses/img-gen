import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import { MODELS } from "../../config/models";
import type {
  CreateUserInput,
  Generation,
  ModelId,
  Notify,
  PreviewImage,
  SettingsSection,
  StudioUser,
  Theme,
} from "../../types";
import "./settings.css";

interface Props {
  section: SettingsSection;
  onNavigate: (section: SettingsSection, filterUser?: string) => void;
  requestUserFilter?: string;
  notify: Notify;
  onPreview: PreviewImage;
  onDirtyChange?: (dirty: boolean) => void;
}

const roleLabel = (role: StudioUser["role"]) =>
  role === "admin" ? "管理员" : "普通用户";
const statusLabel = (status: Generation["status"]) =>
  ({ completed: "已完成", processing: "处理中", failed: "失败" })[status];
const formatTime = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";
const validPassword = (password: string) => {
  const length = new TextEncoder().encode(password).length;
  return length >= 4 && length <= 128;
};

function Heading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="settings-heading">
      <h1>{title}</h1>
      {action}
    </div>
  );
}

function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="settings-field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

function Account() {
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

function Appearance({ notify }: { notify: Notify }) {
  const { data, actions } = useStudio();
  const [busy, setBusy] = useState(false);
  async function update(patch: { theme?: Theme; enterToSend?: boolean }) {
    setBusy(true);
    try {
      await actions.setPreferences(patch);
    } catch (cause) {
      notify(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="外观与输入" />
      <section className="settings-card">
        <h2>主题</h2>
        <div className="theme-options" role="group" aria-label="主题">
          {(
            [
              { id: "light", name: "浅色", icon: "sun" },
              { id: "dark", name: "深色", icon: "moon" },
              { id: "system", name: "跟随系统", icon: "grid" },
            ] as const
          ).map((theme) => (
            <button
              key={theme.id}
              className={`theme-option ${data.preferences.theme === theme.id ? "selected" : ""}`}
              aria-pressed={data.preferences.theme === theme.id}
              disabled={busy}
              onClick={() => update({ theme: theme.id })}
            >
              <span className={`theme-swatch theme-${theme.id}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="theme-option-label">
                <Icon name={theme.icon} />
                {theme.name}
                {data.preferences.theme === theme.id && <Icon name="check" />}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card settings-row">
        <div>
          <h2>Enter 发送</h2>
          <p>
            {data.preferences.enterToSend
              ? "Enter 发送，Shift + Enter 换行。"
              : "Enter 换行，点击发送按钮提交。"}
          </p>
        </div>
        <button
          type="button"
          className={`settings-switch ${data.preferences.enterToSend ? "on" : ""}`}
          role="switch"
          aria-label="Enter 发送"
          aria-checked={data.preferences.enterToSend}
          disabled={busy}
          onClick={() => update({ enterToSend: !data.preferences.enterToSend })}
        >
          <span />
        </button>
      </section>
    </>
  );
}

function Credits({ notify }: { notify: Notify }) {
  const { currentUser, data } = useStudio();
  const [page, setPage] = useState(1);
  const history = data.generations
    .filter((generation) => generation.userId === currentUser.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const totalPages = Math.max(1, Math.ceil(history.length / 10));
  const visiblePage = Math.min(page, totalPages);
  return (
    <>
      <Heading title="积分历史" />
      <section className="settings-card credits-balance">
        <div>
          <p>可用积分</p>
          <strong>{currentUser.balance.toLocaleString("zh-CN")}</strong>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => notify("充值服务尚未接入。")}
        >
          积分充值
        </button>
      </section>
      <section className="settings-card credit-history" aria-label="历史用量">
        <h2>历史用量</h2>
        <p>查看每次创作的积分使用情况，未生成成功的图片不扣积分。</p>
        <div className="settings-table-wrap">
          <table className="settings-table credit-history-table">
            <thead>
              <tr><th>时间</th><th>模型</th><th>已生成</th><th>积分</th><th>状态</th></tr>
            </thead>
            <tbody>
              {history.slice((visiblePage - 1) * 10, visiblePage * 10).map((generation) => (
                <tr key={generation.id}>
                  <td className="settings-date">{formatTime(generation.createdAt)}</td>
                  <td>{MODELS.find((model) => model.id === generation.options.modelId)?.name ?? generation.options.modelId}</td>
                  <td>{generation.imageIds.length} 张</td>
                  <td>
                    {generation.status === "processing" ? "结算中" : `${generation.cost.toLocaleString("zh-CN")} 积分`}
                  </td>
                  <td>
                    <span className={`status-chip ${generation.status}`}>
                      {generation.status === "failed" && generation.imageIds.length > 0 ? "部分完成" : statusLabel(generation.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={5} className="table-empty">暂无用量记录，开始创作后会显示在这里。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="settings-pagination">
          <span>共 {history.length} 条记录</span>
          <div>
            <button className="icon-button" aria-label="上一页用量" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>
              <Icon name="chevronLeft" size={16} />
            </button>
            <span>{visiblePage} / {totalPages}</span>
            <button className="icon-button" aria-label="下一页用量" disabled={visiblePage >= totalPages} onClick={() => setPage(visiblePage + 1)}>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function Users({ notify, onNavigate }: Pick<Props, "notify" | "onNavigate">) {
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
  const nameError = !/^[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}$/.test(name)
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

interface Filters {
  user: string;
  prompt: string;
  status: string;
  from: string;
  to: string;
}
function emptyFilters(user = ""): Filters {
  return { user, prompt: "", status: "", from: "", to: "" };
}
function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function Requests({
  requestUserFilter,
  onPreview,
}: Pick<Props, "requestUserFilter" | "onPreview">) {
  const { data } = useStudio();
  const [filters, setFilters] = useState<Filters>(() =>
    emptyFilters(requestUserFilter),
  );
  const [applied, setApplied] = useState<Filters>(() =>
    emptyFilters(requestUserFilter),
  );
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Generation | null>(null);
  useEffect(() => {
    setFilters(emptyFilters(requestUserFilter));
    setApplied(emptyFilters(requestUserFilter));
    setPage(1);
  }, [requestUserFilter]);
  const requests = useMemo(
    () =>
      data.generations
        .filter((request) => {
          const time = new Date(request.createdAt).getTime();
          return (
            (!applied.user || request.userId === applied.user) &&
            (!applied.prompt ||
              request.prompt
                .toLowerCase()
                .includes(applied.prompt.toLowerCase())) &&
            (!applied.status || request.status === applied.status) &&
            (!applied.from || time >= new Date(applied.from).getTime()) &&
            (!applied.to || time <= new Date(applied.to).getTime())
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.generations, applied],
  );
  const counts = {
    completed: requests.filter((r) => r.status === "completed").length,
    processing: requests.filter((r) => r.status === "processing").length,
    failed: requests.filter((r) => r.status === "failed").length,
  };
  const totalPages = Math.max(1, Math.ceil(requests.length / 8));
  const currentPage = Math.min(page, totalPages);
  function quickRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    from.setHours(0, 0, 0, 0);
    setFilters({
      ...filters,
      from: dateInputValue(from),
      to: dateInputValue(to),
    });
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    if (
      filters.from &&
      filters.to &&
      new Date(filters.from) > new Date(filters.to)
    )
      return setFilterError("开始时间不能晚于结束时间。");
    setFilterError("");
    setApplied(filters);
    setPage(1);
  }
  return (
    <>
      <Heading title="请求记录" />
      <form className="request-filters" onSubmit={apply}>
        <div className="request-filter-top">
          <Field label="用户">
            <select
              value={filters.user}
              onChange={(e) => setFilters({ ...filters, user: e.target.value })}
            >
              <option value="">全部用户</option>
              {data.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="提示词">
            <input
              placeholder="搜索提示词"
              value={filters.prompt}
              onChange={(e) =>
                setFilters({ ...filters, prompt: e.target.value })
              }
            />
          </Field>
          <Field label="状态">
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="processing">处理中</option>
              <option value="failed">失败</option>
            </select>
          </Field>
          <Field label="记录范围">
            <select aria-label="记录范围" value="all" disabled>
              <option value="all">全部记录</option>
            </select>
          </Field>
        </div>
        <div className="request-filter-bottom">
          <div className="quick-dates">
            <button className="btn" type="button" onClick={() => quickRange(1)}>
              今天
            </button>
            <button className="btn" type="button" onClick={() => quickRange(3)}>
              3 天
            </button>
            <button className="btn" type="button" onClick={() => quickRange(7)}>
              7 天
            </button>
          </div>
          <input
            type="datetime-local"
            step="1"
            aria-label="开始时间"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
          <span>至</span>
          <input
            type="datetime-local"
            step="1"
            aria-label="结束时间"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
          <button className="btn btn-primary" type="submit">
            筛选
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFilters(emptyFilters());
              setApplied(emptyFilters());
              setFilterError("");
              setPage(1);
            }}
          >
            清空
          </button>
        </div>
        <span className="field-hint">
          时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        {filterError && (
          <p className="field-error" role="alert">
            {filterError}
          </p>
        )}
      </form>
      <div className="request-stats">
        <span>
          匹配请求 <strong>{requests.length}</strong>
        </span>
        <span>
          已完成 <strong>{counts.completed}</strong>
        </span>
        <span>
          处理中 <strong>{counts.processing}</strong>
        </span>
        <span>
          失败 <strong>{counts.failed}</strong>
        </span>
      </div>
      <div className="settings-table-wrap">
        <table className="settings-table requests-table">
          <thead>
            <tr>
              <th>用户 / 时间</th>
              <th>输入 / 模型</th>
              <th>耗时</th>
              <th>积分</th>
              <th>状态</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {requests
              .slice((currentPage - 1) * 8, currentPage * 8)
              .map((request) => (
                <tr key={request.id}>
                  <td>
                    <strong>{request.username}</strong>
                    <small>{formatTime(request.createdAt)}</small>
                  </td>
                  <td>
                    <button
                      className="request-prompt"
                      onClick={() => setDetail(request)}
                    >
                      {request.prompt}
                    </button>
                    <small>
                      {MODELS.find((m) => m.id === request.options.modelId)
                        ?.name ?? request.options.modelId}
                    </small>
                  </td>
                  <td>
                    {request.durationMs !== undefined
                      ? `${(request.durationMs / 1000).toFixed(1)} 秒`
                      : "—"}
                  </td>
                  <td>{request.status !== "processing" ? request.cost : "—"}</td>
                  <td>
                    <span className={`status-chip ${request.status}`}>
                      {statusLabel(request.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="request-result"
                      aria-label={`查看 ${request.username} 的请求详情`}
                      onClick={() => setDetail(request)}
                    >
                      {request.imageIds.length ? (
                        <div className="request-thumbnails">
                          {request.imageIds.slice(0, 2).map((id) => {
                            const asset = data.assets.find((a) => a.id === id);
                            return asset ? (
                              <img key={id} src={asset.thumbnailUrl ?? asset.url} alt="生成图片" loading="lazy" decoding="async" />
                            ) : null;
                          })}
                        </div>
                      ) : request.error ? (
                        <span className="request-error-summary">
                          {request.error}
                        </span>
                      ) : (
                        "查看详情"
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            {!requests.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  没有匹配的请求
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="settings-pagination">
        <span>共 {requests.length} 条请求</span>
        <div>
          <button
            className="icon-button"
            aria-label="上一页请求"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <Icon name="chevronLeft" />
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            className="icon-button"
            aria-label="下一页请求"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      {detail && (
        <RequestDetail
          request={data.generations.find((r) => r.id === detail.id) ?? detail}
          onClose={() => setDetail(null)}
          onPreview={onPreview}
        />
      )}
    </>
  );
}

function RequestDetail({
  request,
  onClose,
  onPreview,
}: {
  request: Generation;
  onClose: () => void;
  onPreview: PreviewImage;
}) {
  const { data } = useStudio();
  const images = data.assets.filter((asset) =>
    request.imageIds.includes(asset.id),
  );
  return (
    <Modal
      title="请求详情"
      onClose={onClose}
      className="settings-drawer request-detail"
    >
      <div className="request-detail-meta">
        <span className={`status-chip ${request.status}`}>
          {statusLabel(request.status)}
        </span>
        <dl>
          <dt>用户</dt>
          <dd>{request.username}</dd>
          <dt>请求时间</dt>
          <dd>{formatTime(request.createdAt)}</dd>
          <dt>模型</dt>
          <dd>{MODELS.find((m) => m.id === request.options.modelId)?.name}</dd>
          <dt>参数</dt>
          <dd>
            {[
              request.options.quality,
              request.options.ratio,
              request.options.resolution,
              `${request.options.count} 张`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </dd>
          <dt>耗时</dt>
          <dd>
            {request.durationMs !== undefined
              ? `${(request.durationMs / 1000).toFixed(1)} 秒`
              : "—"}
          </dd>
          <dt>消耗积分</dt>
          <dd>{request.status !== "processing" ? request.cost : "—"}</dd>
        </dl>
      </div>
      <section>
        <h3>提示词</h3>
        <p className="request-full-prompt">{request.prompt}</p>
      </section>
      {request.attachments.length > 0 && (
        <section>
          <h3>参考图片</h3>
          <div className="request-attachment-list">
            {request.attachments.map((attachment) => (
              <img
                key={attachment.id}
                src={attachment.url}
                alt={attachment.name}
              />
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>生成结果</h3>
        {images.length > 0 ? (
          <div className="request-detail-images">
            {images.map((image) => (
              <button
                key={image.id}
                onClick={() => {
                  onClose();
                  onPreview(image, images);
                }}
                aria-label={`查看 ${image.name}`}
              >
                <img src={image.previewUrl ?? image.url} alt={image.name} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        ) : (
          <p className={request.error ? "field-error" : "settings-muted"}>
            {request.error || "正在生成…"}
          </p>
        )}
      </section>
    </Modal>
  );
}

function Prices({
  notify,
  onDirtyChange,
}: Pick<Props, "notify" | "onDirtyChange">) {
  const { data, actions } = useStudio();
  const [draft, setDraft] = useState<Record<ModelId, string>>(
    () =>
      Object.fromEntries(
        MODELS.map((model) => [model.id, String(data.prices[model.id])]),
      ) as Record<ModelId, string>,
  );
  const [saving, setSaving] = useState<ModelId | null>(null);
  const [error, setError] = useState<Partial<Record<ModelId, string>>>({});
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const priceVersions = useRef({ ...data.priceVersions });
  const dirtyCount = MODELS.filter(
    (model) => draft[model.id] !== String(data.prices[model.id]),
  ).length;
  useEffect(() => {
    onDirtyChange?.(dirtyCount > 0);
    return () => onDirtyChange?.(false);
  }, [dirtyCount, onDirtyChange]);
  useEffect(() => {
    if (!dirtyCount) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirtyCount]);
  async function refresh() {
    let latest = data;
    try { latest = (await actions.refreshData?.()) ?? data; }
    catch (cause) { notify(messageOf(cause)); return; }
    priceVersions.current = { ...latest.priceVersions };
    setDraft(
      Object.fromEntries(
        MODELS.map((model) => [model.id, String(latest.prices[model.id])]),
      ) as Record<ModelId, string>,
    );
    setError({});
    setConfirmRefresh(false);
  }
  async function save(id: ModelId) {
    const amount = Number(draft[id]);
    if (!draft[id].trim() || !Number.isSafeInteger(amount) || amount < 0)
      return setError({ ...error, [id]: "请输入非负整数。" });
    setSaving(id);
    setError((previous) => ({ ...previous, [id]: undefined }));
    try {
      const version = priceVersions.current?.[id];
      await actions.savePrice(id, amount, version);
      if (version !== undefined && priceVersions.current) priceVersions.current[id] = version + 1;
      setDraft((previous) => ({ ...previous, [id]: String(amount) }));
      notify("价格已保存");
    } catch (cause) {
      setError((previous) => ({ ...previous, [id]: messageOf(cause) }));
    } finally {
      setSaving(null);
    }
  }
  const orderedModels = [...MODELS].sort(
    (a, b) =>
      [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gpt-image-1.5",
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
      ].indexOf(a.id) -
      [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gpt-image-1.5",
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
      ].indexOf(b.id),
  );
  return (
    <>
      <Heading
        title="模型价格"
        action={
          <button
            className="btn"
            disabled={!!saving}
            onClick={() => (dirtyCount ? setConfirmRefresh(true) : refresh())}
          >
            <Icon name="refresh" />
            刷新价格
          </button>
        }
      />
      <p className="price-note">
        按张计费；非负整数，0 表示免费。修改仅影响之后提交的任务。
      </p>
      <div className="settings-table-wrap">
        <table className="settings-table prices-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>单张积分</th>
              <th>最近修改</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orderedModels.map((model) => {
              const changed = draft[model.id] !== String(data.prices[model.id]);
              return (
                <tr key={model.id}>
                  <td>
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      aria-label={`${model.name} 单张积分`}
                      value={draft[model.id]}
                      disabled={saving === model.id}
                      onChange={(event) =>
                        setDraft({ ...draft, [model.id]: event.target.value })
                      }
                    />
                    {changed && <small>已保存：{data.prices[model.id]}</small>}
                    {error[model.id] && (
                      <span className="field-error" role="alert">
                        {error[model.id]}
                      </span>
                    )}
                  </td>
                  <td className="settings-date">
                    {formatTime(data.priceUpdatedAt[model.id])}
                  </td>
                  <td>
                    <button
                      className={`btn ${changed ? "btn-primary" : ""}`}
                      disabled={!changed || !!saving}
                      onClick={() => save(model.id)}
                    >
                      {saving === model.id ? "保存中…" : "保存价格"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dirtyCount > 0 && (
        <p className="settings-muted">有 {dirtyCount} 项价格尚未保存</p>
      )}
      {confirmRefresh && (
        <Modal
          title="放弃未保存的修改？"
          onClose={() => setConfirmRefresh(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRefresh(false)}>
                继续编辑
              </button>
              <button className="btn btn-primary" onClick={refresh}>
                放弃修改
              </button>
            </>
          }
        >
          <p>刷新后将使用已保存的价格。</p>
        </Modal>
      )}
    </>
  );
}

export default function SettingsPage(props: Props) {
  const { currentUser } = useStudio();
  const { section } = props;
  if (
    ["users", "requests", "prices"].includes(section) &&
    currentUser.role !== "admin"
  )
    return (
      <div className="settings-content settings-restricted">
        <Icon name="shield" />
        <h1>没有访问权限</h1>
        <button className="btn" onClick={() => props.onNavigate("account")}>
          返回账户设置
        </button>
      </div>
    );
  return (
    <div className="settings-content">
      {section === "account" && <Account />}
      {section === "appearance" && <Appearance notify={props.notify} />}
      {section === "credits" && <Credits notify={props.notify} />}
      {section === "users" && (
        <Users notify={props.notify} onNavigate={props.onNavigate} />
      )}
      {section === "requests" && (
        <Requests
          requestUserFilter={props.requestUserFilter}
          onPreview={props.onPreview}
        />
      )}
      {section === "prices" && (
        <Prices notify={props.notify} onDirtyChange={props.onDirtyChange} />
      )}
    </div>
  );
}
