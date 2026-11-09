import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { DEFAULT_OPTIONS, MODELS, normalizeOptions } from "../../config/models";
import { downloadImage, readImageFile } from "../../lib/images";
import { useStudio } from "../../state/StudioContext";
import DialogAttachments, { type DialogAttachmentItem } from "./DialogAttachments";
import { DialogArrow, DialogButton, DialogCoins, DialogSelect } from "./DialogControls";
import type {
  Attachment,
  GenerationOptions,
  ImageAsset,
  Notify,
  PreviewImage,
} from "../../types";

const dialogModelNames: Record<string, string> = {
  "gpt-image-2": "GPT Image 2",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-2.5-sunburst": "GPT Image 2.5S",
  "gemini-3.1-flash-image": "Gemini Image 3.1F",
  "gemini-3-pro-image": "Gemini Image 3Pro",
};
const imageDragType = "application/x-img-gen-image-id";
function fileSourceKey(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified, file.type]);
}
function isReadyAttachment(item: DialogAttachmentItem): item is DialogAttachmentItem & Attachment {
  return item.status !== "uploading" && item.status !== "failed" &&
    typeof item.url === "string" && typeof item.width === "number" && typeof item.height === "number";
}

interface Props {
  active: boolean;
  onPreview: PreviewImage;
  notify: Notify;
  pendingAttachment: ImageAsset | null;
  onAttachmentHandled: () => void;
}
export default function CreationPage({
  active,
  onPreview,
  notify,
  pendingAttachment,
  onAttachmentHandled,
}: Props) {
  const { data, currentUser, actions } = useStudio();
  const [prompt, setPrompt] = useState("");
  const [attachmentItems, setAttachmentItems] = useState<DialogAttachmentItem[]>([]);
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  const [expanded, setExpanded] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const uploadLock = useRef(false);
  const removedUploads = useRef(new Set<string>());
  const attachmentSources = useRef(new Map<string, string>());
  const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastAttachment = useRef("");
  const model = MODELS.find((m) => m.id === options.modelId)!;
  const attachments = attachmentItems.filter(isReadyAttachment);
  const editing = attachmentItems.length > 0;
  const incompleteAttachments = attachmentItems.some(item => !isReadyAttachment(item));
  useEffect(() => {
    setOptions(previous => normalizeOptions(previous, editing));
  }, [editing]);
  useEffect(() => {
    if (!active || expanded) setOpenMenu(null);
  }, [active, expanded]);
  useLayoutEffect(() => {
    const input = promptInput.current;
    if (!input || !active) return;
    const resize = () => {
      if (!input.clientWidth) return;
      input.style.height = "48px";
      const height = Math.max(48, Math.min(192, Math.ceil(input.scrollHeight / 24) * 24));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > 192 ? "auto" : "hidden";
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(input.parentElement!);
    return () => observer.disconnect();
  }, [prompt, active]);
  const history = data.generations.filter((j) => j.userId === currentUser.id);
  const cost = data.prices[options.modelId] * options.count;
  const quoteReady = Number.isFinite(cost) && cost >= 0;
  const insufficientCredits = quoteReady && cost > currentUser.balance;
  const costLabel = quoteReady ? cost.toLocaleString("zh-CN") : "…";
  const suppressTooltips = !active || expanded || openMenu !== null;
  const generationHint = uploading ? "参考图上传中，请稍候。" : incompleteAttachments
    ? "请先移除上传失败的参考图。" : !quoteReady ? "正在获取报价…" : insufficientCredits
    ? "积分不足，请调整张数或联系管理员。" : "开始生成图片";
  const addAttachment = (image: Attachment) => {
    if (attachmentItems.some(item => item.id === image.id)) return;
    if (attachmentItems.length >= 6) {
      notify("最多添加 6 张图片");
      return;
    }
    setAttachmentItems((previous) =>
      previous.some((a) => a.id === image.id) || previous.length >= 6
        ? previous
        : [...previous, { ...image, status: "ready" }],
    );
  };
  useEffect(() => {
    if (pendingAttachment && lastAttachment.current !== pendingAttachment.id) {
      lastAttachment.current = pendingAttachment.id;
      addAttachment(pendingAttachment);
      onAttachmentHandled();
    }
    if (!pendingAttachment) lastAttachment.current = "";
  }, [pendingAttachment]);
  useEffect(() => {
    if (active) end.current?.scrollIntoView({ block: "end" });
  }, [history.length, history.at(-1)?.status, active]);
  const submit = async () => {
    if (sending || uploading || incompleteAttachments || !quoteReady || insufficientCredits || !prompt.trim()) return;
    setOpenMenu(null);
    setSending(true);
    try {
      await actions.generate(prompt, attachments, normalizeOptions(options, editing));
      setPrompt("");
      attachmentSources.current.clear();
      setAttachmentItems([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setSending(false);
    }
  };
  async function upload(files: FileList | null) {
    if (!files?.length || sending || uploadLock.current) return;
    const selected = Array.from(files);
    if (fileInput.current) fileInput.current.value = "";
    const sources = new Set(attachmentItems.filter(item => item.status !== "failed")
      .map(item => attachmentSources.current.get(item.id)).filter((source): source is string => !!source));
    const failedSources = new Map(attachmentItems.filter(item => item.status === "failed")
      .map(item => [attachmentSources.current.get(item.id), item.id]));
    let capacity = 6 - attachmentItems.length;
    let duplicates = false;
    let overLimit = false;
    const pending: { file: File; id: string; source: string; retry: boolean }[] = [];
    for (const file of selected) {
      const source = fileSourceKey(file);
      if (sources.has(source)) {
        duplicates = true;
        continue;
      }
      const failedId = failedSources.get(source);
      if (!failedId && capacity <= 0) {
        overLimit = true;
        continue;
      }
      sources.add(source);
      if (!failedId) capacity--;
      pending.push({ file, id: failedId ?? crypto.randomUUID(), source, retry: !!failedId });
    }
    if (overLimit) notify("最多添加 6 张图片");
    else if (duplicates) notify("已忽略重复图片");
    if (!pending.length) return;
    uploadLock.current = true;
    setUploading(true);
    setOpenMenu(null);
    for (const { id, source } of pending) attachmentSources.current.set(id, source);
    const retryIds = new Set(pending.filter(item => item.retry).map(item => item.id));
    setAttachmentItems(previous => [
      ...previous.map(item => retryIds.has(item.id)
        ? { ...item, status: "uploading" as const, error: undefined } : item),
      ...pending.filter(item => !item.retry).map(({ file, id }) => ({
        id, name: file.name, status: "uploading" as const,
      })),
    ]);
    try {
      for (const { file, id, source } of pending) {
        if (removedUploads.current.delete(id)) continue;
        try {
          const image = await readImageFile(file);
          if (removedUploads.current.has(id)) continue;
          attachmentSources.current.delete(id);
          attachmentSources.current.set(image.id, source);
          setAttachmentItems(previous => previous.map(item => item.id === id
            ? { ...image, status: "ready" } : item));
        } catch (e) {
          const message = e instanceof Error ? e.message : "上传失败";
          setAttachmentItems(previous => previous.map(item => item.id === id
            ? { ...item, status: "failed", error: message } : item));
          if (!removedUploads.current.has(id)) notify(message);
        } finally {
          removedUploads.current.delete(id);
        }
      }
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const updateOption = (patch: Partial<GenerationOptions>) =>
    setOptions((previous) => normalizeOptions({ ...previous, ...patch }, editing));
  return (
    <section className="creation-page" hidden={!active} aria-label="图像创作">
      <div className="conversation">
        {history.length === 0 && (
          <div className="creation-empty">
            <Icon name="image" size={48} />
            <h2>从一个想法开始</h2>
            <p>描述你想创作的图片</p>
          </div>
        )}
        {history.map((job) => {
          const images = job.imageIds
            .map((i) => data.assets.find((a) => a.id === i))
            .filter((a): a is ImageAsset => !!a);
          return (
            <article
              className="conversation-turn"
              key={job.id}
              data-testid="generation-turn"
            >
              <div className="message-user">
                {job.attachments.length > 0 && (
                  <div className="sent-attachments">
                    {job.attachments.map((a) => (
                      <img src={a.url} alt={a.name} key={a.id} width={a.width} height={a.height} loading="lazy" decoding="async" />
                    ))}
                  </div>
                )}
                <p>{job.prompt}</p>
              </div>
              <div className="generation-result">
                <h3>
                  {MODELS.find((m) => m.id === job.options.modelId)?.name}
                </h3>
                {job.status === "processing" && (
                  <div className="generation-progress" role="status">
                    <span className="spinner" />
                    正在生成…
                  </div>
                )}
                {job.status === "failed" && (
                  <div className="inline-error" role="alert">
                    {job.error}
                    <button
                      className="btn"
                      disabled={sending}
                      onClick={() => {
                        setPrompt(job.prompt);
                        setOptions(normalizeOptions(job.options));
                        attachmentSources.current.clear();
                        setAttachmentItems(job.attachments.map(item => ({ ...item, status: "ready" })));
                      }}
                    >
                      重新编辑
                    </button>
                  </div>
                )}
                <div className="result-images">
                  {images.map((image) => (
                    <div
                      className="result-card"
                      key={image.id}
                      style={{ width: 258 * (image.width / image.height) + 2 }}
                    >
                      <button
                        className="result-open"
                        onClick={() => onPreview(image, images)}
                        aria-label={`查看${image.name}`}
                      >
                        <img
                          src={image.thumbnailUrl ?? image.previewUrl ?? image.url}
                          srcSet={image.thumbnailUrl && image.previewUrl
                            ? `${image.thumbnailUrl} 1x, ${image.previewUrl} 2x` : undefined}
                          alt={image.name}
                          width={image.width}
                          height={image.height}
                          loading="lazy"
                          decoding="async"
                          draggable
                          onDragStart={event => {
                            event.dataTransfer.setData(imageDragType, image.id);
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                        />
                      </button>
                      <div className="result-actions">
                        <button onClick={() => downloadImage(image)}>
                          <Icon name="download" size={16} />
                          下载
                        </button>
                        <button
                          disabled={sending}
                          onClick={() => addAttachment(image)}
                        >
                          <Icon name="plus" size={16} />
                          添加
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
        <div ref={end} />
      </div>
      <div className="composer-area dialog-composer-scope">
        <DialogAttachments
          ownerId={currentUser.id}
          items={attachmentItems}
          disabled={sending}
          active={active && !expanded}
          onRemove={id => {
            attachmentSources.current.delete(id);
            if (attachmentItems.some(item => item.id === id && item.status === "uploading")) {
              removedUploads.current.add(id);
            }
            setAttachmentItems(items => items.filter(item => item.id !== id));
          }}
        />
        <div
          className="composer dialog-composer"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            if (sending) return;
            const imageId = event.dataTransfer.getData(imageDragType);
            if (imageId) {
              const image = data.assets.find(item => item.id === imageId);
              if (image) addAttachment(image);
              return;
            }
            void upload(event.dataTransfer.files);
          }}
        >
          <div className="prompt-area dialog-prompt-area">
            <textarea
              ref={promptInput}
              className="dialog-prompt-input"
              aria-label="提示词"
              placeholder="输入提示词以生成图片…"
              value={prompt}
              disabled={sending}
              onFocus={() => setOpenMenu(null)}
              onChange={event => setPrompt(event.target.value)}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && data.preferences.enterToSend &&
                    !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="dialog-expand-editor"
            aria-label="展开提示词"
            disabled={sending}
            onClick={() => {
              setOpenMenu(null);
              setExpandedDraft(prompt);
              setExpanded(true);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="3" y="2.5" width="10" height="11" rx="2" />
            </svg>
          </button>
          <div className="composer-toolbar dialog-composer-toolbar">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              aria-label="上传图片文件"
              onChange={event => void upload(event.target.files)}
            />
            <DialogButton
              className="dialog-button-icon dialog-upload-button"
              aria-label="上传图片"
              tooltip="添加图片，也可拖入图片到对话框。"
              tooltipAlign="start"
              tooltipDisabled={suppressTooltips}
              disabled={uploading || sending || attachmentItems.length >= 6}
              onClick={() => { setOpenMenu(null); fileInput.current?.click(); }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 0v20M0 10h20" />
              </svg>
            </DialogButton>
            <DialogSelect
              label="模型"
              value={options.modelId}
              options={MODELS.map(item => ({ value: item.id, label: dialogModelNames[item.id] ?? item.name }))}
              onChange={modelId => updateOption({ modelId })}
              disabled={sending}
              accent
              tooltip="选择生成模型"
              tooltipDisabled={!active || expanded}
              openMenu={openMenu}
              onOpenChange={setOpenMenu}
            />
            {!editing && model.qualities.length > 0 && <DialogSelect
              label="档位"
              value={options.quality ?? model.qualities[0]}
              options={model.qualities.map(value => ({ value, label: value }))}
              onChange={quality => updateOption({ quality })}
              disabled={sending}
              tooltip="图像质量"
              tooltipDisabled={!active || expanded}
              openMenu={openMenu}
              onOpenChange={setOpenMenu}
            />}
            {!editing && <DialogSelect
              label="图像比例"
              value={options.ratio}
              options={model.ratios.map(value => ({ value, label: value }))}
              onChange={ratio => updateOption({ ratio })}
              disabled={sending}
              tooltip="画面比例"
              tooltipDisabled={!active || expanded}
              openMenu={openMenu}
              onOpenChange={setOpenMenu}
            />}
            {!editing && model.resolutions.length > 0 && <DialogSelect
              label="清晰度"
              value={options.resolution ?? "1K"}
              options={model.resolutions.map(value => ({ value, label: value }))}
              onChange={resolution => updateOption({ resolution })}
              disabled={sending}
              tooltip="图像分辨率"
              tooltipDisabled={!active || expanded}
              openMenu={openMenu}
              onOpenChange={setOpenMenu}
            />}
            <DialogSelect
              label="生成数量"
              value={String(options.count)}
              options={[1, 2, 3, 4].map(value => ({ value: String(value), label: `${value}张` }))}
              onChange={count => updateOption({ count: Number(count) })}
              disabled={sending}
              tooltip="生成张数"
              tooltipDisabled={!active || expanded}
              openMenu={openMenu}
              onOpenChange={setOpenMenu}
            />
            <DialogButton
              className="dialog-button-credits"
              wrapperClassName="dialog-credit-anchor"
              style={{ width: Math.max(64, 34 + costLabel.length * 10) }}
              aria-label={quoteReady ? `预计 ${cost} 积分` : "报价未就绪"}
              tooltip={quoteReady ? `预计消耗 ${costLabel} 积分` : "正在获取报价…"}
              tooltipDisabled={suppressTooltips}
              onClick={() => {
                setOpenMenu(null);
              }}
            >
              <DialogCoins />
              <span>{costLabel}</span>
            </DialogButton>
            <DialogButton
              className="dialog-button-generate"
              accent
              tooltip={generationHint}
              tooltipDisabled={suppressTooltips}
              disabled={!prompt.trim() || sending || uploading || incompleteAttachments || !quoteReady || insufficientCredits}
              onClick={() => void submit()}
            >
              <span className="dialog-generate-label">{sending ? "生成中" : "生成"}</span>
              <DialogArrow submit />
            </DialogButton>
          </div>
        </div>
      </div>
      {expanded && (
        <Modal
          title="编辑提示词"
          className="prompt-modal dialog-prompt-modal"
          onClose={() => setExpanded(false)}
          footer={
            <>
              <DialogButton className="dialog-editor-cancel" onClick={() => setExpanded(false)}>
                取消
              </DialogButton>
              <DialogButton
                className="dialog-editor-done"
                accent
                onClick={() => {
                  setPrompt(expandedDraft);
                  setExpanded(false);
                }}
              >
                完成
              </DialogButton>
            </>
          }
        >
          <textarea
            aria-label="完整提示词"
            autoFocus
            value={expandedDraft}
            onChange={(e) => setExpandedDraft(e.target.value)}
          />
        </Modal>
      )}
    </section>
  );
}
