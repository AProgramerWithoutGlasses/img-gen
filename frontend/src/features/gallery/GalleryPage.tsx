import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import type { ImageAsset, Notify, PreviewImage } from "../../types";
import "./gallery.css";
import { errorText, useOutsideClose } from "./shared";
import { FolderPicker } from "./FolderPicker";
import { GalleryImage } from "./GalleryImage";
interface GalleryPageProps {
  activeFolder: string;
  onChangeFolder: (id: string) => void;
  onCreateFolder: () => void;
  onCreate?: () => void;
  onPreview: PreviewImage;
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
  const [sourceTarget, setSourceTarget] = useState<string | null>(null);
  const [width, setWidth] = useState(1040);
  const gridRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const userAssets = useMemo(
    () => data.assets.filter((image) => image.userId === currentUser.id),
    [data.assets, currentUser.id],
  );
  const userFolders = data.folders.filter(
    (folder) => folder.userId === currentUser.id,
  );
  const currentFolder = userFolders.find(
    (folder) => folder.id === activeFolder,
  );
  useOutsideClose(menuRef, () => setFolderMenu(false));

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
  }, []);

  const images = useMemo(
    () =>
      userAssets
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
        ),
    [userAssets, activeFolder, sourceTarget],
  );
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
  const selectedVisible = selected.filter((id) =>
    images.some((image) => image.id === id),
  );
  const title = sourceTarget
    ? "选择图片"
    : activeFolder === "all"
      ? "全部图片"
      : activeFolder === "unfiled"
        ? "未分类"
        : (currentFolder?.name ?? "文件夹");

  function toggle(id: string) {
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

  return (
    <section className="gallery-page" aria-label="我的图片">
      <header className="gallery-heading">
        <div className="gallery-heading-title">
          <h1>{title}</h1>
          <span>{images.length} 张</span>
        </div>
        <div className="gallery-heading-actions">
          {images.length > 0 && (
            <button
              className="btn"
              onClick={() => {
                if (selecting) cancelSelection();
                else setSelecting(true);
              }}
            >
              {selecting ? "取消选择" : "选择图片"}
            </button>
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
                    onToggle={() => toggle(image.id)}
                    onPreview={onPreview}
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
        {images.length === 0 && (
          <div className="gallery-empty">
            <Icon name={currentFolder ? "folder" : "image"} />
            <h2>
              {currentFolder
                ? "这个文件夹还没有图片"
                : activeFolder === "unfiled" && userAssets.length
                  ? "所有图片都已归类"
                  : "还没有生成的图片"}
            </h2>
            {currentFolder && userAssets.length ? (
              <button
                className="btn"
                onClick={() => {
                  setSourceTarget(currentFolder.id);
                  setSelecting(true);
                }}
              >
                从图库选择
              </button>
            ) : activeFolder === "unfiled" && userAssets.length ? (
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
      {selecting && selectedVisible.length > 0 && (
        <div
          className="gallery-selection-toolbar"
          role="toolbar"
          aria-label="图片整理"
        >
          <span>已选 {selectedVisible.length} 张</span>
          <button className="btn" onClick={cancelSelection} disabled={busy}>
            取消选择
          </button>
          {sourceTarget ? (
            <button
              className="btn btn-primary"
              onClick={() => void addToSource()}
              disabled={busy}
            >
              {busy ? "加入中…" : "加入此文件夹"}
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary"
                onClick={() => setOrganizing(selectedVisible)}
                disabled={busy}
              >
                加入文件夹
              </button>
              {currentFolder && (
                <button
                  className="btn"
                  onClick={() => void remove(selectedVisible)}
                  disabled={busy}
                >
                  移出此文件夹
                </button>
              )}
            </>
          )}
        </div>
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
                className="btn btn-primary"
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
