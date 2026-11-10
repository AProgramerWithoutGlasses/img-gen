import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import { ImageSelectionToolbar } from "../../components/ImageSelectionToolbar";
import { downloadImages } from "../../lib/images";
import { MAX_BASE_IMAGES } from "../../config/attachments";
import type { ImageAsset, Notify, PreviewImage } from "../../types";
import "./gallery.css";
import { errorText, useOutsideClose } from "./shared";
import { FolderPicker } from "./FolderPicker";
import { GalleryImage } from "./GalleryImage";
import { FolderManagement } from "./FolderManagement";
interface GalleryPageProps {
  activeFolder: string;
  onChangeFolder: (id: string) => void;
  onCreateFolder: () => void;
  onCreate?: () => void;
  onPreview: PreviewImage;
  onEdit: (images: ImageAsset[]) => void;
  notify: Notify;
}

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(date);
  if (dateKey(value) === dateKey(today.toISOString())) return `今天 · ${label}`;
  if (dateKey(value) === dateKey(yesterday.toISOString()))
    return `昨天 · ${label}`;
  return `${date.getFullYear()} 年 ${label}`;
}

function layoutRows(images: ImageAsset[], width: number) {
  const rows: { images: ImageAsset[]; height: number; widths: number[] }[] = [];
  let items: ImageAsset[] = [];
  let sum = 0;
  const ratio = (image: ImageAsset) =>
    Math.max(0.2, Math.min(5, image.width / (image.height || 1)));
  const finish = (last: boolean) => {
    if (!items.length) return;
    const height = Math.min(
      last ? 208 : 280,
      (width - (items.length - 1) * 12) / sum,
    );
    rows.push({
      images: items,
      height,
      widths: items.map((image) => height * ratio(image)),
    });
    items = [];
    sum = 0;
  };
  for (const image of images) {
    items.push(image);
    sum += ratio(image);
    if ((width - (items.length - 1) * 12) / sum <= 218 || items.length >= 6)
      finish(false);
  }
  finish(true);
  return rows;
}

