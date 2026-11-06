import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import { downloadImage } from "../../lib/images";
import type { ImageAsset, Notify, PreviewImage } from "../../types";
import "./gallery.css";

interface GalleryPageProps {
  activeFolder: string;
  onChangeFolder: (id: string) => void;
  onCreateFolder: () => void;
  onCreate?: () => void;
  onPreview: PreviewImage;
  notify: Notify;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试。";
}

function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, close]);
}

interface FolderPickerProps {
  imageIds: string[];
  onClose: () => void;
  notify: Notify;
}

export function FolderPicker({ imageIds, onClose, notify }: FolderPickerProps) {
  const { data, actions, currentUser } = useStudio();
  const [targets, setTargets] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const images = data.assets.filter(
    (image) => image.userId === currentUser.id && imageIds.includes(image.id),
  );
  const folders = data.folders.filter(
    (folder) => folder.userId === currentUser.id,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!creating && !targets.length) || (creating && !name.trim()))
      return;
    setBusy(true);
    setError("");
    try {
      if (creating) {
        const folder = await actions.createFolder(name.trim());
        setTargets((previous) => [...previous, folder.id]);
        setCreating(false);
        setName("");
      } else {
        await actions.addToFolders(
          images.map((image) => image.id),
          targets,
        );
        notify(`已将 ${images.length} 张图片加入文件夹`);
        onClose();
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={creating ? "新建文件夹" : "加入文件夹"}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="gallery-folder-dialog"
    >
      <form onSubmit={submit}>
        {creating ? (
          <label className="gallery-form-label">
            文件夹名称
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              disabled={busy}
              required
            />
          </label>
        ) : (
          <>
            <div className="gallery-folder-targets">
              {folders.map((folder) => {
                const count = images.filter((image) =>
                  image.folderIds.includes(folder.id),
                ).length;
                const allJoined = images.length > 0 && count === images.length;
                return (
                  <label
                    className={`gallery-folder-target${allJoined ? " is-joined" : ""}`}
                    key={folder.id}
                  >
                    <input
                      type="checkbox"
                      aria-label={folder.name}
                      checked={allJoined || targets.includes(folder.id)}
                      disabled={allJoined || busy}
                      ref={(element) => {
                        if (element)
                          element.indeterminate =
                            count > 0 &&
                            !allJoined &&
                            !targets.includes(folder.id);
                      }}
                      onChange={(event) =>
                        setTargets((previous) =>
                          event.target.checked
                            ? [...previous, folder.id]
                            : previous.filter((id) => id !== folder.id),
                        )
                      }
                    />
                    <Icon name="folder" />
                    <span>{folder.name}</span>
                    <small>
                      {count} / {images.length} 已加入
                    </small>
                  </label>
                );
              })}
            </div>
            <button
              className="btn gallery-new-folder"
              type="button"
              onClick={() => {
                setCreating(true);
                setError("");
              }}
            >
              <Icon name="plus" />
              新建文件夹
            </button>
          </>
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
            disabled={busy}
            onClick={() => {
              if (creating) {
                setCreating(false);
                setError("");
              } else onClose();
            }}
          >
            {creating ? "返回" : "取消"}
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              (creating ? !name.trim() : !targets.length || !images.length)
            }
          >
            {busy ? "处理中…" : creating ? "创建" : "加入"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImageMenu({
  image,
  collection,
  folderId,
  onPreview,
  onOrganize,
  onRemove,
  onClose,
  notify,
}: {
  image: ImageAsset;
  collection: ImageAsset[];
  folderId?: string;
  onPreview: PreviewImage;
  onOrganize: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  return (
    <div
      className="gallery-menu gallery-image-menu"
      role="menu"
      aria-label={`${image.name} 操作`}
      ref={ref}
    >
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onPreview(image, collection);
        }}
      >
        <Icon name="expand" />
        查看大图
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          try {
            downloadImage(image);
          } catch (error) {
            notify(errorText(error));
          }
        }}
      >
        <Icon name="download" />
        下载
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onOrganize([image.id]);
        }}
      >
        <Icon name="folder" />
        加入文件夹
      </button>
      {folderId && (
        <button
          role="menuitem"
          onClick={() => {
            onClose();
            onRemove([image.id]);
          }}
        >
          <Icon name="arrowLeft" />
          从此文件夹移出
        </button>
      )}
    </div>
  );
}

function GalleryImage({
  image,
  collection,
  selecting,
  selected,
  onToggle,
  onPreview,
  folderId,
  onOrganize,
  onRemove,
  notify,
  width,
  height,
}: {
  image: ImageAsset;
  collection: ImageAsset[];
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onPreview: PreviewImage;
  folderId?: string;
  onOrganize: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  notify: Notify;
  width: number;
  height: number;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <article
      className={`gallery-tile${selected ? " is-selected" : ""}`}
      style={{ width, height }}
    >
      <button
        className="gallery-tile-image"
        aria-label={
          selecting
            ? `${selected ? "取消选择" : "选择"} ${image.name}`
            : `查看 ${image.name}`
        }
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggle : () => onPreview(image, collection)}
      >
        <img
          src={image.thumbnailUrl ?? image.url}
          alt={image.name}
          loading="lazy"
          draggable={false}
        />
      </button>
      {selecting ? (
        <input
          type="checkbox"
          className="gallery-image-checkbox"
          aria-label={`选中 ${image.name}`}
          checked={selected}
          onChange={onToggle}
        />
      ) : (
        <button
          className="icon-button gallery-image-more"
          aria-label={`${image.name} 更多操作`}
          aria-expanded={menu}
          onClick={() => setMenu((previous) => !previous)}
        >
          <Icon name="more" />
        </button>
      )}
      {menu && (
        <ImageMenu
          image={image}
          collection={collection}
          folderId={folderId}
          onPreview={onPreview}
          onOrganize={onOrganize}
          onRemove={onRemove}
          notify={notify}
          onClose={() => setMenu(false)}
        />
      )}
    </article>
  );
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
