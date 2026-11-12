import { useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import type { Notify } from "../../types";
import { errorText } from "./shared";
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
    (image) => image.userId === currentUser.id && !image.trashedAt && imageIds.includes(image.id),
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
