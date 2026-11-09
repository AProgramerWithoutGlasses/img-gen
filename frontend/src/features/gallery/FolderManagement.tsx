import { useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { useStudio } from "../../state/StudioContext";
import type { Folder, Notify } from "../../types";
import { errorText, useOutsideClose } from "./shared";

function FolderCard({
  folder,
  count,
  onOpen,
  onManage,
}: {
  folder: Folder;
  count: number;
  onOpen: () => void;
  onManage: (kind: "rename" | "delete") => void;
}) {
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useOutsideClose(anchor, () => setMenu(false));

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <article className="folder-management-card">
      <button className="folder-card-open" onClick={onOpen} aria-label={`打开文件夹 ${folder.name}`}>
        <Icon name="folder" size={32} />
        <strong>{folder.name}</strong>
        <span>{count} 张图片</span>
      </button>
      <div className="folder-card-menu-anchor" ref={anchor}>
        <button
          ref={trigger}
          className="icon-button folder-card-more"
          aria-label={`${folder.name} 更多操作`}
          aria-expanded={menu}
          aria-controls={menu ? menuId : undefined}
          aria-haspopup="menu"
          onClick={() => setMenu((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setMenu(true);
            }
          }}
        >
          <Icon name="more" size={20} />
        </button>
        {menu && (
          <div className="gallery-menu folder-card-menu" id={menuId} role="menu" aria-label={`${folder.name} 操作`} onKeyDown={menuKeys}>
            <button
              role="menuitem"
              autoFocus
              onClick={() => { setMenu(false); trigger.current?.focus(); onManage("rename"); }}
            >
              <Icon name="edit" />重命名
            </button>
            <button
              role="menuitem"
              className="gallery-danger"
              onClick={() => { setMenu(false); trigger.current?.focus(); onManage("delete"); }}
            >
              <Icon name="trash" />删除文件夹
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function FolderManagement({
  onOpenFolder,
  onCreateFolder,
  notify,
}: {
  onOpenFolder: (id: string) => void;
  onCreateFolder: () => void;
  notify: Notify;
}) {
  const { data, currentUser, actions } = useStudio();
  const [dialog, setDialog] = useState<{ id: string; kind: "rename" | "delete" } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const folders = data.folders.filter((folder) => folder.userId === currentUser.id);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const image of data.assets) {
      if (image.userId !== currentUser.id) continue;
      for (const folderId of image.folderIds) result.set(folderId, (result.get(folderId) ?? 0) + 1);
    }
    return result;
  }, [data.assets, currentUser.id]);
  const selectedFolder = dialog ? folders.find((folder) => folder.id === dialog.id) : undefined;

  function openDialog(folder: Folder, kind: "rename" | "delete") {
    setName(folder.name);
    setError("");
    setDialog({ id: folder.id, kind });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || !selectedFolder || saveLock.current || (dialog.kind === "rename" && !name.trim())) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      if (dialog.kind === "delete") {
        await actions.deleteFolder(selectedFolder.id);
        notify("文件夹已删除，图片已保留");
      } else {
        await actions.renameFolder(selectedFolder.id, name.trim());
        notify("文件夹已重命名");
      }
      setDialog(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="gallery-page folder-management-page" aria-label="文件夹管理">
      <header className="gallery-heading">
        <div className="gallery-heading-copy">
          <div className="gallery-heading-title"><h1>文件夹管理</h1><span>{folders.length} 个</span></div>
          <p>整理你的创作，图片可加入多个文件夹。</p>
        </div>
        <div className="gallery-heading-actions">
          <button className="btn btn-primary" onClick={onCreateFolder}><Icon name="plus" size={18} />新建文件夹</button>
        </div>
      </header>
      {folders.length ? (
        <div className="folder-management-grid">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              count={counts.get(folder.id) ?? 0}
              onOpen={() => onOpenFolder(folder.id)}
              onManage={(kind) => openDialog(folder, kind)}
            />
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <Icon name="folder" size={44} />
          <div><h2>还没有文件夹</h2><p>创建一个文件夹，开始整理你的图片。</p></div>
          <button className="btn btn-primary" onClick={onCreateFolder}><Icon name="plus" size={18} />新建文件夹</button>
        </div>
      )}
      {dialog && selectedFolder && (
        <Modal
          title={dialog.kind === "delete" ? `删除“${selectedFolder.name}”？` : "重命名文件夹"}
          className="gallery-folder-dialog"
          onClose={() => { if (!busy) setDialog(null); }}
        >
          <form onSubmit={submit}>
            {dialog.kind === "rename" ? (
              <label className="gallery-form-label">文件夹名称
                <input autoFocus value={name} maxLength={60} required disabled={busy} onChange={(event) => { setName(event.target.value); setError(""); }} />
              </label>
            ) : (
              <p className="gallery-delete-message">只删除文件夹，其中的图片仍保留在图库和其他文件夹中。</p>
            )}
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="gallery-dialog-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button>
              <button className={`btn ${dialog.kind === "delete" ? "gallery-danger-button" : "btn-primary"}`} disabled={busy || (dialog.kind === "rename" && !name.trim())}>
                {busy ? "处理中…" : dialog.kind === "delete" ? "删除文件夹" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
