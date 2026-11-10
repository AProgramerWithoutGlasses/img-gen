import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ImageAsset, Notify, PreviewCollectionOptions, SettingsSection } from "../types";

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
    images: ImageAsset[];
    activeId: string;
    options?: PreviewCollectionOptions;
    loading?: boolean;
    loadError?: string;
  } | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const previewEpoch = useRef(0);
  const previewRead = useRef<{ controller: AbortController; promise: Promise<ImageAsset[] | undefined> } | null>(null);
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
  const closePreview = useCallback(() => {
    previewEpoch.current++;
    previewRead.current?.controller.abort();
    previewRead.current = null;
    previewRef.current = null;
    setPreview(null);
  }, []);
  useEffect(() => {
    closePreview();
    setPreviewFolder(null);
    return () => { previewRead.current?.controller.abort(); };
  }, [currentUser.id, closePreview]);
  const openPreview = (image: ImageAsset, collection: ImageAsset[], options?: PreviewCollectionOptions) => {
    closePreview();
    const next = { images: collection, activeId: image.id, options };
    previewRef.current = next;
    setPreview(next);
  };
  const assetsById = useMemo(() => new Map(data.assets.map(image => [image.id, image])), [data.assets]);
  const previewImages = useMemo(() => preview?.images.map(image => assetsById.get(image.id) ?? image) ?? [], [preview?.images, assetsById]);
  const selectedImage = preview
    ? assetsById.get(preview.activeId) ?? preview.images.find(image => image.id === preview.activeId)
    : undefined;
  const previewIndex = preview?.images.findIndex(image => image.id === preview.activeId) ?? -1;
  const loadMorePreview = (manual = false): Promise<ImageAsset[] | undefined> => {
    if (previewRead.current) return previewRead.current.promise;
    const current = previewRef.current;
    const cursor = current?.options?.nextCursor;
    if (!current || !cursor || !actions.listImages || (current.loadError && !manual)) return Promise.resolve(undefined);
    const session = previewEpoch.current;
    const controller = new AbortController();
    setPreview(previous => previous ? { ...previous, loading: true, loadError: undefined } : previous);
    const promise = actions.listImages({ folderId: current.options?.folderId, cursor, signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted || session !== previewEpoch.current) return undefined;
        const latest = previewRef.current;
        if (!latest) return undefined;
        const merged = new Map(latest.images.map(image => [image.id, image]));
        for (const image of page.images) merged.set(image.id, image);
        const images = [...merged.values()];
        const next = { ...latest, images, loading: false, loadError: undefined,
          options: { ...latest.options, total: page.total, nextCursor: page.nextCursor } };
        previewRef.current = next;
        setPreview(next);
        return images;
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && session === previewEpoch.current) {
          const message = error instanceof Error ? error.message : "图片加载失败";
          const latest = previewRef.current;
          if (latest) { previewRef.current = { ...latest, loading: false, loadError: message }; setPreview(previewRef.current); }
        }
        return undefined;
      }).finally(() => { if (previewRead.current?.controller === controller) previewRead.current = null; });
    previewRead.current = { controller, promise };
    return promise;
  };
  const switchPreview = (step: number) => {
    const current = previewRef.current;
    if (!current) return;
    const target = current.images.findIndex(image => image.id === current.activeId) + step;
    const select = (images?: ImageAsset[]) => {
      const latest = previewRef.current;
      const image = images?.[target];
      if (!latest || !image) return;
      previewRef.current = { ...latest, activeId: image.id };
      setPreview(previewRef.current);
    };
    if (target >= 0 && target < current.images.length) select(current.images);
    else if (target >= current.images.length) void loadMorePreview().then(select);
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
        onRegister={async (username, password) => {
          await actions.register(username, password);
          navigate("/create");
        }}
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
            onEdit={image => {
              setPendingAttachment(image);
              navigate("/create");
            }}
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
          total={preview.options?.total ?? preview.images.length}
          switchPreview={switchPreview}
          onClose={closePreview}
          onFolder={(id) => setPreviewFolder([id])}
          onAdd={setPendingAttachment}
          onCreate={() => navigate("/create")}
          isGallery={isGallery}
          collection={previewImages}
          hasMore={!!preview.options?.nextCursor}
          loadingMore={preview.loading}
          loadError={preview.loadError}
          onLoadMore={() => { void loadMorePreview(); }}
          onRetryMore={() => { void loadMorePreview(true); }}
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
