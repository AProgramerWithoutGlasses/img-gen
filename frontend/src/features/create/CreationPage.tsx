import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { DEFAULT_OPTIONS, MODELS, normalizeOptions } from "../../config/models";
import { downloadImage, readImageFile } from "../../lib/images";
import { useStudio } from "../../state/StudioContext";
import type {
  Attachment,
  GenerationOptions,
  ImageAsset,
  Notify,
  PreviewImage,
} from "../../types";

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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  const [expanded, setExpanded] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastAttachment = useRef("");
  const model = MODELS.find((m) => m.id === options.modelId)!;
  const editing = attachments.length > 0;
  useEffect(() => {
    setOptions(previous => normalizeOptions(previous, editing));
  }, [editing]);
  const history = data.generations.filter((j) => j.userId === currentUser.id);
  const cost = data.prices[options.modelId] * options.count;
  const addAttachment = (image: Attachment) =>
    setAttachments((previous) =>
      previous.some((a) => a.id === image.id) || previous.length >= 6
        ? previous
        : [...previous, image],
    );
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
    if (sending || uploading || !prompt.trim()) return;
    setSending(true);
    try {
      await actions.generate(prompt, attachments, normalizeOptions(options, editing));
      setPrompt("");
      setAttachments([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setSending(false);
    }
  };
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const capacity = 6 - attachments.length;
    if (files.length > capacity) notify("最多添加 6 张图片");
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, capacity)) {
        try {
          addAttachment(await readImageFile(file));
        } catch (e) {
          notify(e instanceof Error ? e.message : "上传失败");
        }
      }
    } finally {
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
                        setAttachments(job.attachments);
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
                        />
                      </button>
                      <div className="result-actions">
                        <button onClick={() => downloadImage(image)}>
                          <Icon name="download" size={16} />
                          下载
                        </button>
                        <button
                          disabled={sending}
                          onClick={() => {
                            if (attachments.length >= 6)
                              notify("最多添加 6 张图片");
                            else addAttachment(image);
                          }}
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
      <div className="composer-area">
        {attachments.length > 0 && (
          <div className="attachment-row" aria-label="附件栏">
            {attachments.map((a) => (
              <div className="attachment-item" key={a.id}>
                <img src={a.url} alt="" />
                <span title={a.name}>{a.name}</span>
                <button
                  aria-label={`移除${a.name}`}
                  className="attachment-remove"
                  disabled={sending}
                  onClick={() =>
                    setAttachments((list) => list.filter((i) => i.id !== a.id))
                  }
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!sending) void upload(e.dataTransfer.files);
          }}
        >
          <div className="prompt-area">
            <textarea
              aria-label="提示词"
              placeholder="描述你想生成的图片…"
              value={prompt}
              disabled={sending}
              onChange={(e) => setPrompt(e.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  data.preferences.enterToSend &&
                  !composing.current &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              className="icon-button expand-prompt"
              aria-label="展开提示词"
              disabled={sending}
              onClick={() => {
                setExpandedDraft(prompt);
                setExpanded(true);
              }}
            >
              <Icon name="expand" size={17} />
            </button>
          </div>
          <div className="composer-toolbar">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              aria-label="上传图片文件"
              onChange={(e) => void upload(e.target.files)}
            />
            <button
              className="icon-button upload-button"
              aria-label="上传图片"
              disabled={uploading || sending || attachments.length >= 6}
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="plus" size={24} />
            </button>
            <select
              aria-label="模型"
              className="model-select"
              disabled={sending}
              value={options.modelId}
              onChange={(e) =>
                updateOption({
                  modelId: e.target.value as GenerationOptions["modelId"],
                })
              }
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {!editing && model.qualities.length > 0 && (
              <select
                aria-label="档位"
                disabled={sending}
                value={options.quality}
                onChange={(e) => updateOption({ quality: e.target.value })}
              >
                {model.qualities.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            {!editing && <select
              aria-label="图像比例"
              disabled={sending}
              value={options.ratio}
              onChange={(e) => updateOption({ ratio: e.target.value })}
            >
              {model.ratios.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>}
            {!editing && model.resolutions.length > 0 && (
              <select
                aria-label="清晰度"
                disabled={sending}
                value={options.resolution}
                onChange={(e) => updateOption({ resolution: e.target.value })}
              >
                {model.resolutions.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            <select
              aria-label="生成数量"
              disabled={sending}
              value={options.count}
              onChange={(e) => updateOption({ count: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>
            <span className="estimated-cost">
              {uploading ? "读取中…" : `预计 ${cost} 积分`}
            </span>
            <button
              className="btn btn-primary send-button"
              disabled={!prompt.trim() || sending || uploading}
              onClick={() => void submit()}
            >
              <Icon name="send" size={16} />
              {sending ? "生成中" : "发送"}
            </button>
          </div>
        </div>
      </div>
      {expanded && (
        <Modal
          title="编辑提示词"
          className="prompt-modal"
          onClose={() => setExpanded(false)}
          footer={
            <>
              <button className="btn" onClick={() => setExpanded(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPrompt(expandedDraft);
                  setExpanded(false);
                }}
              >
                完成
              </button>
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
