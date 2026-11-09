import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { createPortal } from "react-dom";
import { RenditionImage } from "../../components/RenditionImage";
import type { Attachment } from "../../types";
import { attachmentPreviewLayout, visibleAttachmentDimensions } from "./attachment-preview";
import type { AttachmentPreviewLayout } from "./attachment-preview";
import "./dialog-attachments.css";

export interface DialogAttachmentItem extends Partial<Attachment> {
  id: string;
  name: string;
  status?: "uploading" | "failed" | "ready";
  error?: string;
}

interface Props {
  items: DialogAttachmentItem[];
  baseId?: string | null;
  disabled: boolean;
  onRemove: (id: string) => void;
  active: boolean;
}

export default function DialogAttachments({ items, baseId, disabled, onRemove, active }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [layoutState, setLayout] = useState<{ key: string; value: AttachmentPreviewLayout } | null>(null);
  const [density, setDensity] = useState(window.devicePixelRatio || 1);
  const [natural, setNatural] = useState<{ key: string; width: number; height: number } | null>(null);
  const [imageState, setImageState] = useState<{ key: string; state: "loading" | "ready" | "failed" }>({ key: "", state: "loading" });
  const container = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
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
  const selectedKey = selected?.url ? `${selected.id}:${selected.url}` : "";
  const layout = layoutState?.key === selectedKey ? layoutState.value : null;
  const dimensions = visibleAttachmentDimensions(selected ?? {}, natural?.key === selectedKey ? natural : undefined);
  const previewSource = selected ? { ...selected, ...dimensions } : {};
  // A sharper rendition must not hide an already displayed image. In particular,
  // an original fallback keeps the same src across DPR changes and fires no load.
  const previewKey = selectedKey;
  const currentPreviewKey = useRef(previewKey);
  currentPreviewKey.current = previewKey;
  const loadState = imageState.key === previewKey ? imageState.state : "loading";
  useLayoutEffect(() => {
    if (!previewId || !active) {
      setLayout(null);
      return;
    }
    const measure = () => {
      const anchor = cards.current.get(previewId);
      if (!anchor || !container.current) return;
      const next = attachmentPreviewLayout(dimensions, anchor.getBoundingClientRect(),
        { left: 0, top: 0 }, document.documentElement.clientWidth);
      setLayout(previous => {
        if (!next) return null;
        const old = previous?.key === selectedKey ? previous.value : null;
        return old && old.left === next.left && old.top === next.top &&
          old.width === next.width && old.height === next.height &&
          old.pictureWidth === next.pictureWidth && old.pictureHeight === next.pictureHeight
          ? previous : { key: selectedKey, value: next };
      });
      setDensity(window.devicePixelRatio || 1);
    };
    measure();
    const resize = new ResizeObserver(measure);
    if (strip.current) resize.observe(strip.current);
    if (container.current) resize.observe(container.current);
    const anchor = cards.current.get(previewId);
    if (anchor) resize.observe(anchor);
    // The composer can grow or move without this component changing size.
    const composerArea = container.current?.closest(".composer-area");
    if (composerArea) resize.observe(composerArea);
    // Sidebar collapse can move a fixed-width composer without resizing it.
    const workspace = container.current?.closest(".workspace");
    if (workspace) resize.observe(workspace);
    const media = window.matchMedia(`(resolution: ${density}dppx)`);
    media.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      resize.disconnect();
      media.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [previewId, selectedKey, active, dimensions.width, dimensions.height, density, items.length]);

  const leaveCard = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.relatedTarget;
    if (target instanceof Node && (event.currentTarget.contains(target) || preview.current?.contains(target))) return;
    scheduleClose();
  };

  if (!active || !items.length) return null;
  const columns = Math.max(4, Math.min(6, items.length));
  const stripWidth = 16 + columns * 62 + (columns - 1) * 7;

  return (
    <div ref={container} className="dialog-attachments">
      <div ref={strip} className="attachment-row dialog-attachments-track" style={{ width: stripWidth }} aria-label="附件栏">
        <div className="dialog-attachments-cards">
          {items.map((item) => (
            <div
              className="attachment-item dialog-attachment-card"
              key={item.id}
              ref={element => { if (element) cards.current.set(item.id, element); else cards.current.delete(item.id); }}
              data-attachment-id={item.id}
              data-base-image={baseId === item.id || undefined}
              tabIndex={0}
              aria-label={`${baseId === item.id ? "基础图" : "参考图"}：${item.name}${item.status === "uploading" ? "，上传中" : item.status === "failed" ? "，上传失败" : ""}`}
              onMouseEnter={() => schedulePreview(item)}
              onMouseLeave={scheduleClose}
              onFocus={() => schedulePreview(item)}
              onBlur={leaveCard}
            >
              {item.url && item.status !== "uploading" && item.status !== "failed" ? (
                <RenditionImage source={item} displayWidth={62} displayHeight={62} fit="cover" purpose="thumbnail"
                  className="dialog-attachment-thumbnail" alt={item.name} width={62} height={62} decoding="async" />
              ) : (
                <div className={`dialog-attachment-placeholder${item.status === "failed" ? " dialog-attachment-placeholder-failed" : ""}`} role="status" aria-label={item.error || undefined}>
                  <span>{item.status === "failed" ? "上传失败" : "上传中"}</span>
                  {item.status === "uploading" && <span className="dialog-attachment-progress" aria-hidden="true" />}
                </div>
              )}
              {baseId === item.id && <span className="dialog-base-image-badge">基础图</span>}
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
      {selected?.url && layout && createPortal(
        <div
          key={selected.id}
          ref={preview}
          className="dialog-composer-scope dialog-attachment-preview"
          role="region"
          aria-label="参考图预览"
          data-attachment-id={selected.id}
          style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
        >
          <div className="dialog-attachment-preview-image">
            <RenditionImage
              key={selectedKey}
              source={previewSource}
              displayWidth={layout.pictureWidth}
              displayHeight={layout.pictureHeight}
              alt={selected.name}
              width={dimensions.width}
              height={dimensions.height}
              style={{ width: layout.pictureWidth, height: layout.pictureHeight }}
              decoding="async"
              onLoad={event => {
                if (currentPreviewKey.current !== previewKey) return;
                const image = event.currentTarget;
                setImageState({ key: previewKey, state: "ready" });
                if (image.naturalWidth && image.naturalHeight) {
                  setNatural(previous => previous?.key === selectedKey && previous.width === image.naturalWidth &&
                    previous.height === image.naturalHeight ? previous : {
                      key: selectedKey, width: image.naturalWidth, height: image.naturalHeight,
                    });
                }
              }}
              onError={() => {
                if (currentPreviewKey.current === previewKey) setImageState({ key: previewKey, state: "failed" });
              }}
              className={loadState === "ready" ? "dialog-attachment-preview-ready" : undefined}
            />
            {loadState !== "ready" && <span role="status" className={loadState === "failed" ? "dialog-attachment-preview-error" : undefined}>{loadState === "failed" ? "预览暂时无法加载" : "正在载入预览…"}</span>}
          </div>
          <div className="dialog-attachment-preview-name"><span>{selected.name}</span></div>
        </div>, document.body,
      )}
    </div>
  );
}
