import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Lightbox from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import type { ContainerRect, ControllerRef, ZoomRef } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { Icon } from "../../components/Icon";
import { RenditionImage } from "../../components/RenditionImage";
import { useStudio } from "../../state/StudioContext";
import { MODELS } from "../../config/models";
import { downloadImage } from "../../lib/images";
import type { ImageAsset } from "../../types";
import "./image-preview.css";

interface Props {
  selectedImage: ImageAsset;
  collection?: ImageAsset[];
  previewIndex: number;
  total: number;
  switchPreview: (step: number) => void;
  onClose: () => void;
  onFolder: (id: string) => void;
  onAdd: (image: ImageAsset) => void;
  onCreate: () => void;
  isGallery?: boolean;
}

// Preserve authenticated rendition selection. Decode an original only after a
// detail-zoom request, keeping the preview visible until that decode succeeds.
function PreviewPhoto({ image, rect, originalRequested }: {
  image: ImageAsset;
  rect: ContainerRect;
  originalRequested: boolean;
}) {
  const [originalReady, setOriginalReady] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!originalRequested || originalReady || originalFailed) return;
    let current = true;
    const original = new Image();
    original.decoding = "async";
    original.onload = () => {
      const complete = () => { if (current) setOriginalReady(true); };
      if (original.decode) void original.decode().then(complete, complete);
      else complete();
    };
    original.onerror = () => { if (current) setOriginalFailed(true); };
    original.src = image.url;
    return () => { current = false; original.onload = null; original.onerror = null; };
  }, [image.url, originalRequested, originalReady, originalFailed]);
  const fit = Math.min(rect.width / image.width, rect.height / image.height, 1);
  const width = Math.max(0, image.width * fit);
  const height = Math.max(0, image.height * fit);
  const source = originalReady ? { url: image.url, width: image.width, height: image.height } : image;
  return (
    <div className="preview-photo" style={{ width, height }}>
      {failed ? (
        <div className="preview-load-error" role="status"><Icon name="image" size={28} /><span>图片暂时无法显示</span></div>
      ) : (
        <RenditionImage source={source} alt={image.name} width={image.width} height={image.height}
          displayWidth={width || undefined} displayHeight={height || undefined} decoding="async"
          draggable={false} onError={() => setFailed(true)} />
      )}
      {originalRequested && !originalReady && !failed && (
        <span className="preview-resolution-status" role="status">
          {originalFailed ? "原图暂未加载，仍显示预览" : "正在载入原图…"}
        </span>
      )}
    </div>
  );
}

