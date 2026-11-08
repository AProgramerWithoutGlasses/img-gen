import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { AccountMenu } from "../components/AccountMenu";
import { useStudio } from "../state/StudioContext";
import { settingsLabels } from "./navigation";
import type { Notify, SettingsSection } from "../types";

interface Props {
  isSettings: boolean;
  isGallery: boolean;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  settingsSection: SettingsSection;
  activeFolder: string;
  navigate: (target: string) => void;
  newFolder: () => void;
  signOut: () => void;
  notify: Notify;
}
export function Sidebar({
  isSettings,
  isGallery,
  collapsed,
  setCollapsed,
  settingsSection,
  activeFolder,
  navigate,
  newFolder,
  signOut,
  notify,
}: Props) {
  const { data, currentUser } = useStudio();
  const [accountMenu, setAccountMenu] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const folders = data.folders.filter((f) => f.userId === currentUser.id);
  const images = data.assets.filter((a) => a.userId === currentUser.id);
  useEffect(() => setAccountMenu(false), [currentUser.id]);
  return (
    <aside className="sidebar">
      {isSettings ? (
        <button className="back-create" onClick={() => navigate("/create")}>
          <Icon name="arrowLeft" />
          返回创作
        </button>
      ) : (
        <div className="sidebar-brand">
          <span className="brand-mark">△</span>
          {!collapsed && <strong>AI 图像</strong>}
          <button
            className="icon-button sidebar-toggle"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="collapse" size={18} />
          </button>
        </div>
      )}
      <nav
        className="primary-nav"
        aria-label={isSettings ? "设置导航" : "主导航"}
      >
        {isSettings ? (
          <>
            <div className="nav-label">个人设置</div>
            {(["account", "appearance", "credits"] as const).map((k) => (
              <button
                key={k}
                className={`nav-item ${settingsSection === k ? "active" : ""}`}
                onClick={() => navigate("/settings/" + k)}
              >
                <Icon
                  name={
                    k === "account"
                      ? "user"
                      : k === "appearance"
                        ? "sun"
                        : "coins"
                  }
                />
                <span>{settingsLabels[k]}</span>
              </button>
            ))}
            {currentUser.role === "admin" && (
              <>
                <div className="nav-label admin-label">管理员面板</div>
                {(["users", "requests", "prices"] as const).map((k) => (
                  <button
                    key={k}
                    className={`nav-item ${settingsSection === k ? "active" : ""}`}
                    onClick={() => navigate("/settings/" + k)}
                  >
                    <Icon
                      name={
                        k === "users"
                          ? "user"
                          : k === "requests"
                            ? "grid"
                            : "coins"
                      }
                    />
                    <span>{settingsLabels[k]}</span>
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            {!collapsed && <div className="nav-label">工作空间</div>}
            <button
              className={`nav-item ${!isGallery ? "active" : ""}`}
              aria-label="图像创作"
              title="图像创作"
              onClick={() => navigate("/create")}
            >
              <Icon name="image" />
              {!collapsed && <span>图像创作</span>}
            </button>
            <button
              className={`nav-item ${isGallery ? "active" : ""}`}
              aria-label="我的图片"
              title="我的图片"
              onClick={() => navigate("/gallery")}
            >
              <Icon name="image" />
              {!collapsed && <span>我的图片</span>}
            </button>
            {!collapsed && (
              <div className="folder-navigation">
                <button
                  aria-label="全部图片"
                  className={`folder-nav-item ${isGallery && activeFolder === "all" ? "active" : ""}`}
                  onClick={() => navigate("/gallery")}
                >
                  <Icon name="grid" />
                  <span>全部图片</span>
                  <small>{images.length}</small>
                </button>
                <button
                  aria-label="未分类"
                  className={`folder-nav-item ${isGallery && activeFolder === "unfiled" ? "active" : ""}`}
                  onClick={() => navigate("/gallery/unfiled")}
                >
                  <Icon name="grid" />
                  <span>未分类</span>
                  <small>
                    {images.filter((a) => a.folderIds.length === 0).length}
                  </small>
                </button>
                <div className="folders-heading">
                  <span>我的文件夹</span>
                  <button
                    className="icon-button"
                    aria-label="新建文件夹"
                    onClick={newFolder}
                  >
                    <Icon name="plus" size={24} />
                  </button>
                </div>
                <div className="folder-nav-list">
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      aria-label={f.name}
                      className={`folder-nav-item ${isGallery && activeFolder === f.id ? "active" : ""}`}
                      onClick={() => navigate("/gallery/" + f.id)}
                    >
                      <Icon name="folder" />
                      <span title={f.name}>{f.name}</span>
                      <small>
                        {
                          images.filter((a) => a.folderIds.includes(f.id))
                            .length
                        }
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="account-menu-wrap">
          <button
            ref={accountTrigger}
            className="account-trigger"
            aria-label="我的账户"
            aria-expanded={accountMenu}
            onClick={() => setAccountMenu(!accountMenu)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAccountMenu(false);
            }}
          >
            <span className="avatar">
              {currentUser.username.charAt(0).toUpperCase()}
            </span>
            {(!collapsed || isSettings) && (
              <>
                <span>
                  <span>我的账户</span>
                  <small>{currentUser.username}</small>
                </span>
                <Icon name="chevronDown" size={15} />
              </>
            )}
          </button>
          {accountMenu && (
            <>
              <button
                className="menu-dismiss"
                tabIndex={-1}
                aria-label="关闭账户菜单"
                onClick={() => setAccountMenu(false)}
              />
              <AccountMenu
                onNavigate={(target) => {
                  navigate(target);
                  setAccountMenu(false);
                }}
                onClose={() => {
                  setAccountMenu(false);
                  accountTrigger.current?.focus();
                }}
                onSignOut={() => {
                  signOut();
                  setAccountMenu(false);
                }}
                notify={notify}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
