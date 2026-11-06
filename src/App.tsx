import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { Modal } from "./components/Modal";
import CreationPage from "./features/create/CreationPage";
import GalleryPage, { FolderPicker } from "./features/gallery/GalleryPage";
import SettingsPage from "./features/settings/SettingsPage";
import { StudioProvider, useStudio } from "./state/StudioContext";
import { MODELS } from "./config/models";
import { downloadImage } from "./lib/images";
import type { ImageAsset, Notify, SettingsSection } from "./types";
import "./features/gallery/gallery.css";
import "./features/settings/settings.css";

const settingsLabels: Record<SettingsSection, string> = {
  account: "账户与安全",
  appearance: "外观与输入",
  credits: "积分",
  users: "用户管理",
  requests: "请求记录",
  prices: "模型价格",
};
function routeFromHash() {
  return location.hash.replace(/^#/, "") || "/create";
}
function StudioApp() {
  const { data, currentUser, actions } = useStudio();
  const [route, setRoute] = useState(routeFromHash);
  const [collapsed, setCollapsed] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [requestUserFilter, setRequestUserFilter] = useState<string>();
  const [preview, setPreview] = useState<{
    ids: string[];
    activeId: string;
  } | null>(null);
  const [previewFolder, setPreviewFolder] = useState<string[] | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<ImageAsset | null>(
    null,
  );
  const [toast, setToast] = useState<{
    text: string;
    action?: { label: string; run: () => void };
  } | null>(null);
  const [guardTarget, setGuardTarget] = useState<string | null>(null);
  const dirty = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;
  const notify = useCallback<Notify>(
    (text, action) => setToast({ text, action }),
    [],
  );
  const isSettings = route.startsWith("/settings");
  const isGallery = route.startsWith("/gallery");
  const sectionKey = route.split("/")[2] || "account";
  const settingsSection = (
    sectionKey in settingsLabels ? sectionKey : "account"
  ) as SettingsSection;
  const activeFolder = isGallery ? route.split("/")[2] || "all" : "all";
  const folders = data.folders.filter((f) => f.userId === currentUser.id);
  const images = data.assets.filter((a) => a.userId === currentUser.id);
  const navigate = (target: string) => {
    if (target === route) return;
    if (dirty.current) {
      setGuardTarget(target);
      return;
    }
    location.hash = target;
    setRoute(target);
    setAccountMenu(false);
  };
  useEffect(() => {
    const handle = () => {
      const next = routeFromHash();
      if (dirty.current && next !== routeRef.current) {
        history.replaceState(null, "", "#" + routeRef.current);
        setGuardTarget(next);
      } else setRoute(next);
    };
    addEventListener("hashchange", handle);
    return () => removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        data.preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : data.preferences.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data.preferences.theme]);
  useEffect(() => {
    setAccountMenu(false);
    setPreview(null);
    setPreviewFolder(null);
  }, [currentUser.id]);
  const openPreview = (image: ImageAsset, collection: ImageAsset[]) =>
    setPreview({ ids: collection.map((a) => a.id), activeId: image.id });
  const selectedImage = preview
    ? data.assets.find((a) => a.id === preview.activeId)
    : undefined;
  const previewIndex = preview?.ids.indexOf(preview.activeId) ?? -1;
  const switchPreview = (step: number) => {
    if (preview && preview.ids[previewIndex + step])
      setPreview({ ...preview, activeId: preview.ids[previewIndex + step] });
  };
  const newFolder = () => {
    setFolderName("");
    setFolderError("");
    setFolderModal(true);
  };
  async function createFolder() {
    if (savingFolder) return;
    setSavingFolder(true);
    try {
      const f = await actions.createFolder(folderName);
      setFolderModal(false);
      navigate("/gallery/" + f.id);
      notify("文件夹已创建");
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSavingFolder(false);
    }
  }
  if (!currentUser.id)
    return (
      <main className="login-page">
        <div className="login-card">
          <div className="brand">
            <span className="brand-mark">△</span>
            <strong>AI 图像</strong>
          </div>
          <h1>本地预览</h1>
          <p>选择一个预览账号</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              actions.signIn("admin");
              navigate("/create");
            }}
          >
            管理员预览
          </button>
          <button
            className="btn"
            onClick={() => {
              actions.signIn("user");
              navigate("/create");
            }}
          >
            普通用户预览
          </button>
        </div>
      </main>
    );
  return (
    <div
      className={`app-shell ${collapsed && !isSettings ? "sidebar-collapsed" : ""}`}
    >
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
              {isGallery && !collapsed && (
                <div className="folder-navigation">
                  <button
                    aria-label="全部图片"
                    className={`folder-nav-item ${activeFolder === "all" ? "active" : ""}`}
                    onClick={() => navigate("/gallery")}
                  >
                    <Icon name="grid" />
                    <span>全部图片</span>
                    <small>{images.length}</small>
                  </button>
                  <button
                    aria-label="未分类"
                    className={`folder-nav-item ${activeFolder === "unfiled" ? "active" : ""}`}
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
                        className={`folder-nav-item ${activeFolder === f.id ? "active" : ""}`}
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
          {(!collapsed || isSettings) && (
            <div className="balance-card">
              <div>
                <small>积分余额</small>
                <strong>{currentUser.balance.toLocaleString()}</strong>
              </div>
              <button className="btn" onClick={() => notify("充值入口待接入")}>
                充值
              </button>
            </div>
          )}
          <div className="account-menu-wrap">
            <button
              className="account-trigger"
              aria-label="我的账户"
              aria-expanded={accountMenu}
              onClick={() => setAccountMenu(!accountMenu)}
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
                <div className="account-menu">
                  <strong>{currentUser.username}</strong>
                  <button onClick={() => navigate("/settings/account")}>
                    <Icon name="settings" size={17} />
                    设置
                  </button>
                  <button
                    onClick={() => {
                      void actions
                        .setPreferences({
                          theme:
                            data.preferences.theme === "dark"
                              ? "light"
                              : "dark",
                        })
                        .catch((e) => notify(e.message));
                    }}
                  >
                    <Icon name="moon" size={17} />
                    {data.preferences.theme === "dark"
                      ? "浅色主题"
                      : "深色主题"}
                  </button>
                  <button
                    onClick={() => {
                      if (dirty.current) setGuardTarget("__logout");
                      else actions.signOut();
                      setAccountMenu(false);
                    }}
                  >
                    <Icon name="logout" size={17} />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="page-header">
          <h1>
            {isSettings
              ? settingsLabels[settingsSection]
              : isGallery
                ? "我的图片"
                : "图像创作"}
          </h1>
          <span className="preview-badge">本地预览</span>
        </header>
        <CreationPage
          key={currentUser.id}
          active={!isGallery && !isSettings}
          onPreview={openPreview}
          notify={notify}
          pendingAttachment={pendingAttachment}
          onAttachmentHandled={() => setPendingAttachment(null)}
        />
        {isGallery && (
          <GalleryPage
            activeFolder={activeFolder}
            onChangeFolder={(f) =>
              navigate("/gallery" + (f === "all" ? "" : "/" + f))
            }
            onCreateFolder={newFolder}
            onCreate={() => navigate("/create")}
            onPreview={openPreview}
            notify={notify}
          />
        )}
        {isSettings && (
          <SettingsPage
            section={settingsSection}
            onNavigate={(s, f) => {
              setRequestUserFilter(f);
              navigate("/settings/" + s);
            }}
            requestUserFilter={requestUserFilter}
            notify={notify}
            onPreview={openPreview}
            onDirtyChange={(d) => {
              dirty.current = d;
            }}
          />
        )}
      </main>
      {folderModal && (
        <Modal
          title="新建文件夹"
          onClose={() => !savingFolder && setFolderModal(false)}
          footer={
            <>
              <button
                className="btn"
                disabled={savingFolder}
                onClick={() => setFolderModal(false)}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={!folderName.trim() || savingFolder}
                onClick={() => void createFolder()}
              >
                创建
              </button>
            </>
          }
        >
          <label className="form-field">
            文件夹名称
            <input
              autoFocus
              value={folderName}
              maxLength={60}
              onChange={(e) => {
                setFolderName(e.target.value);
                setFolderError("");
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  folderName.trim()
                )
                  void createFolder();
              }}
            />
          </label>
          {folderError && (
            <p role="alert" className="field-error">
              {folderError}
            </p>
          )}
        </Modal>
      )}
      {preview && selectedImage && (
        <Modal
          title="图片预览"
          className="image-preview"
          onClose={() => setPreview(null)}
        >
          <div className="preview-grid">
            <div className="preview-stage">
              <img src={selectedImage.url} alt={selectedImage.name} />
              <button
                className="icon-button preview-prev"
                aria-label="上一张"
                disabled={previewIndex <= 0}
                onClick={() => switchPreview(-1)}
              >
                <Icon name="chevronLeft" />
              </button>
              <button
                className="icon-button preview-next"
                aria-label="下一张"
                disabled={previewIndex >= preview.ids.length - 1}
                onClick={() => switchPreview(1)}
              >
                <Icon name="chevronRight" />
              </button>
              <span className="preview-position">
                {previewIndex + 1} / {preview.ids.length}
              </span>
            </div>
            <aside className="preview-details">
              <h3>生成信息</h3>
              <dl>
                <dt>提示词</dt>
                <dd>{selectedImage.prompt}</dd>
                <dt>模型</dt>
                <dd>
                  {
                    MODELS.find((m) => m.id === selectedImage.options.modelId)
                      ?.name
                  }
                </dd>
                <dt>生成参数</dt>
                <dd>
                  {[
                    selectedImage.options.quality,
                    selectedImage.options.ratio,
                    selectedImage.options.resolution,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
                <dt>生成时间</dt>
                <dd>
                  {new Date(selectedImage.createdAt).toLocaleString("zh-CN")}
                </dd>
                <dt>所在文件夹</dt>
                <dd>
                  {data.folders
                    .filter((f) => selectedImage.folderIds.includes(f.id))
                    .map((f) => f.name)
                    .join(" · ") || "未分类"}
                </dd>
              </dl>
              <div className="preview-actions">
                <button
                  className="btn"
                  onClick={() => downloadImage(selectedImage)}
                >
                  <Icon name="download" size={16} />
                  下载
                </button>
                <button
                  className="btn"
                  disabled={
                    !isGallery &&
                    data.generations.some(
                      (job) =>
                        job.userId === currentUser.id &&
                        job.status === "processing",
                    )
                  }
                  onClick={() => {
                    if (isGallery) setPreviewFolder([selectedImage.id]);
                    else {
                      setPendingAttachment(selectedImage);
                      setPreview(null);
                      navigate("/create");
                    }
                  }}
                >
                  {isGallery ? "加入文件夹" : "添加"}
                </button>
              </div>
            </aside>
          </div>
        </Modal>
      )}
      {previewFolder && (
        <FolderPicker
          imageIds={previewFolder}
          onClose={() => setPreviewFolder(null)}
          notify={notify}
        />
      )}
      {guardTarget && (
        <Modal
          title="放弃未保存的修改？"
          onClose={() => setGuardTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setGuardTarget(null)}>
                继续编辑
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  dirty.current = false;
                  const target = guardTarget;
                  setGuardTarget(null);
                  if (target === "__logout") {
                    actions.signOut();
                    location.hash = "/create";
                    setRoute("/create");
                  } else {
                    location.hash = target;
                    setRoute(target);
                  }
                }}
              >
                放弃修改
              </button>
            </>
          }
        >
          <p>尚未保存的价格将不会生效。</p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export default function App() {
  return (
    <StudioProvider>
      <StudioApp />
    </StudioProvider>
  );
}
