import { useRef, useState } from "react";
import { useStudio } from "../state/StudioContext";
import type { Notify, Theme } from "../types";
import { Icon } from "./Icon";

const themes: { value: Theme; label: string }[] = [
  { value: "dark", label: "暗色" },
  { value: "light", label: "亮色" },
  { value: "system", label: "跟随系统" },
];

export function AccountMenu({
  onNavigate,
  onClose,
  onSignOut,
  notify,
}: {
  onNavigate: (target: string) => void;
  onClose: () => void;
  onSignOut: () => void;
  notify: Notify;
}) {
  const { currentUser, data, actions } = useStudio();
  const [submenu, setSubmenu] = useState<"account" | "theme" | null>(null);
  const [savingTheme, setSavingTheme] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const themeTrigger = useRef<HTMLButtonElement>(null);

  async function selectTheme(theme: Theme) {
    setSavingTheme(true);
    try {
      await actions.setPreferences({ theme });
    } catch (e) {
      notify(e instanceof Error ? e.message : "主题切换失败");
    } finally {
      setSavingTheme(false);
    }
  }

  return (
    <div
      className="account-menu"
      aria-label="账户菜单"
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "ArrowLeft" && submenu)) {
          event.preventDefault();
          if (submenu) {
            (submenu === "account" ? accountTrigger : themeTrigger).current?.focus();
            setSubmenu(null);
          } else onClose();
        }
      }}
    >
      <div className="account-menu-header" onMouseEnter={() => setSubmenu(null)}>
        <span className="avatar">{currentUser.username.charAt(0).toUpperCase()}</span>
        <strong title={currentUser.username}>{currentUser.username}</strong>
        <span className="account-menu-balance" aria-label="积分余额">
          <Icon name="coins" size={16} />
          {currentUser.balance.toLocaleString()}
        </span>
      </div>
      <button
        className="account-recharge btn-primary"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => notify("充值服务尚未接入。")}
      >
        充值积分
      </button>
      <div className="account-menu-items">
        <button
          className="account-menu-item"
          onMouseEnter={() => setSubmenu(null)}
          onClick={() => onNavigate("/settings/account")}
        >
          <Icon name="settings" size={18} />
          <span>设置</span>
        </button>
        <div className="account-menu-branch" onMouseEnter={() => setSubmenu("account")}>
          <button
            ref={accountTrigger}
            className={`account-menu-item ${submenu === "account" ? "active" : ""}`}
            aria-expanded={submenu === "account"}
            aria-controls="account-management-submenu"
            onClick={() => setSubmenu("account")}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setSubmenu("account");
              }
            }}
          >
            <Icon name="user" size={18} />
            <span>管理账户</span>
            <Icon name="chevronRight" size={14} />
          </button>
          {submenu === "account" && (
            <div className="account-submenu" id="account-management-submenu" aria-label="管理账户">
              <button onClick={() => onNavigate("/settings/account")}>
                <span>账号设置</span>
              </button>
              <button onClick={() => onNavigate("/settings/credits")}>
                <span>积分历史</span>
              </button>
            </div>
          )}
        </div>
        <div className="account-menu-branch" onMouseEnter={() => setSubmenu("theme")}>
          <button
            ref={themeTrigger}
            className={`account-menu-item ${submenu === "theme" ? "active" : ""}`}
            aria-expanded={submenu === "theme"}
            aria-controls="account-theme-submenu"
            onClick={() => setSubmenu("theme")}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setSubmenu("theme");
              }
            }}
          >
            <Icon name="sun" size={18} />
            <span>主题</span>
            <small>{themes.find((theme) => theme.value === data.preferences.theme)?.label}</small>
            <Icon name="chevronRight" size={14} />
          </button>
          {submenu === "theme" && (
            <div
              className="account-submenu"
              id="account-theme-submenu"
              role="radiogroup"
              aria-label="主题"
              onKeyDown={(event) => {
                const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1
                  : ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 0;
                if (!direction || event.key === "ArrowLeft" || savingTheme) return;
                event.preventDefault();
                const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = (index + direction + themes.length) % themes.length;
                buttons[next]?.focus();
                void selectTheme(themes[next].value);
              }}
            >
              {themes.map((theme) => (
                <button
                  key={theme.value}
                  role="radio"
                  aria-checked={data.preferences.theme === theme.value}
                  disabled={savingTheme}
                  onClick={() => void selectTheme(theme.value)}
                >
                  <span>{theme.label}</span>
                  {data.preferences.theme === theme.value && <Icon name="check" size={17} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="account-menu-footer" onMouseEnter={() => setSubmenu(null)}>
        <button className="account-menu-item" onClick={onSignOut}>
          <Icon name="logout" size={18} />
          退出登录
        </button>
      </div>
    </div>
  );
}
