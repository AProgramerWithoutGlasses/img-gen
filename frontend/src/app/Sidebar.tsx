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

export function Sidebar({ isSettings, isGallery, collapsed, setCollapsed, settingsSection,
  activeFolder, navigate, signOut, notify }: Props) {
  const { currentUser } = useStudio();
  const [accountMenu, setAccountMenu] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(true);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setAccountMenu(false), [currentUser.id]);
  useEffect(() => { if (isGallery) setGalleryOpen(true); }, [isGallery]);
  const compact = collapsed && !isSettings;
  return (
    <aside className="sidebar" aria-label="工作空间导航">
      <div className="sidebar-brand">
        <span className="brand-mark"><Icon name="sparkles" size={19} /></span>
        {!compact && <strong>AI 图像</strong>}
        <button className="icon-button sidebar-toggle" aria-label={compact ? "展开侧栏" : "收起侧栏"}
          title={compact ? "展开侧栏" : "收起侧栏"} onClick={() => setCollapsed(!collapsed)}>
          <Icon name={compact ? "panelLeftOpen" : "collapse"} size={18} />
        </button>
      </div>
      <nav className="primary-nav" aria-label={isSettings ? "设置导航" : "主导航"}>
        {isSettings ? <>
          <button className="nav-item back-create" onClick={() => navigate("/create")}><Icon name="arrowLeft" /><span>返回创作</span></button>
          <div className="nav-label">个人设置</div>
          {(["account", "appearance", "credits"] as const).map(k => <button key={k}
            className={`nav-item ${settingsSection === k ? "active" : ""}`} onClick={() => navigate("/settings/" + k)}>
            <Icon name={k === "account" ? "user" : k === "appearance" ? "sun" : "coins"} /><span>{settingsLabels[k]}</span>
          </button>)}
          {currentUser.role === "admin" && <><div className="nav-label admin-label">管理员面板</div>
            {(["users", "requests", "prices"] as const).map(k => <button key={k}
              className={`nav-item ${settingsSection === k ? "active" : ""}`} onClick={() => navigate("/settings/" + k)}>
              <Icon name={k === "users" ? "user" : k === "requests" ? "grid" : "coins"} /><span>{settingsLabels[k]}</span>
            </button>)}
          </>}
        </> : <>
          {!compact && <div className="nav-label">工作空间</div>}
          <button className={`nav-item ${!isGallery ? "active" : ""}`} aria-label="图像创作" title="图像创作"
            aria-current={!isGallery ? "page" : undefined} onClick={() => navigate("/create")}>
            <Icon name="sparkles" />{!compact && <span>图像创作</span>}
          </button>
          <button className={`nav-item nav-group-toggle ${isGallery ? "is-current" : ""}`} aria-label="我的图片" title="我的图片"
            aria-expanded={compact ? false : galleryOpen} aria-controls="gallery-navigation"
            onClick={() => { if (compact) { setCollapsed(false); setGalleryOpen(true); } else setGalleryOpen(v => !v); }}>
            <Icon name="images" />{!compact && <><span>我的图片</span><Icon name="chevronDown" size={15} className={galleryOpen ? "nav-chevron open" : "nav-chevron"} /></>}
          </button>
          {!compact && <div className={`nav-submenu ${galleryOpen ? "open" : ""}`} id="gallery-navigation" inert={!galleryOpen}>
            <div className="nav-submenu-inner">
              <button className={`nav-subitem ${isGallery && activeFolder === "all" ? "active" : ""}`}
                aria-label="全部图片" title="全部图片"
                aria-current={isGallery && activeFolder === "all" ? "page" : undefined} onClick={() => navigate("/gallery")}>
                <Icon name="grid" size={17} /><span>全部图片</span>
              </button>
              <button className={`nav-subitem ${isGallery && activeFolder !== "all" ? "active" : ""}`}
                aria-label="文件夹管理" title="文件夹管理"
                aria-current={isGallery && activeFolder === "folders" ? "page" : undefined} onClick={() => navigate("/gallery/folders")}>
                <Icon name="folder" size={17} /><span>文件夹管理</span>
              </button>
            </div>
          </div>}
        </>}
      </nav>
      <div className="sidebar-bottom"><div className="account-menu-wrap">
        <button ref={accountTrigger} className="account-trigger" aria-label="我的账户" title="我的账户" aria-expanded={accountMenu}
          onClick={() => setAccountMenu(v => !v)} onKeyDown={event => { if (event.key === "Escape") setAccountMenu(false); }}>
          <span className="avatar">{currentUser.username.charAt(0).toUpperCase()}</span>
          {!compact && <><span><span>我的账户</span><small>{currentUser.username}</small></span><Icon name="chevronDown" size={15} /></>}
        </button>
        {accountMenu && <><button className="menu-dismiss" tabIndex={-1} aria-label="关闭账户菜单" onClick={() => setAccountMenu(false)} />
          <AccountMenu onNavigate={target => { navigate(target); setAccountMenu(false); }}
            onClose={() => { setAccountMenu(false); accountTrigger.current?.focus(); }}
            onSignOut={() => { signOut(); setAccountMenu(false); }} notify={notify} />
        </>}
      </div></div>
    </aside>
  );
}
