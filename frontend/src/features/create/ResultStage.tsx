import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { RenditionImage } from "../../components/RenditionImage";
import { MODELS } from "../../config/models";
import { downloadImage } from "../../lib/images";
import type { Generation, ImageAsset, PreviewImage } from "../../types";
import { requestedRatio, resultLayout } from "./result-layout";

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

const imageDragType = "application/x-img-gen-image-id";

export default function ResultStage({ job, images, active, busy, onPreview, onEdit, onFolder, onRestore }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const previousColumns = useRef<number | undefined>(undefined);
  const confirmedRatio = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [details, setDetails] = useState<"prompt" | "error" | null>(null);
  const [imageStates, setImageStates] = useState<Record<string, "ready" | "failed">>({});
  const ordered = [...images].sort((a, b) => a.outputIndex - b.outputIndex);
  const first = ordered.find(image => image.width > 0 && image.height > 0);
  if (confirmedRatio.current === null && first) confirmedRatio.current = first.width / first.height;
  const ratio = confirmedRatio.current ?? requestedRatio(job.options.ratio, job.attachments[0]);
  const count = Math.max(1, Math.min(4, Math.trunc(job.options.count) || 1));
  const layout = resultLayout(count, ratio, size.width, size.height, previousColumns.current);
  if (layout) previousColumns.current = layout.columns;
  const slots = Array.from({ length: count }, (_, outputIndex) => ordered.find(image => image.outputIndex === outputIndex));
  const missing = slots.filter(image => !image).length;
  const status = job.status === "processing"
    ? `已完成 ${count - missing} / ${count} 张`
    : missing ? `${count - missing} 张完成，${missing} 张失败` : `${count} 张已完成`;
  const model = MODELS.find(item => item.id === job.options.modelId)?.name ?? job.options.modelId;
  const detail = [model, job.options.resolution, job.options.ratio !== "自动" ? job.options.ratio : null]
    .filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    const element = stage.current;
    if (!active || !element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  return (
    <article className="conversation-turn workbench-turn" data-testid="generation-turn" data-generation-id={job.id}>
      <header className="workbench-header">
        <div className="workbench-prompt-copy">
          <p className="workbench-prompt" aria-label="本轮提示词">{job.prompt}</p>
          <p className="workbench-meta">{detail}</p>
        </div>
        <div className="workbench-header-actions">
          <span className={`workbench-status${job.status === "failed" ? " is-error" : ""}`} role="status">
            {job.status === "processing" && <span className="workbench-status-dot" aria-hidden="true" />}
            {status}
          </span>
          <button className="icon-button workbench-prompt-more" aria-label="查看完整提示词" title="查看完整提示词" onClick={() => setDetails("prompt")}>
            <Icon name="more" size={18} />
          </button>
          {job.status === "failed" && (
            <button className="workbench-error-details" onClick={() => setDetails("error")}>查看错误</button>
          )}
        </div>
      </header>
      <div className="result-images workbench-stage" ref={stage} aria-label="本轮生成结果" data-columns={layout?.columns}>
        {layout && slots.map((image, index) => {
          const position = layout.positions[index];
          const failed = !image && job.status !== "processing";
          return (
            <div
              className={`result-card${!image ? " result-card-pending" : ""}${layout.imageWidth < 260 ? " result-card-compact" : ""}`}
              key={`${job.id}:${index}`}
              data-output-index={index}
              style={{ width: layout.imageWidth, height: layout.cardHeight, left: position.left, top: position.top }}
            >
              {image ? (
                <button className={`result-open${imageStates[image.id] === "ready" ? " is-ready" : ""}`} onClick={() => onPreview(image, ordered)} aria-label={`查看${image.name}`} style={{ height: layout.imageHeight }}>
                  <RenditionImage
                    source={image}
                    alt={image.name}
                    width={image.width}
                    height={image.height}
                    displayWidth={layout.imageWidth}
                    displayHeight={layout.imageHeight}
                    fit="contain"
                    decoding="async"
                    draggable
                    onLoad={() => setImageStates(previous => previous[image.id] === "ready" ? previous : { ...previous, [image.id]: "ready" })}
                    onError={() => setImageStates(previous => ({ ...previous, [image.id]: "failed" }))}
                    onDragStart={event => {
                      event.dataTransfer.setData(imageDragType, image.id);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  />
                  {imageStates[image.id] !== "ready" && <span className="result-image-loading" role="status">
                    {imageStates[image.id] === "failed" ? "图片暂时无法加载" : "正在载入图片…"}
                  </span>}
                </button>
              ) : (
                <div className={`result-slot-placeholder${failed ? " is-error" : ""}`} style={{ height: layout.imageHeight }} role="status" aria-label={`第 ${index + 1} 张${failed ? "生成失败" : "正在生成"}`}>
                  {failed ? <Icon name="image" size={28} /> : <span className="spinner" aria-hidden="true" />}
                  <span>{failed ? "生成失败" : "正在生成"}</span>
                  <small>第 {index + 1} 张</small>
                </div>
              )}
              {image ? (
                <div className="result-actions">
                  <button disabled={busy} onClick={() => onEdit(image)} aria-label="继续修图" title="继续修图">
                    <Icon name="edit" size={17} /><span>继续修图</span>
                  </button>
                  <button onClick={() => onFolder([image.id])} aria-label="加入文件夹" title="加入文件夹">
                    <Icon name="folder" size={17} /><span>加入文件夹</span>
                  </button>
                  <button onClick={() => downloadImage(image)} aria-label="下载" title="下载原图">
                    <Icon name="download" size={17} /><span>下载</span>
                  </button>
                </div>
              ) : (
                <div className="result-slot-footer">{failed ? "可查看错误后重新编辑" : "完成后在此显示"}</div>
              )}
            </div>
          );
        })}
      </div>
      {details && (
        <Modal title={details === "prompt" ? "本轮提示词" : "生成未全部完成"} onClose={() => setDetails(null)} footer={details === "error" ? (
          <button className="btn" disabled={busy} onClick={() => { onRestore(); setDetails(null); }}>重新编辑</button>
        ) : undefined}>
          <p className="workbench-detail-text">{details === "prompt" ? job.prompt : job.error || "部分图片未能生成，已完成的图片仍保留在本轮结果和我的图片中。"}</p>
          {details === "prompt" && <p className="workbench-meta">{detail}</p>}
        </Modal>
      )}
    </article>
  );
}
