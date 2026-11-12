import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { RenditionImage } from "../../components/RenditionImage";
import { ImageCardActions } from "../../components/ImageCardActions";
import { ImageSelectionControl } from "../../components/ImageSelectionControl";
import { ImageSelectionToolbar } from "../../components/ImageSelectionToolbar";
import { MODELS } from "../../config/models";
import { MAX_BASE_IMAGES } from "../../config/attachments";
import { downloadImage, downloadImages } from "../../lib/images";
import type { Generation, ImageAsset, PreviewImage } from "../../types";
import { requestedRatio, resultLayout } from "./result-layout";
import { resultElapsed } from "./result-progress";

interface Props {
  job: Generation;
  images: ImageAsset[];
  active: boolean;
  busy: boolean;
  onPreview: PreviewImage;
  onEdit: (images: ImageAsset[]) => void;
  onFolder: (imageIds: string[]) => void;
  onRestore: () => void;
  onTrash: (imageIds: string[]) => void;
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
  selecting: boolean;
  selected: boolean;
  onToggle: (imageId: string) => void;
  onReadyChange: (imageId: string, ready: boolean) => void;
  onPreview: PreviewImage;
  onEdit: Props["onEdit"];
  onFolder: Props["onFolder"];
  onError: () => void;
  onTrash: Props["onTrash"];
}
type ImagePhase = "loading" | "returned" | "revealing" | "finishing" | "ready" | "failed";
const imageDragType = "application/x-img-gen-image-id";
const revealHoldMs = 320;
const revealDurationMs = 1700;
const revealExitMs = 260;

