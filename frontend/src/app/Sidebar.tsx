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
  activeFolder, navigate, newFolder, signOut, notify }: Props) {
  const { data, currentUser } = useStudio();
  const [accountMenu, setAccountMenu] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 680px)").matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const folders = data.folders.filter(folder => folder.userId === currentUser.id);
  const compact = narrow ? !mobileOpen : collapsed && !isSettings;

  useEffect(() => {
    const media = matchMedia("(max-width: 680px)");
    const change = () => {
      setNarrow(media.matches);
      setMobileOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    setAccountMenu(false);
    setMobileOpen(false);
  }, [currentUser.id]);
  useEffect(() => {
    if (isGallery && activeFolder !== "all") setFoldersOpen(true);
    setMobileOpen(false);
  }, [isGallery, activeFolder, isSettings, settingsSection]);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        sidebarToggle.current?.focus();
      }
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [mobileOpen]);

  const go = (target: string) => {
    navigate(target);
    setMobileOpen(false);
  };
  const toggle = () => {
    setAccountMenu(false);
    if (narrow) setMobileOpen(value => !value);
    else setCollapsed(!collapsed);
  };
  const toggleLabel = compact ? "展开侧栏" : "收起侧栏";
  const createFolderButton = <button className="icon-button sidebar-new-folder" aria-label="新建文件夹" title="新建文件夹"
    onClick={() => { newFolder(); setMobileOpen(false); }}><Icon name="plus" size={compact ? 18 : 16} /></button>;

  return <>
    {mobileOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="关闭侧栏"
      onClick={() => { setMobileOpen(false); sidebarToggle.current?.focus(); }} />}
    <aside className={"sidebar" + (compact ? " is-compact" : "") + (mobileOpen ? " is-mobile-open" : "")}
      aria-label="工作空间导航">
      <div className="sidebar-brand">
        <span className="brand-mark"><Icon name="sparkles" size={18} /></span>
        {!compact && <strong>AiCraft</strong>}
        {(narrow || !isSettings) && <button ref={sidebarToggle} className="icon-button sidebar-toggle" aria-label={toggleLabel}
          title={toggleLabel} aria-expanded={!compact} onClick={toggle}>
          <Icon name={compact ? "panelLeftOpen" : "collapse"} size={18} />
        </button>}
      </div>
      <nav className="primary-nav" aria-label={isSettings ? "设置导航" : "主导航"}>
        {isSettings ? <>
          <button className="nav-item back-create" aria-label="返回创作" title="返回创作" onClick={() => go("/create")}>
            <Icon name="arrowLeft" size={18} />{!compact && <span>返回创作</span>}
          </button>
          {!compact && <div className="nav-label">个人设置</div>}
          {(["account", "appearance", "credits"] as const).map(key => <button key={key}
            className={"nav-item " + (settingsSection === key ? "active" : "")}
            aria-label={settingsLabels[key]} title={settingsLabels[key]}
            aria-current={settingsSection === key ? "page" : undefined} onClick={() => go("/settings/" + key)}>
            <Icon name={key === "account" ? "user" : key === "appearance" ? "sun" : "coins"} size={18} />
            {!compact && <span>{settingsLabels[key]}</span>}
          </button>)}
          {currentUser.role === "admin" && <>
            {!compact && <div className="nav-label admin-label">管理员面板</div>}
            {(["users", "requests", "prices"] as const).map(key => <button key={key}
              className={"nav-item " + (settingsSection === key ? "active" : "")}
              aria-label={settingsLabels[key]} title={settingsLabels[key]}
              aria-current={settingsSection === key ? "page" : undefined} onClick={() => go("/settings/" + key)}>
              <Icon name={key === "users" ? "user" : key === "requests" ? "grid" : "coins"} size={18} />
              {!compact && <span>{settingsLabels[key]}</span>}
            </button>)}
          </>}
        </> : <>
          <button className={"nav-item " + (!isGallery ? "active" : "")} aria-label="图像创作" title="图像创作"
            aria-current={!isGallery ? "page" : undefined} onClick={() => go("/create")}>
            <Icon name="sparkles" size={18} />{!compact && <span>图像创作</span>}
          </button>
          <div className="nav-group-heading">
            {!compact && <span>我的图片</span>}
            {compact && createFolderButton}
          </div>
          <button className={"nav-item " + (isGallery && activeFolder === "all" ? "active" : "")}
            aria-label="全部图片" title="全部图片" aria-current={isGallery && activeFolder === "all" ? "page" : undefined}
            onClick={() => go("/gallery")}><Icon name="grid" size={18} />{!compact && <span>全部图片</span>}</button>
          <div className={"nav-folder-row " + (isGallery && activeFolder === "folders" ? "active" : "")}>
            <button className="nav-item nav-folder-link" aria-label="文件夹管理" title="文件夹管理"
              aria-current={isGallery && activeFolder === "folders" ? "page" : undefined} onClick={() => go("/gallery/folders")}>
              <Icon name="folders" size={18} />{!compact && <span>文件夹</span>}
            </button>
            {!compact && <button className="icon-button nav-folder-toggle" aria-label="文件夹列表"
              title={foldersOpen ? "收起文件夹列表" : "展开文件夹列表"}
              aria-expanded={foldersOpen} aria-controls="folder-navigation" onClick={() => setFoldersOpen(value => !value)}>
              <Icon name="chevronDown" size={16} className={"nav-chevron" + (foldersOpen ? " open" : "")} />
            </button>}
            {!compact && createFolderButton}
          </div>
          {!compact && <div className={"nav-submenu " + (foldersOpen ? "open" : "")} id="folder-navigation" inert={!foldersOpen}>
            <div className="nav-submenu-inner">
              {folders.map(folder => <button key={folder.id} className={"nav-subitem " + (isGallery && activeFolder === folder.id ? "active" : "")}
                title={folder.name} aria-label={folder.name} aria-current={isGallery && activeFolder === folder.id ? "page" : undefined}
                onClick={() => go("/gallery/" + folder.id)}><Icon name="folder" size={18} /><span>{folder.name}</span></button>)}
            </div>
          </div>}
        </>}
      </nav>
      <div className="sidebar-bottom"><div className="account-menu-wrap">
        <button ref={accountTrigger} className="account-trigger" aria-label="我的账户" title="我的账户" aria-expanded={accountMenu}
          onClick={() => setAccountMenu(value => !value)} onKeyDown={event => { if (event.key === "Escape") setAccountMenu(false); }}>
          <span className="avatar">{currentUser.username.charAt(0).toUpperCase()}</span>
          {!compact && <><span><span>我的账户</span><small>{currentUser.username}</small></span>
            <span className="account-trigger-balance" aria-label={`积分余额 ${currentUser.balance.toLocaleString("zh-CN")}`}
              title={`${currentUser.balance.toLocaleString("zh-CN")} 积分`}>{currentUser.balance.toLocaleString("zh-CN")}</span></>}
        </button>
        {accountMenu && <><button className="menu-dismiss" tabIndex={-1} aria-label="关闭账户菜单" onClick={() => setAccountMenu(false)} />
          <AccountMenu onNavigate={target => { go(target); setAccountMenu(false); }}
            onClose={() => { setAccountMenu(false); accountTrigger.current?.focus(); }}
            onSignOut={() => { signOut(); setAccountMenu(false); setMobileOpen(false); }} notify={notify} />
        </>}
      </div></div>
    </aside>
  </>;
}
