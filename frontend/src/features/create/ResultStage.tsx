import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, SyntheticEvent } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { RenditionImage } from "../../components/RenditionImage";
import { MODELS } from "../../config/models";
import { downloadImage } from "../../lib/images";
import type { Generation, ImageAsset, PreviewImage } from "../../types";
import { requestedRatio, resultLayout } from "./result-layout";
import { resultElapsed } from "./result-progress";

interface Props {
  job: Generation;
  images: ImageAsset[];
  active: boolean;
  busy: boolean;
  onPreview: PreviewImage;
  onEdit: (image: ImageAsset) => void;
  onFolder: (imageIds: string[]) => void;
  onRestore: () => void;
}
interface SlotProps {
  image?: ImageAsset;
  collection: ImageAsset[];
  job: Generation;
  index: number;
  output?: NonNullable<Generation["outputs"]>[number];
  active: boolean;
  busy: boolean;
  reveal: boolean;
  width: number;
  height: number;
  left: number;
  top: number;
  onPreview: PreviewImage;
  onEdit: Props["onEdit"];
  onFolder: Props["onFolder"];
  onError: () => void;
}
type ImagePhase = "loading" | "returned" | "revealing" | "finishing" | "ready" | "failed";
const imageDragType = "application/x-img-gen-image-id";

