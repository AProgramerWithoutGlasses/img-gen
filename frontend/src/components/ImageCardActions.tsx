import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ImageAsset } from "../types";
import { Icon } from "./Icon";
import "./image-card-actions.css";

export interface ImageCardExtraAction {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ImageCardActionsProps {
  image: ImageAsset;
  onEdit: () => void;
  onFolder: () => void;
  onDownload: () => void;
  compact?: boolean;
  active?: boolean;
  selecting?: boolean;
  editDisabled?: boolean;
  editDisabledReason?: string;
  extraActions?: ImageCardExtraAction[];
  onTrash?: () => void;
  trash?: boolean;
  onRestore?: () => void;
  onPurge?: () => void;
}

// The gallery and completed workbench results share the same actions. Image
// loading, reveal animation and ownership remain with their parent components.
export function ImageCardActions({ image, onEdit, onFolder, onDownload, compact = false,
  active = true, selecting = false, editDisabled = false, editDisabledReason, extraActions = [],
  onTrash, trash = false, onRestore, onPurge }: ImageCardActionsProps) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 240 });
  const root = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hintId = useId();

  useEffect(() => { setMenu(false); }, [image.id, compact, selecting, active]);
  useEffect(() => {
    if (!menu) return;
    const host = root.current?.closest(".image-card");
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setMenu(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(false);
      more.current?.focus({ preventScroll: true });
    };
    const moved = (event: Event) => {
      if (event.type === "scroll" && panel.current?.contains(event.target as Node)) return;
      setMenu(false);
    };
    const leave = (event: Event) => {
      const related = (event as MouseEvent).relatedTarget;
      if (related instanceof Node && panel.current?.contains(related)) return;
      if (!panel.current?.querySelector(":focus-visible")) setMenu(false);
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    host?.addEventListener("mouseleave", leave);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
      host?.removeEventListener("mouseleave", leave);
    };
  }, [menu]);

  function placeMenu() {
    const box = more.current?.getBoundingClientRect();
    if (!box) return;
    const height = Math.min(((compact ? 4 : 1) + extraActions.length) * 34 + 12, innerHeight - 16);
    const below = innerHeight - box.bottom - 14;
    const top = below < height && box.top > below ? Math.max(8, box.top - height - 6) : box.bottom + 6;
    setPosition({ left: Math.max(8, Math.min(box.right - 176, innerWidth - 184)), top,
      maxHeight: Math.max(34, innerHeight - top - 8) });
  }
  function openMenu(focus = false) {
    setCopied("idle");
    placeMenu();
    setMenu(previous => focus || !previous);
    if (focus) requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  }
  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(image.prompt); setCopied("copied"); }
    catch { setCopied("failed"); }
  }
  function editButton(inMenu = false) {
    return <span className="image-card-edit-guard result-edit-guard" tabIndex={editDisabled && editDisabledReason ? 0 : undefined}
      title={editDisabled ? editDisabledReason : undefined} aria-describedby={editDisabled && editDisabledReason ? hintId : undefined}>
      <button type="button" role={inMenu ? "menuitem" : undefined} disabled={editDisabled}
        aria-label="继续修图" onClick={() => { setMenu(false); onEdit(); }}>
        <Icon name="edit" size={inMenu ? 16 : 17} /><span>继续修图</span>
      </button>
    </span>;
  }

  if (trash) return <div className={`image-card-actions image-card-trash-actions${compact ? " is-compact" : ""}`}>
    <button type="button" className="image-card-restore" aria-label="复原" title="复原" disabled={editDisabled} onClick={onRestore}>
      <Icon name="restore" size={17} /><span>复原</span>
    </button>
    <button type="button" className="image-card-purge" aria-label="彻底删除" title="彻底删除" disabled={editDisabled} onClick={onPurge}>
      <Icon name="trash" size={17} /><span>彻底删除</span>
    </button>
  </div>;

  return <div className={`image-card-actions result-actions${compact ? " is-compact" : ""}${menu ? " is-menu-open" : ""}`} ref={root}>
    <div className="image-card-left-actions result-left-actions">
      {editButton()}
      <button type="button" aria-label="加入文件夹" onClick={onFolder} disabled={editDisabled}><Icon name="folderPlus" size={17} /><span>加入文件夹</span></button>
    </div>
    <div className="image-card-right-actions">
      {onTrash && <button type="button" className="image-card-trash" aria-label="移入回收站" title="移入回收站" onClick={onTrash} disabled={editDisabled}><Icon name="trash" size={17} /></button>}
      <button type="button" className="image-card-download result-download" aria-label="下载" onClick={onDownload} disabled={editDisabled}><Icon name="download" size={17} /><span>下载</span></button>
    </div>
    <button type="button" className="image-card-more result-more" ref={more} onClick={() => openMenu()}
      aria-label="更多图片操作" aria-expanded={menu} aria-haspopup="menu"
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); openMenu(true); } }}>
      <Icon name="moreVertical" size={20} />
    </button>
    {editDisabled && editDisabledReason && <span id={hintId} className="image-card-action-hint">{editDisabledReason}</span>}
    {menu && createPortal(<div className="image-card-menu result-image-menu" ref={panel} role="menu" aria-label="图片操作"
      style={position} onKeyDown={menuKeys} onMouseLeave={event => {
        const host = root.current?.closest(".image-card");
        if (event.relatedTarget instanceof Node && host?.contains(event.relatedTarget)) return;
        if (!panel.current?.querySelector(":focus-visible")) setMenu(false);
      }}>
      {compact && <>
        {editButton(true)}
        <button type="button" role="menuitem" disabled={editDisabled} onClick={() => { setMenu(false); onFolder(); }}><Icon name="folderPlus" size={16} />加入文件夹</button>
        <button type="button" role="menuitem" disabled={editDisabled} onClick={() => { setMenu(false); onDownload(); }}><Icon name="download" size={16} />下载</button>
      </>}
      <button type="button" role="menuitem" onClick={() => { void copyPrompt(); }}><Icon name={copied === "copied" ? "check" : "copy"} size={16} />
        {copied === "copied" ? "已复制" : copied === "failed" ? "复制失败" : "复制提示词"}
      </button>
      {extraActions.map(action => <button key={action.label} type="button" role="menuitem" disabled={action.disabled}
        onClick={() => { setMenu(false); action.onClick(); }}><Icon name={action.icon} size={16} />{action.label}</button>)}
    </div>, document.body)}
  </div>;
}