function ResultSlot({ image, collection, job, index, output, active, busy, reveal, width, height,
  left, top, selecting, selected, onToggle, onReadyChange,
  onPreview, onEdit, onFolder, onError, onTrash }: SlotProps) {
  const [phase, setPhase] = useState<ImagePhase>("loading");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const activeRef = useRef(active);
  activeRef.current = active;
  const [presentation, setPresentation] = useState(0);
  const shouldReveal = useRef(reveal);
  const unavailable = !image && (output?.imageState === "trashed" || output?.imageState === "deleted");
  const failed = !image && !unavailable && (output?.status === "failed" || job.status !== "processing");
  const queued = !image && output?.status === "queued";
  const finishedAt = output?.finishedAt ?? image?.createdAt ?? (job.status !== "processing" ? job.completedAt : undefined);
  const [elapsed, setElapsed] = useState(() => resultElapsed(output?.startedAt,
    finishedAt ? Date.parse(finishedAt) : undefined));
  const isReady = !!image && phase === "ready";
  const resourceFailed = phase === "failed";
  const hasDecoded = phase === "returned" || phase === "revealing" || phase === "finishing" || isReady;
  const showProgress = shouldReveal.current || !image;
  const progressLabel = hasDecoded ? "正在呈现" : image || output?.status === "succeeded" ? "正在载入" : queued ? "排队中" : "正在生成";
  const compact = width < 260 || height < 112;
  const mounted = useRef(true);
  const decodeVersion = useRef(0);
  const revealFrame = useRef<number | null>(null);

  function stopReveal() {
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    revealFrame.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      decodeVersion.current++;
      stopReveal();
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
    if (active && !failed && !resourceFailed) return;
    stopReveal();
    if (!active && ["returned", "revealing", "finishing"].includes(phaseRef.current)) {
      setPresentation(100);
      setPhase("ready");
    }
  }, [active, failed, resourceFailed]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const skipMotion = () => {
      if (!media.matches || !["returned", "revealing", "finishing"].includes(phaseRef.current)) return;
      stopReveal();
      setPresentation(100);
      setPhase("ready");
    };
    media.addEventListener("change", skipMotion);
    return () => media.removeEventListener("change", skipMotion);
  }, []);
  useEffect(() => {
    if (!image) return;
    onReadyChange(image.id, isReady);
    return () => onReadyChange(image.id, false);
  }, [image?.id, isReady, onReadyChange]);

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
    if (!activeRef.current || !shouldReveal.current || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPresentation(100);
      setPhase("ready");
      return;
    }
    stopReveal();
    setPresentation(0);
    setPhase("returned");
    // One presentation clock drives the number, bar and image clarity. Reaching
    // 100% means the decoded image is clear, before the progress layer retires.
    const started = performance.now();
    let completedAt: number | undefined;
    const present = (now: number) => {
      if (!mounted.current || version !== decodeVersion.current || !activeRef.current) {
        revealFrame.current = null;
        return;
      }
      const elapsed = now - started;
      if (elapsed >= revealHoldMs + revealDurationMs) {
        completedAt ??= now;
        setPresentation(100);
        if (now - completedAt >= revealExitMs) {
          setPhase("ready");
          revealFrame.current = null;
          return;
        }
        setPhase("finishing");
      } else if (elapsed >= revealHoldMs) {
        setPresentation((elapsed - revealHoldMs) / revealDurationMs * 100);
        setPhase("revealing");
      }
      revealFrame.current = requestAnimationFrame(present);
    };
    revealFrame.current = requestAnimationFrame(present);
  }

  return <div
    className={`image-card result-card is-${phase}${shouldReveal.current ? " is-live" : " is-history"}${!image ? " result-card-pending" : ""}${failed || resourceFailed ? " is-error" : ""}${compact ? " result-card-compact" : ""}${width < 160 ? " result-card-narrow" : ""}${selecting ? " is-selecting" : ""}${selected ? " is-selected" : ""}`}
    data-output-index={index}
    style={{ width, height, left, top, "--result-reveal-progress": presentation / 100,
      "--result-reveal-exit-duration": `${revealExitMs}ms` } as CSSProperties}
  >
    <div className="result-backdrop" aria-hidden="true" />
    {image && <button className={`result-open${isReady ? " is-ready" : ""}`}
      onClick={() => selecting ? onToggle(image.id) : onPreview(image, collection)}
      aria-label={selecting ? `${selected ? "取消选择" : "选择"}第 ${index + 1} 张图片` : `查看${image.name}`} disabled={!isReady}>
      <RenditionImage source={image} alt={image.name} width={image.width} height={image.height}
        displayWidth={width} displayHeight={height} fit="contain" decoding="async" draggable={!selecting && isReady}
        onLoad={event => { void loaded(event); }}
        onError={() => { decodeVersion.current++; stopReveal(); setPhase("failed"); }}
        onDragStart={event => {
          if (selecting || !isReady) { event.preventDefault(); return; }
          event.dataTransfer.setData(imageDragType, image.id);
          event.dataTransfer.effectAllowed = "copy";
        }} />
    </button>}
    {!isReady && <div className={`result-generation-layer result-slot-placeholder${phase === "finishing" ? " is-leaving" : ""}`}>
      {unavailable ? <div className="result-generation-meta"><span>{output?.imageState === "trashed" ? "已移入回收站" : "图片已彻底删除"}</span></div> : failed || resourceFailed ? <div className="result-generation-meta result-generation-error" role="alert">
        <span>{failed ? "生成失败" : "图片暂时无法加载"}</span>
        {failed && <button onClick={onError}>查看错误</button>}
      </div> : <>
        <div className="result-generation-meta">
          <span>{progressLabel}</span>
          {showProgress && !queued && (hasDecoded || elapsed !== undefined) && <span className="result-generation-number">
            {hasDecoded ? `${Math.floor(presentation)}%` : ""}{elapsed !== undefined ? `${hasDecoded ? " · " : ""}${Math.floor(elapsed / 1000)}秒` : ""}
          </span>}
        </div>
        {showProgress && <div className={`result-progress-track ${hasDecoded ? phase === "finishing" ? "is-complete" : "is-presenting" : queued ? "is-queued" : "is-active"}`}
          role="progressbar" aria-label={`第 ${index + 1} 张生成进度`} aria-valuetext={progressLabel}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={hasDecoded ? Math.floor(presentation) : undefined}>
          <span style={hasDecoded ? { width: `${presentation}%` } : { animationDelay: `${index * -.23}s` }} />
        </div>}
      </>}
    </div>}
    {image && isReady && <ImageSelectionControl selected={selected} onToggle={() => onToggle(image.id)} label={`选择第 ${index + 1} 张图片`} disabled={busy} />}
    {image && isReady && <ImageCardActions image={image} compact={compact} active={active} selecting={selecting}
      onEdit={() => onEdit([image])} onFolder={() => onFolder([image.id])} onDownload={() => downloadImage(image)}
      editDisabled={busy} onTrash={() => onTrash([image.id])} />}

  </div>;
}

