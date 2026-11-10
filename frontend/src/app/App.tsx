import { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "../components/Toast";
import { Sidebar } from "./Sidebar";
import { settingsLabels } from "./navigation";
import { Modal } from "../components/Modal";
import CreationPage from "../features/create/CreationPage";
import LoginPage from "../features/auth/LoginPage";
import GalleryPage from "../features/gallery/GalleryPage";
import { FolderPicker } from "../features/gallery/FolderPicker";
import { ImagePreview } from "../features/gallery/ImagePreview";
import SettingsPage from "../features/settings/SettingsPage";
import { StudioProvider, useStudio } from "../state/StudioContext";
import type { ImageAsset, Notify, SettingsSection } from "../types";

function routeFromHash() {
  return location.hash.replace(/^#/, "") || "/create";
}
function StudioApp() {
  const { data, currentUser, actions } = useStudio();
  const [route, setRoute] = useState(routeFromHash);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("imggen-sidebar-collapsed") === "true");
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
  useEffect(() => { localStorage.setItem("imggen-sidebar-collapsed", String(collapsed)); }, [collapsed]);
  useEffect(() => {
    const handler = (event: Event) =>
      notify((event as CustomEvent<string>).detail);
    addEventListener("studio:error", handler);
    return () => removeEventListener("studio:error", handler);
  }, [notify]);
  const isGallery = route.startsWith("/gallery");
  const sectionKey = route.split("/")[2] || "account";
  const settingsSection = (
    sectionKey in settingsLabels ? sectionKey : "account"
  ) as SettingsSection;
  const activeFolder = isGallery ? route.split("/")[2] || "all" : "all";
  const navigate = (target: string) => {
    if (target === route) return;
    if (dirty.current) {
      setGuardTarget(target);
      return;
    }
    location.hash = target;
    setRoute(target);
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
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 3000);
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
  if (!currentUser.id || route === "/login")
    return (
      <LoginPage
        onLogin={async (username, password) => {
          await actions.signIn(username, password);
          navigate(route === "/login" ? "/create" : route);
        }}
      />
    );
  return (
    <div
      className={`app-shell ${collapsed && !isSettings ? "sidebar-collapsed" : ""}`}
    >
      <Sidebar
        isSettings={isSettings}
        isGallery={isGallery}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        settingsSection={settingsSection}
        activeFolder={activeFolder}
        navigate={navigate}
        newFolder={newFolder}
        signOut={() => {
          if (dirty.current) setGuardTarget("__logout");
          else actions.signOut();
        }}
        notify={notify}
      />
      <main className={`workspace${!isGallery && !isSettings ? " workbench-workspace" : ""}`}>
        {isSettings && <header className="page-header">
          <h1>
            {isSettings
              ? settingsLabels[settingsSection]
              : isGallery
                ? "我的图片"
                : "图像创作"}
          </h1>
          {import.meta.env.MODE === "preview" && (
            <span className="preview-badge">本地预览</span>
          )}
        </header>}
        <CreationPage
          key={currentUser.id}
          active={!isGallery && !isSettings}
          onPreview={openPreview}
          onFolder={setPreviewFolder}
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
        <ImagePreview
          selectedImage={selectedImage}
          previewIndex={previewIndex}
          total={preview.ids.length}
          switchPreview={switchPreview}
          onClose={() => setPreview(null)}
          onFolder={(id) => setPreviewFolder([id])}
          onAdd={setPendingAttachment}
          onCreate={() => navigate("/create")}
          isGallery={isGallery}
          collection={preview.ids.map(id => data.assets.find(image => image.id === id)).filter((image): image is ImageAsset => !!image)}
        />
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
        <Toast text={toast.text} action={toast.action} onClose={() => setToast(null)} />
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
