import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import "./dialog-attachments.css";

export interface DialogAttachmentItem {
  id: string;
  name: string;
  url?: string;
  width?: number;
  height?: number;
  status?: "uploading" | "failed" | "ready";
  error?: string;
}

interface Props {
  items: DialogAttachmentItem[];
  disabled: boolean;
  onRemove: (id: string) => void;
  active: boolean;
}

export default function DialogAttachments({ items, disabled, onRemove, active }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(324);
  const [imageState, setImageState] = useState<{ key: string; state: "loading" | "ready" | "failed" }>({ key: "", state: "loading" });
  const strip = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingId = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    pendingId.current = null;
  }, []);
  const clearClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const closePreview = useCallback(() => {
    clearOpen();
    clearClose();
    setPreviewId(null);
  }, [clearOpen, clearClose]);
  const scheduleClose = useCallback(() => {
    clearOpen();
    clearClose();
    closeTimer.current = setTimeout(() => {
      setPreviewId(null);
      closeTimer.current = null;
    }, 130);
  }, [clearOpen, clearClose]);
  const schedulePreview = useCallback((item: DialogAttachmentItem) => {
    clearOpen();
    clearClose();
    if (!active || !item.url || item.status === "uploading" || item.status === "failed") {
      setPreviewId(null);
      return;
    }
    if (previewId === item.id) return;
    pendingId.current = item.id;
    openTimer.current = setTimeout(() => {
      const candidate = itemsRef.current.find((entry) => entry.id === item.id);
      if (candidate?.url && candidate.status !== "uploading" && candidate.status !== "failed") {
        setPreviewId(candidate.id);
      }
      openTimer.current = null;
      pendingId.current = null;
    }, 200);
  }, [active, clearOpen, clearClose, previewId]);

  useEffect(() => () => {
    clearOpen();
    clearClose();
  }, [clearOpen, clearClose]);
  useEffect(() => {
    if (!active || !items.length) {
      closePreview();
      return;
    }
    const current = items.find((entry) => entry.id === previewId);
    if (previewId && (!current?.url || current.status === "uploading" || current.status === "failed")) closePreview();
    if (pendingId.current && !items.some((entry) => entry.id === pendingId.current)) clearOpen();
  }, [active, items, previewId, closePreview, clearOpen]);
  useEffect(() => {
    if (!active) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [active, closePreview]);

  const selected = items.find((item) => item.id === previewId);
  const previewKey = selected?.url ? `${selected.id}:${selected.url}` : "";
  const loadState = imageState.key === previewKey ? imageState.state : "loading";
  const pictureRatio = selected?.width && selected?.height ? selected.width / selected.height : 1;
  const pictureWidth = Math.min(316, Math.max(1, previewHeight - 36) * pictureRatio);
  const pictureHeight = Math.min(Math.max(1, previewHeight - 36), 316 / pictureRatio);
  useLayoutEffect(() => {
    if (!previewId || !active) return;
    const measure = () => {
      const top = strip.current?.getBoundingClientRect().top ?? 340;
      setPreviewHeight(Math.max(52, Math.min(324, top - 10.188 - 8)));
    };
    measure();
    const resize = new ResizeObserver(measure);
    if (strip.current) resize.observe(strip.current);
    // The composer can grow or move without this component changing size.
    const composerArea = strip.current?.closest(".composer-area") ?? strip.current?.parentElement?.parentElement;
    if (composerArea) resize.observe(composerArea);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [previewId, active]);

  const leaveCard = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.relatedTarget;
    if (target instanceof Node && (event.currentTarget.contains(target) || preview.current?.contains(target))) return;
    scheduleClose();
  };

  if (!active || !items.length) return null;
  const columns = Math.max(4, Math.min(6, items.length));
  const stripWidth = 16 + columns * 62 + (columns - 1) * 7;

  return (
    <div className="dialog-attachments">
      <div ref={strip} className="attachment-row dialog-attachments-track" style={{ width: stripWidth }} aria-label="附件栏">
        <div className="dialog-attachments-cards">
          {items.map((item) => (
            <div
              className="attachment-item dialog-attachment-card"
              key={item.id}
              data-attachment-id={item.id}
              tabIndex={0}
              aria-label={`参考图：${item.name}${item.status === "uploading" ? "，上传中" : item.status === "failed" ? "，上传失败" : ""}`}
              onMouseEnter={() => schedulePreview(item)}
              onMouseLeave={scheduleClose}
              onFocus={() => schedulePreview(item)}
              onBlur={leaveCard}
            >
              {item.url && item.status !== "uploading" && item.status !== "failed" ? (
                <img className="dialog-attachment-thumbnail" src={item.url} alt={item.name} width={62} height={62} decoding="async" />
              ) : (
                <div className={`dialog-attachment-placeholder${item.status === "failed" ? " dialog-attachment-placeholder-failed" : ""}`} role="status" aria-label={item.error || undefined}>
                  <span>{item.status === "failed" ? "上传失败" : "上传中"}</span>
                  {item.status === "uploading" && <span className="dialog-attachment-progress" aria-hidden="true" />}
                </div>
              )}
              <button
                type="button"
                className="attachment-remove dialog-attachment-remove"
                aria-label={`移除${item.name}`}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  closePreview();
                  onRemove(item.id);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
      {selected?.url && (
        <div
          ref={preview}
          className="dialog-attachment-preview"
          role="region"
          aria-label="参考图预览"
          style={{ height: previewHeight }}
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
        >
          <div className="dialog-attachment-preview-image">
            <img
              key={previewKey}
              src={selected.url}
              alt={selected.name}
              width={selected.width}
              height={selected.height}
              style={{ width: pictureWidth, height: pictureHeight }}
              decoding="async"
              onLoad={() => setImageState({ key: previewKey, state: "ready" })}
              onError={() => setImageState({ key: previewKey, state: "failed" })}
              className={loadState === "ready" ? "dialog-attachment-preview-ready" : undefined}
            />
            {loadState !== "ready" && <span role="status" className={loadState === "failed" ? "dialog-attachment-preview-error" : undefined}>{loadState === "failed" ? "预览暂时无法加载" : "正在载入预览…"}</span>}
          </div>
          <div className="dialog-attachment-preview-name"><span>{selected.name}</span></div>
        </div>
      )}
    </div>
  );
}