function ResultSlot({ image, collection, job, index, output, active, busy, reveal, width, height,
  left, top, onPreview, onEdit, onFolder, onError }: SlotProps) {
  const [phase, setPhase] = useState<ImagePhase>("loading");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const shouldReveal = useRef(reveal);
  const failed = !image && (output?.status === "failed" || job.status !== "processing");
  const queued = !image && output?.status === "queued";
  const finishedAt = output?.finishedAt ?? image?.createdAt ?? (job.status !== "processing" ? job.completedAt : undefined);
  const [elapsed, setElapsed] = useState(() => resultElapsed(output?.startedAt,
    finishedAt ? Date.parse(finishedAt) : undefined));
  const isReady = phase === "ready";
  const resourceFailed = phase === "failed";
  const hasDecoded = phase === "returned" || phase === "revealing" || phase === "finishing" || isReady;
  const showProgress = shouldReveal.current || !image;
  const progressLabel = hasDecoded ? "正在呈现" : image || output?.status === "succeeded" ? "正在载入" : queued ? "排队中" : "正在生成";
  const [menu, setMenu] = useState(false);
  const compact = width < 260 || height < 112;
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, maxHeight: 240 });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const more = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const menuWrap = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const decodeVersion = useRef(0);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      decodeVersion.current++;
      revealTimers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    const update = () => setElapsed(resultElapsed(output?.startedAt,
      finishedAt ? Date.parse(finishedAt) : undefined));
    update();
    if (!active || failed || resourceFailed || hasDecoded || image || output?.status !== "running" || !output.startedAt) return;
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [active, failed, resourceFailed, hasDecoded, image, output?.status, output?.startedAt, finishedAt]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const skipMotion = () => {
      if (!media.matches || !["returned", "revealing", "finishing"].includes(phaseRef.current)) return;
      revealTimers.current.forEach(clearTimeout);
      setPhase("ready");
    };
    media.addEventListener("change", skipMotion);
    return () => media.removeEventListener("change", skipMotion);
  }, []);
  useEffect(() => { if (!active) setMenu(false); }, [active]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuWrap.current?.contains(target) && !menuPanel.current?.contains(target)) setMenu(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      more.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    const moved = (event: Event) => {
      if (event.type === "scroll" && menuPanel.current?.contains(event.target as Node)) return;
      setMenu(false);
    };
    window.addEventListener("resize", moved);
    document.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", moved);
      document.removeEventListener("scroll", moved, true);
    };
  }, [menu]);

  async function loaded(event: SyntheticEvent<HTMLImageElement>) {
    if (["ready", "finishing", "revealing", "returned"].includes(phaseRef.current)) return;
    const element = event.currentTarget;
    const source = element.currentSrc;
    const version = ++decodeVersion.current;
    try { await element.decode(); }
    catch {
      if (mounted.current && version === decodeVersion.current && element.currentSrc === source) setPhase("failed");
      return;
    }
    if (!mounted.current || version !== decodeVersion.current || element.currentSrc !== source) return;
    if (!shouldReveal.current || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("ready");
      return;
    }
    setPhase("returned");
    // All phases share the decode instant: show the blurred result, clear it,
    // then retire the completed progress layer only after the image is clear.
    revealTimers.current.forEach(clearTimeout);
    const schedule = (next: ImagePhase, delay: number) => setTimeout(() => {
      if (mounted.current && version === decodeVersion.current) setPhase(next);
    }, delay);
    revealTimers.current = [schedule("revealing", 260), schedule("finishing", 1360), schedule("ready", 1620)];
  }
  function placeMenu() {
    const box = more.current?.getBoundingClientRect();
    if (!box) return;
    const menuHeight = Math.min((compact ? 5 : 2) * 34 + 12, window.innerHeight - 16);
    const below = window.innerHeight - box.bottom - 14;
    const top = below < menuHeight && box.top > below ? Math.max(8, box.top - menuHeight - 6) : box.bottom + 6;
    setMenuPosition({ left: Math.max(8, Math.min(box.right - 176, window.innerWidth - 184)), top,
      maxHeight: Math.max(34, window.innerHeight - top - 8) });
  }
  function openMenu() { setCopied("idle"); placeMenu(); setMenu(previous => !previous); }
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
    if (!image) return;
    try { await navigator.clipboard.writeText(image.prompt); setCopied("copied"); }
    catch { setCopied("failed"); }
  }

  return <div
    className={`result-card is-${phase}${shouldReveal.current ? " is-live" : " is-history"}${!image ? " result-card-pending" : ""}${failed || resourceFailed ? " is-error" : ""}${compact ? " result-card-compact" : ""}${width < 160 ? " result-card-narrow" : ""}${menu ? " is-menu-open" : ""}`}
    ref={card}
    data-output-index={index}
    style={{ width, height, left, top }}
    onMouseLeave={event => {
      if (event.relatedTarget instanceof Node && menuPanel.current?.contains(event.relatedTarget)) return;
      if (!menuPanel.current?.querySelector(":focus-visible")) setMenu(false);
    }}
  >
    <div className="result-backdrop" aria-hidden="true" />
    {image && <button className={`result-open${isReady ? " is-ready" : ""}`}
      onClick={() => onPreview(image, collection)} aria-label={`查看${image.name}`} disabled={!isReady}>
      <RenditionImage source={image} alt={image.name} width={image.width} height={image.height}
        displayWidth={width} displayHeight={height} fit="contain" decoding="async" draggable
        onLoad={event => { void loaded(event); }}
        onError={() => { decodeVersion.current++; setPhase("failed"); }}
        onDragStart={event => {
          event.dataTransfer.setData(imageDragType, image.id);
          event.dataTransfer.effectAllowed = "copy";
        }} />
    </button>}
    {!isReady && <div className={`result-generation-layer result-slot-placeholder${phase === "finishing" ? " is-leaving" : ""}`}>
      {failed || resourceFailed ? <div className="result-generation-meta result-generation-error" role="alert">
        <span>{failed ? "生成失败" : "图片暂时无法加载"}</span>
        {failed && <button onClick={onError}>查看错误</button>}
      </div> : <>
        <div className="result-generation-meta">
          <span>{progressLabel}</span>
          {showProgress && !queued && (hasDecoded || elapsed !== undefined) && <span className="result-generation-number">
            {hasDecoded ? "100%" : ""}{elapsed !== undefined ? `${hasDecoded ? " · " : ""}${Math.floor(elapsed / 1000)}秒` : ""}
          </span>}
        </div>
        {showProgress && <div className={`result-progress-track ${hasDecoded ? "is-complete" : queued ? "is-queued" : "is-active"}`}
          role="progressbar" aria-label={`第 ${index + 1} 张生成进度`} aria-valuetext={progressLabel}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={hasDecoded ? 100 : undefined}>
          <span style={{ animationDelay: hasDecoded ? undefined : `${index * -.23}s` }} />
        </div>}
      </>}
    </div>}
    {image && isReady && <div className="result-actions">
      <div className="result-left-actions">
        <button disabled={busy} onClick={() => onEdit(image)} aria-label="继续修图"><Icon name="edit" size={17} /><span>继续修图</span></button>
        <button onClick={() => onFolder([image.id])} aria-label="加入文件夹"><Icon name="folderPlus" size={17} /><span>加入文件夹</span></button>
      </div>
      <button className="result-download" onClick={() => downloadImage(image)} aria-label="下载"><Icon name="download" size={17} /><span>下载</span></button>
      <div className="result-more-wrap" ref={menuWrap}>
        <button className="result-more" ref={more} onClick={openMenu} aria-label="更多图片操作" aria-expanded={menu} aria-haspopup="menu"
          onKeyDown={event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault(); placeMenu(); setMenu(true);
            requestAnimationFrame(() => menuPanel.current?.querySelector<HTMLButtonElement>("button")?.focus());
          }}><Icon name="moreVertical" size={20} /></button>
        {menu && createPortal(<div className="result-image-menu" ref={menuPanel} role="menu" aria-label="图片操作"
          style={menuPosition} onKeyDown={menuKeys} onMouseLeave={event => {
            if (event.relatedTarget instanceof Node && card.current?.contains(event.relatedTarget)) return;
            if (!menuPanel.current?.querySelector(":focus-visible")) setMenu(false);
          }}>
          {compact && <>
            <button role="menuitem" disabled={busy} onClick={() => { setMenu(false); onEdit(image); }}><Icon name="edit" size={16} />继续修图</button>
            <button role="menuitem" onClick={() => { setMenu(false); onFolder([image.id]); }}><Icon name="folderPlus" size={16} />加入文件夹</button>
            <button role="menuitem" onClick={() => { setMenu(false); downloadImage(image); }}><Icon name="download" size={16} />下载</button>
          </>}
          <button role="menuitem" onClick={() => { setMenu(false); onPreview(image, collection); }}><Icon name="expand" size={16} />查看大图</button>
          <button role="menuitem" onClick={() => { void copyPrompt(); }}><Icon name={copied === "copied" ? "check" : "copy"} size={16} />
            {copied === "copied" ? "已复制" : copied === "failed" ? "复制失败" : "复制提示词"}
          </button>
        </div>, document.body)}
      </div>
    </div>}
  </div>;
}