export function ImagePreview({ selectedImage, collection, previewIndex, total, switchPreview, onClose, onFolder, onAdd, onCreate }: Props) {
  const { data } = useStudio();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<ControllerRef>(null);
  const zoom = useRef<ZoomRef>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [originalRequestedFor, setOriginalRequestedFor] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const images = collection?.length ? collection : [selectedImage];
  const selectedThumbnail = useRef<HTMLButtonElement>(null);
  const slides = useMemo(() => [{ src: selectedImage.previewUrl || selectedImage.url, alt: selectedImage.name,
    width: selectedImage.width, height: selectedImage.height }],
  [selectedImage.id, selectedImage.url, selectedImage.previewUrl, selectedImage.name, selectedImage.width, selectedImage.height]);
  const fitScale = stageSize.width > 0 && stageSize.height > 0
    ? Math.min(stageSize.width / selectedImage.width, stageSize.height / selectedImage.height, 1) : 1;
  const zoomPercent = Math.max(1, Math.round(zoomLevel * fitScale * 100));
  const folderNames = data.folders.filter(folder => selectedImage.folderIds.includes(folder.id)).map(folder => folder.name);

  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setStageSize(previous =>
        previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setZoomLevel(1);
    selectedThumbnail.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedImage.id]);

  const requestOriginal = () => setOriginalRequestedFor(selectedImage.id);
  const focusImage = () => controller.current?.focus();
  const showOriginalSize = () => {
    requestOriginal();
    if (zoom.current) zoom.current.changeZoom(Math.max(1, zoom.current.maxZoom / 2));
    focusImage();
  };
  const edit = () => { onAdd(selectedImage); onClose(); onCreate(); };

  return createPortal(
    <dialog ref={dialog} className={`image-preview${detailsOpen ? " preview-details-open" : ""}`} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); close.current(); }}
      onKeyDownCapture={event => {
        if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
        if ((zoom.current?.zoom ?? 1) <= 1.001) {
          if (event.key === "ArrowLeft" && previewIndex > 0) { event.preventDefault(); event.stopPropagation(); switchPreview(-1); }
          if (event.key === "ArrowRight" && previewIndex < total - 1) { event.preventDefault(); event.stopPropagation(); switchPreview(1); }
        }
      }}>
      <header className="preview-header">
        <div className="preview-heading">
          <span className="preview-heading-mark"><Icon name="image" size={20} /></span>
          <h2 id={titleId}>图片预览</h2>
          <span className="preview-index">{previewIndex + 1}<span> / {total}</span></span>
        </div>
        <div className="preview-header-actions">
          <button className={`preview-tool-button${detailsOpen ? " is-active" : ""}`} aria-expanded={detailsOpen}
            aria-controls={detailsId} onClick={() => setDetailsOpen(previous => !previous)}>
            <Icon name="info" size={18} /><span>详细信息</span>
          </button>
          <button className="preview-close" aria-label="关闭" onClick={onClose}><Icon name="close" size={21} /></button>
        </div>
      </header>
      <div className="preview-content">
        {total > 1 && images.length > 1 && (
          <nav className="preview-thumbnails" aria-label="图片切换">
            {images.map((image, index) => (
              <button key={image.id} ref={image.id === selectedImage.id ? selectedThumbnail : undefined}
                className={`preview-thumbnail${image.id === selectedImage.id ? " is-current" : ""}`}
                aria-label={`查看第 ${index + 1} 张图片`} aria-current={image.id === selectedImage.id ? "true" : undefined}
                onClick={() => switchPreview(index - previewIndex)}>
                <RenditionImage source={image} fit="contain" purpose="thumbnail" displayWidth={56} displayHeight={56} alt="" loading="lazy" decoding="async" />
                <span>{index + 1}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="preview-image-area">
          <div className="preview-stage" ref={stage}>
            <Lightbox key={selectedImage.id} plugins={[Inline, Zoom]} slides={slides} className="preview-lightbox"
              carousel={{ finite: true, preload: 0, padding: 0, spacing: 0, imageFit: "contain" }} toolbar={{ buttons: [] }}
              controller={{ ref: controller, focus: false, closeOnEscape: false, disableSwipeNavigation: true }}
              zoom={{ ref: zoom, maxZoomPixelRatio: 2, scrollToZoom: true, zoomInMultiplier: 1.5 }}
              animation={{ fade: reduceMotion ? 0 : 140, swipe: 0, navigation: 0, zoom: reduceMotion ? 0 : 160 }}
              render={{ buttonPrev: () => null, buttonNext: () => null, buttonClose: () => null, buttonZoom: () => null,
                slide: ({ rect }) => <PreviewPhoto key={selectedImage.id} image={selectedImage} rect={rect} originalRequested={originalRequestedFor === selectedImage.id} /> }}
              on={{ zoom: ({ zoom: value }) => { setZoomLevel(value); if (value > 1.001) requestOriginal(); } }}
              labels={{ Lightbox: "图片查看器", Slide: "图片", Carousel: "图片", "Photo gallery": "图片查看器" }} />
            {total > 1 && <>
              <button className="preview-nav-button preview-prev" aria-label="上一张" disabled={previewIndex <= 0} onClick={() => switchPreview(-1)}><Icon name="chevronLeft" size={22} /></button>
              <button className="preview-nav-button preview-next" aria-label="下一张" disabled={previewIndex >= total - 1} onClick={() => switchPreview(1)}><Icon name="chevronRight" size={22} /></button>
            </>}
          </div>
          <div className="preview-bottom-bar">
            <div className="preview-zoom-tools" role="group" aria-label="图片缩放">
              <button className="preview-tool-button preview-zoom-icon" aria-label="缩小" disabled={zoomLevel <= 1.001} onClick={() => { zoom.current?.zoomOut(); focusImage(); }}><Icon name="zoomOut" size={18} /></button>
              <button className="preview-tool-button" onClick={() => { zoom.current?.changeZoom(1); focusImage(); }}><Icon name="maximize" size={17} /><span>适应窗口</span></button>
              <button className="preview-tool-button preview-original-size" aria-label="原始尺寸 100%" onClick={showOriginalSize}>100%</button>
              <button className="preview-tool-button preview-zoom-icon" aria-label="放大" onClick={() => { requestOriginal(); zoom.current?.zoomIn(); focusImage(); }}><Icon name="zoomIn" size={18} /></button>
              <span className="preview-zoom-value" aria-live="polite">{zoomPercent}%</span>
            </div>
            <div className="preview-actions" role="group" aria-label="图片操作">
              <button className="preview-action-button preview-action-primary" onClick={edit}><Icon name="edit" size={17} /><span>继续修图</span></button>
              <button className="preview-action-button" onClick={() => onFolder(selectedImage.id)}><Icon name="folder" size={17} /><span>加入文件夹</span></button>
              <button className="preview-action-button" onClick={() => downloadImage(selectedImage)}><Icon name="download" size={17} /><span>下载原图</span></button>
            </div>
          </div>
        </div>
        {detailsOpen && (
          <aside className="preview-details" id={detailsId} aria-label="图片详细信息">
            <h3>生成信息</h3>
            <dl>
              <dt>提示词</dt><dd className="preview-prompt">{selectedImage.prompt}</dd>
              <dt>模型</dt><dd>{MODELS.find(model => model.id === selectedImage.options.modelId)?.name ?? selectedImage.options.modelId}</dd>
              <dt>图片尺寸</dt><dd>{selectedImage.width} × {selectedImage.height} px</dd>
              <dt>生成参数</dt><dd>{[selectedImage.options.quality, selectedImage.options.ratio, selectedImage.options.resolution].filter(Boolean).join(" · ") || "自动"}</dd>
              <dt>生成时间</dt><dd>{new Date(selectedImage.createdAt).toLocaleString("zh-CN")}</dd>
              <dt>所在文件夹</dt><dd>{folderNames.join(" · ") || "尚未加入文件夹"}</dd>
            </dl>
          </aside>
        )}
      </div>
    </dialog>, document.body,
  );
}