export default function GalleryPage({
  activeFolder,
  onChangeFolder,
  onCreateFolder,
  onCreate,
  onPreview,
  onEdit,
  notify,
}: GalleryPageProps) {
  const { data, actions, currentUser } = useStudio();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState<string[] | null>(null);
  const [folderMenu, setFolderMenu] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"rename" | "delete" | null>(
    null,
  );
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const selectionHintId = useId();
  const [sourceTarget, setSourceTarget] = useState<string | null>(null);
  const [width, setWidth] = useState(1040);
  const gridRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const [pages, setPages] = useState<{ key: string; ids: string[]; total: number; nextCursor?: string }>({ key: "", ids: [], total: 0 });
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const listImages = actions.listImages;
  const queryFolder = sourceTarget ? "all" : activeFolder;
  const queryKey = `${currentUser.id}\n${queryFolder}`;
  const queryCount = queryFolder === "all" ? data.imageSummary?.total : data.imageSummary?.folderCounts[queryFolder];
  const loadPage = useCallback(async (cursor?: string, reset = false) => {
    if (!listImages || queryFolder === "folders" || pageRequest.current) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageLoading(true);
    setPageError("");
    try {
      const result = await listImages({ folderId: queryFolder, cursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      setPages(previous => ({ key: queryKey, total: result.total, nextCursor: result.nextCursor,
        ids: [...new Set([...(reset || previous.key !== queryKey ? [] : previous.ids), ...result.images.map(image => image.id)])],
      }));
    } catch (failure) {
      if (!controller.signal.aborted) setPageError(errorText(failure));
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null;
        setPageLoading(false);
      }
    }
  }, [listImages, queryFolder, queryKey]);
  const userAssets = useMemo(
    () => data.assets.filter((image) => image.userId === currentUser.id),
    [data.assets, currentUser.id],
  );
  const assetsByID = useMemo(() => new Map(userAssets.map(image => [image.id, image])), [userAssets]);
  const userFolders = data.folders.filter(
    (folder) => folder.userId === currentUser.id,
  );
  const currentFolder = userFolders.find(
    (folder) => folder.id === activeFolder,
  );
  useOutsideClose(menuRef, () => setFolderMenu(false));

  useEffect(() => {
    pageRequest.current?.abort();
    pageRequest.current = null;
    setPages({ key: queryKey, ids: [], total: queryCount ?? 0 });
    setPageLoading(false);
    setPageError("");
    if (listImages && queryFolder !== "folders") void loadPage(undefined, true);
    return () => {
      pageRequest.current?.abort();
      pageRequest.current = null;
    };
  }, [listImages, loadPage, queryKey, queryFolder, queryCount]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !listImages || pages.key !== queryKey || !pages.nextCursor || pageLoading || pageError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadPage(pages.nextCursor);
    }, { root: target.closest(".gallery-page"), rootMargin: "320px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [listImages, pages.key, pages.nextCursor, queryKey, pageLoading, pageError, loadPage]);

  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setSourceTarget(null);
    setFolderMenu(false);
    setOrganizing(null);
    setFolderDialog(null);
  }, [activeFolder]);
  useEffect(() => {
    const target = gridRef.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [activeFolder]);

  const images = useMemo(
    () => {
      const assets = listImages
        ? (pages.key === queryKey ? pages.ids.map(id => assetsByID.get(id)).filter((image): image is ImageAsset => !!image) : [])
        : userAssets;
      return assets
        .filter(
          (image) =>
            sourceTarget ||
            activeFolder === "all" ||
            (activeFolder === "unfiled"
              ? image.folderIds.length === 0
              : image.folderIds.includes(activeFolder)),
        )
        .sort((a, b) =>
          a.batchId === b.batchId
            ? a.outputIndex - b.outputIndex
            : b.createdAt.localeCompare(a.createdAt),
        );
    },
    [userAssets, assetsByID, activeFolder, sourceTarget, listImages, pages.key, pages.ids, queryKey],
  );
  const imageTotal = listImages ? (pages.key === queryKey ? pages.total : queryCount ?? 0) : images.length;
  const hasUserAssets = (data.imageSummary?.total ?? userAssets.length) > 0;
  const groups = useMemo(() => {
    const result: { key: string; date: string; images: ImageAsset[] }[] = [];
    for (const image of images) {
      const key = dateKey(image.createdAt);
      const last = result[result.length - 1];
      if (last?.key === key) last.images.push(image);
      else result.push({ key, date: image.createdAt, images: [image] });
    }
    return result;
  }, [images]);
  const loadedIDs = new Set(images.map(image => image.id));
  const selectedVisible = selected.filter(id => loadedIDs.has(id));
  const selectedImages = selectedVisible.map(id => assetsByID.get(id)).filter((image): image is ImageAsset => !!image);
  const allSelected = images.length > 0 && selectedVisible.length === images.length;
  const editLimitExceeded = selectedImages.length > MAX_BASE_IMAGES;
  const title = sourceTarget
    ? "选择图片"
    : activeFolder === "all"
      ? "全部图片"
      : activeFolder === "unfiled"
        ? "未分类"
        : (currentFolder?.name ?? "文件夹");

  function toggle(id: string) {
    if (busy || downloading) return;
    setSelecting(true);
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  }
  function cancelSelection() {
    setSelecting(false);
    setSelected([]);
    setSourceTarget(null);
  }

  useEffect(() => {
    if (!selecting) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busy || downloading
        || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="menu"]')) return;
      event.preventDefault();
      cancelSelection();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selecting, busy, downloading]);

  async function downloadSelected() {
    if (!selectedImages.length || downloading) return;
    setDownloading(true);
    try {
      await downloadImages(selectedImages);
      notify(`已下载 ${selectedImages.length} 张图片`);
    } catch (failure) {
      notify(errorText(failure));
    } finally {
      setDownloading(false);
    }
  }

  async function remove(imageIds: string[]) {
    if (!currentFolder || busy) return;
    const folder = currentFolder;
    setBusy(true);
    try {
      await actions.removeFromFolder(imageIds, folder.id);
      setSelected([]);
      notify(`已从“${folder.name}”移出 ${imageIds.length} 张图片`, {
        label: "撤销",
        run: () => {
          void actions
            .addToFolders(imageIds, [folder.id])
            .then(() => notify("已撤销移出"))
            .catch((failure: unknown) => notify(errorText(failure)));
        },
      });
    } catch (failure) {
      notify(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveFolder(event: FormEvent) {
    event.preventDefault();
    if (
      !currentFolder ||
      busy ||
      (folderDialog === "rename" && !folderName.trim())
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (folderDialog === "delete") {
        await actions.deleteFolder(currentFolder.id);
        onChangeFolder("all");
        notify("文件夹已删除，图片已保留");
      } else {
        await actions.renameFolder(currentFolder.id, folderName.trim());
        notify("文件夹已重命名");
      }
      setFolderDialog(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addToSource() {
    if (!sourceTarget || !selectedVisible.length || busy) return;
    setBusy(true);
    try {
      await actions.addToFolders(selectedVisible, [sourceTarget]);
      notify(`已加入 ${selectedVisible.length} 张图片`);
      cancelSelection();
    } catch (failure) {
      notify(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (activeFolder === "folders") {
    return <FolderManagement onOpenFolder={onChangeFolder} onCreateFolder={onCreateFolder} notify={notify} />;
  }

  return (
    <section className="gallery-page" aria-label="我的图片">
      <header className="gallery-heading">
        <div className="gallery-heading-copy">
          {currentFolder && !sourceTarget && (
            <button className="gallery-back" onClick={() => onChangeFolder("folders")}><Icon name="chevronLeft" size={15} />文件夹管理</button>
          )}
          <div className="gallery-heading-title">
            <h1>{title}</h1>
            <span>{imageTotal} 张</span>
          </div>
          <p>{sourceTarget ? "选中要加入此文件夹的图片。" : currentFolder ? "属于这个文件夹的图片，也会保留在全部图片中。" : "所有生成的图片都在这里，按时间整理。"}</p>
        </div>
        <div className="gallery-heading-actions">
          {images.length > 0 && !selecting && (
            <button className="btn btn-primary" onClick={() => setSelecting(true)}>选择图片</button>
          )}
          {currentFolder && !sourceTarget && (
            <div className="gallery-folder-menu-anchor" ref={menuRef}>
              <button
                className="icon-button gallery-folder-more"
                aria-label="文件夹管理"
                aria-expanded={folderMenu}
                onClick={() => setFolderMenu((previous) => !previous)}
              >
                <Icon name="more" />
              </button>
              {folderMenu && (
                <div
                  className="gallery-menu"
                  role="menu"
                  aria-label="文件夹管理"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setFolderName(currentFolder.name);
                      setError("");
                      setFolderDialog("rename");
                      setFolderMenu(false);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    role="menuitem"
                    className="gallery-danger"
                    onClick={() => {
                      setError("");
                      setFolderDialog("delete");
                      setFolderMenu(false);
                    }}
                  >
                    删除文件夹
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <div ref={gridRef} className="gallery-grid">
        {groups.map((group) => (
          <section
            className="gallery-date-group"
            key={group.key}
            aria-label={dateLabel(group.date)}
          >
            <h2>{dateLabel(group.date)}</h2>
            {layoutRows(group.images, width).map((row, index) => (
              <div className="gallery-row" key={group.key + index}>
                {row.images.map((image, imageIndex) => (
                  <GalleryImage
                    key={image.id}
                    image={image}
                    collection={images}
                    width={row.widths[imageIndex]}
                    height={row.height}
                    selecting={selecting}
                    selected={selectedVisible.includes(image.id)}
                    busy={busy || downloading}
                    onToggle={() => toggle(image.id)}
                    onEdit={onEdit}
                    onPreview={(image, collection) => onPreview(image, collection, listImages ? {
                      folderId: queryFolder, total: imageTotal, nextCursor: pages.nextCursor,
                    } : undefined)}
                    folderId={sourceTarget ? undefined : currentFolder?.id}
                    onOrganize={setOrganizing}
                    onRemove={(ids) => void remove(ids)}
                    notify={notify}
                  />
                ))}
              </div>
            ))}
          </section>
        ))}
        {listImages && (pageLoading || pageError || pages.nextCursor) && (
          <div ref={loadMoreRef} className="gallery-load-more">
            {pageError && <p className="field-error" role="alert">{pageError}</p>}
            <button className="btn" disabled={pageLoading} onClick={() => void loadPage(pages.nextCursor, !pages.ids.length)}>
              {pageLoading ? "加载中…" : pageError ? "重试" : "加载更多"}
            </button>
          </div>
        )}
        {images.length === 0 && !pageLoading && !pageError && (
          <div className="gallery-empty">
            <Icon name={currentFolder ? "folder" : "image"} />
            <h2>
              {currentFolder
                ? "这个文件夹还没有图片"
                : activeFolder === "unfiled" && hasUserAssets
                  ? "所有图片都已归类"
                  : "还没有生成的图片"}
            </h2>
            {currentFolder && hasUserAssets ? (
              <button
                className="btn"
                onClick={() => {
                  setSourceTarget(currentFolder.id);
                  setSelecting(true);
                }}
              >
                从图库选择
              </button>
            ) : activeFolder === "unfiled" && hasUserAssets ? (
              <button className="btn" onClick={() => onChangeFolder("all")}>
                查看全部图片
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (onCreate) onCreate();
                  else window.location.hash = "/create";
                }}
              >
                去图像创作
              </button>
            )}
            {!userFolders.length && (
              <button className="gallery-empty-new" onClick={onCreateFolder}>
                新建文件夹
              </button>
            )}
          </div>
        )}
      </div>
      {selecting && (
        <ImageSelectionToolbar count={selectedVisible.length} allSelected={allSelected}
          label="图片整理" selectAllLabel={listImages && pages.nextCursor ? "全选已加载" : "全选"}
          closeDisabled={busy || downloading} onClose={cancelSelection}
          onSelectAll={() => { if (!busy && !downloading) setSelected(allSelected ? [] : images.map(image => image.id)); }}>
          <span className="workbench-edit-guard" tabIndex={editLimitExceeded ? 0 : undefined}
            title={editLimitExceeded ? `最多选择${MAX_BASE_IMAGES}张基础图` : undefined}
            aria-describedby={editLimitExceeded ? selectionHintId : undefined}>
            <button type="button" disabled={busy || downloading || !selectedImages.length || editLimitExceeded}
              onClick={() => { if (selectedImages.length && !editLimitExceeded) onEdit(selectedImages); }}>
              <Icon name="edit" size={16} />继续修图
            </button>
            {editLimitExceeded && <span className="workbench-selection-hint" id={selectionHintId}>最多选择{MAX_BASE_IMAGES}张基础图</span>}
          </span>
          {sourceTarget ? (
            <button type="button" onClick={() => void addToSource()} disabled={busy || downloading || !selectedVisible.length}>
              <Icon name="folderPlus" size={16} />
              {busy ? "加入中…" : "加入此文件夹"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setOrganizing(selectedVisible)} disabled={busy || downloading || !selectedVisible.length}>
                <Icon name="folderPlus" size={16} />加入文件夹
              </button>
              {currentFolder && (
                <button
                  type="button"
                  onClick={() => void remove(selectedVisible)}
                  disabled={busy || downloading || !selectedVisible.length}
                >
                  <Icon name="arrowLeft" size={16} />移出此文件夹
                </button>
              )}
            </>
          )}
          <button type="button" onClick={() => void downloadSelected()} disabled={busy || downloading || !selectedVisible.length}>
            <Icon name="download" size={16} />{downloading ? "准备下载…" : "下载"}
          </button>
        </ImageSelectionToolbar>
      )}
      {organizing && (
        <FolderPicker
          imageIds={organizing}
          onClose={() => setOrganizing(null)}
          notify={notify}
        />
      )}
      {folderDialog && currentFolder && (
        <Modal
          title={
            folderDialog === "delete"
              ? `删除“${currentFolder.name}”？`
              : "重命名文件夹"
          }
          onClose={() => {
            if (!busy) setFolderDialog(null);
          }}
          className="gallery-folder-dialog"
        >
          <form onSubmit={saveFolder}>
            {folderDialog === "rename" ? (
              <label className="gallery-form-label">
                文件夹名称
                <input
                  autoFocus
                  value={folderName}
                  maxLength={60}
                  onChange={(event) => {
                    setFolderName(event.target.value);
                    setError("");
                  }}
                  disabled={busy}
                  required
                />
              </label>
            ) : (
              <p className="gallery-delete-message">
                只删除文件夹，其中的图片仍保留在图库和其他文件夹中。
              </p>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="gallery-dialog-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setFolderDialog(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className={`btn ${folderDialog === "delete" ? "gallery-danger-button" : "btn-primary"}`}
                disabled={
                  busy || (folderDialog === "rename" && !folderName.trim())
                }
              >
                {busy
                  ? "处理中…"
                  : folderDialog === "delete"
                    ? "删除文件夹"
                    : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