export default function ResultStage({ job, images, active, busy, onPreview, onEdit, onFolder, onRestore, onTrash }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const previousColumns = useRef<number | undefined>(undefined);
  const liveBatch = useRef(job.status === "processing");
  if (job.status === "processing") liveBatch.current = true;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [details, setDetails] = useState<"prompt" | "error" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [readyIds, setReadyIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const selectionHintId = useId();
  const readyChanged = useCallback((imageId: string, ready: boolean) => {
    setReadyIds(previous => ready ? previous.includes(imageId) ? previous : [...previous, imageId]
      : previous.includes(imageId) ? previous.filter(id => id !== imageId) : previous);
    if (!ready) setSelectedIds(previous => previous.includes(imageId) ? previous.filter(id => id !== imageId) : previous);
  }, []);
  const toggleSelected = useCallback((imageId: string) => {
    if (busy || downloading) return;
    setSelectedIds(previous => previous.includes(imageId) ? previous.filter(id => id !== imageId) : [...previous, imageId]);
  }, [busy, downloading]);
  const ordered = [...images].sort((a, b) => a.outputIndex - b.outputIndex);
  const selectedImages = ordered.filter(image => selectedIds.includes(image.id));
  const readyImages = ordered.filter(image => readyIds.includes(image.id));
  const selecting = selectedImages.length > 0;
  const editLimitExceeded = selectedImages.length > MAX_BASE_IMAGES;
  const allSelected = readyImages.length > 0 && readyImages.every(image => selectedIds.includes(image.id));
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
  const model = MODELS.find(item => item.id === job.options.modelId)?.name ?? job.options.modelId;
  const detail = [model, job.options.resolution, job.options.ratio !== "自动" ? job.options.ratio : null].filter(Boolean).join(" · ");
  useEffect(() => { setSelectedIds([]); }, [active, job.id]);
  useEffect(() => {
    if (!active || !selecting) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busy || downloading
        || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .result-image-menu')) return;
      event.preventDefault();
      setSelectedIds([]);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, selecting, busy, downloading]);
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
      <div className="workbench-prompt-copy"><button type="button" className="workbench-prompt" aria-label="本轮提示词" title="查看完整提示词" onClick={() => setDetails("prompt")}>{job.prompt}</button><p className="workbench-meta">{detail}</p></div>
      {job.status === "failed" && <div className="workbench-header-actions"><button className="workbench-error-details" onClick={() => setDetails("error")}>查看错误</button></div>}
    </header>
    {active && selecting && <ImageSelectionToolbar count={selectedImages.length} allSelected={allSelected}
      closeDisabled={busy || downloading} onSelectAll={() => { if (!busy && !downloading) setSelectedIds(readyImages.map(image => image.id)); }} onClose={() => setSelectedIds([])}>
      <span className="workbench-edit-guard" tabIndex={editLimitExceeded ? 0 : undefined}
        title={editLimitExceeded ? `最多选择${MAX_BASE_IMAGES}张基础图` : undefined} aria-describedby={editLimitExceeded ? selectionHintId : undefined}>
        <button type="button" disabled={busy || downloading || !selectedImages.length || editLimitExceeded} onClick={() => { if (selectedImages.length && !editLimitExceeded) onEdit(selectedImages); }}><Icon name="edit" size={16} />继续修图</button>
        {editLimitExceeded && <span className="workbench-selection-hint" id={selectionHintId}>最多选择{MAX_BASE_IMAGES}张基础图</span>}
      </span>
      <button type="button" disabled={busy || downloading} onClick={() => onFolder(selectedImages.map(image => image.id))}><Icon name="folderPlus" size={16} />加入文件夹</button>
      <button type="button" disabled={busy || downloading} onClick={() => {
        setDownloading(true); setDownloadError("");
        void downloadImages(selectedImages).catch(cause => setDownloadError(cause instanceof Error ? cause.message : "下载失败，请重试。"))
          .finally(() => setDownloading(false));
      }}><Icon name="download" size={16} />{downloading ? "准备下载…" : "下载"}</button>
      <button type="button" disabled={busy || downloading} onClick={() => onTrash(selectedImages.map(image => image.id))}><Icon name="trash" size={16} />移入回收站</button>
    </ImageSelectionToolbar>}
    {downloadError && <div className="workbench-download-error" role="alert">{downloadError}<button type="button" aria-label="关闭下载提示" onClick={() => setDownloadError("")}><Icon name="close" size={16} /></button></div>}

    <div className="result-images workbench-stage" ref={stage} aria-label="本轮生成结果" data-columns={layout?.columns}>
      {layout && slots.map((image, index) => <ResultSlot key={`${job.id}:${index}`}
        image={image} collection={ordered} job={job} index={index} output={job.outputs?.find(output => output.outputIndex === index)}
        active={active} busy={busy} reveal={liveBatch.current}
        selecting={selecting} selected={selectedIds.includes(image?.id ?? "")}
        onToggle={toggleSelected} onReadyChange={readyChanged}
        width={layout.imageWidth} height={layout.imageHeight} left={layout.positions[index].left} top={layout.positions[index].top}
        onPreview={onPreview} onEdit={onEdit} onFolder={onFolder} onTrash={onTrash} onError={() => setDetails("error")} />)}
    </div>
    {details && <Modal title={details === "prompt" ? "本轮提示词" : "生成未全部完成"} onClose={() => setDetails(null)} footer={details === "error" ? (
      <button className="btn" disabled={busy} onClick={() => { onRestore(); setDetails(null); }}>重新编辑</button>
    ) : undefined}>
      <p className="workbench-detail-text">{details === "prompt" ? job.prompt : job.error || "部分图片未能生成，已完成的图片仍保留在本轮结果和我的图片中。"}</p>
      {details === "prompt" && <p className="workbench-meta">{detail}</p>}
    </Modal>}
  </article>;
}