export default function ResultStage({ job, images, active, busy, onPreview, onEdit, onFolder, onRestore }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const previousColumns = useRef<number | undefined>(undefined);
  const liveBatch = useRef(job.status === "processing");
  if (job.status === "processing") liveBatch.current = true;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [details, setDetails] = useState<"prompt" | "error" | null>(null);
  const ordered = [...images].sort((a, b) => a.outputIndex - b.outputIndex);
  const [ratio] = useState(() => {
    const first = job.status !== "processing" ? images.find(image => image.width > 0 && image.height > 0) : undefined;
    // Keep a live batch's frame geometry stable when its real images arrive.
    // Historical images already have dimensions and can use their actual ratio.
    return first ? first.width / first.height : requestedRatio(job.options.ratio, job.attachments[0]);
  });
  const count = Math.max(1, Math.min(4, Math.trunc(job.options.count) || 1));
  const layout = resultLayout(count, ratio, size.width, size.height, previousColumns.current);
  if (layout) previousColumns.current = layout.columns;
  const slots = Array.from({ length: count }, (_, outputIndex) => ordered.find(image => image.outputIndex === outputIndex));
  const missing = slots.filter(image => !image).length;
  const status = job.status === "processing" ? `已完成 ${count - missing} / ${count} 张`
    : missing ? `${count - missing} 张完成，${missing} 张失败` : `${count} 张已完成`;
  const model = MODELS.find(item => item.id === job.options.modelId)?.name ?? job.options.modelId;
  const detail = [model, job.options.resolution, job.options.ratio !== "自动" ? job.options.ratio : null].filter(Boolean).join(" · ");
  useLayoutEffect(() => {
    const element = stage.current;
    if (!active || !element) return;
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return <article className="conversation-turn workbench-turn" data-testid="generation-turn" data-generation-id={job.id}>
    <header className="workbench-header">
      <div className="workbench-prompt-copy"><p className="workbench-prompt" aria-label="本轮提示词">{job.prompt}</p><p className="workbench-meta">{detail}</p></div>
      <div className="workbench-header-actions">
        <span className={`workbench-status${job.status === "failed" ? " is-error" : ""}`} role="status">{status}</span>
        <button className="icon-button workbench-prompt-more" aria-label="查看完整提示词" title="查看完整提示词" onClick={() => setDetails("prompt")}><Icon name="more" size={18} /></button>
        {job.status === "failed" && <button className="workbench-error-details" onClick={() => setDetails("error")}>查看错误</button>}
      </div>
    </header>
    <div className="result-images workbench-stage" ref={stage} aria-label="本轮生成结果" data-columns={layout?.columns}>
      {layout && slots.map((image, index) => <ResultSlot key={`${job.id}:${index}`}
        image={image} collection={ordered} job={job} index={index} output={job.outputs?.find(output => output.outputIndex === index)}
        active={active} busy={busy} reveal={liveBatch.current}
        width={layout.imageWidth} height={layout.imageHeight} left={layout.positions[index].left} top={layout.positions[index].top}
        onPreview={onPreview} onEdit={onEdit} onFolder={onFolder} onError={() => setDetails("error")} />)}
    </div>
    {details && <Modal title={details === "prompt" ? "本轮提示词" : "生成未全部完成"} onClose={() => setDetails(null)} footer={details === "error" ? (
      <button className="btn" disabled={busy} onClick={() => { onRestore(); setDetails(null); }}>重新编辑</button>
    ) : undefined}>
      <p className="workbench-detail-text">{details === "prompt" ? job.prompt : job.error || "部分图片未能生成，已完成的图片仍保留在本轮结果和我的图片中。"}</p>
      {details === "prompt" && <p className="workbench-meta">{detail}</p>}
    </Modal>}
  </article>;
}
