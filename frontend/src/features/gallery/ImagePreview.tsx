import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { useStudio } from "../../state/StudioContext";
import { MODELS } from "../../config/models";
import { downloadImage } from "../../lib/images";
import type { ImageAsset } from "../../types";

export function ImagePreview({
  selectedImage,
  previewIndex,
  total,
  switchPreview,
  onClose,
  onFolder,
  onAdd,
  onCreate,
  isGallery,
}: {
  selectedImage: ImageAsset;
  previewIndex: number;
  total: number;
  switchPreview: (step: number) => void;
  onClose: () => void;
  onFolder: (id: string) => void;
  onAdd: (image: ImageAsset) => void;
  onCreate: () => void;
  isGallery: boolean;
}) {
  const { data, currentUser } = useStudio();
  return (
    <Modal title="图片预览" className="image-preview" onClose={() => onClose()}>
      <div className="preview-grid">
        <div className="preview-stage">
          <img
            src={selectedImage.previewUrl ?? selectedImage.url}
            alt={selectedImage.name}
          />
          <button
            className="icon-button preview-prev"
            aria-label="上一张"
            disabled={previewIndex <= 0}
            onClick={() => switchPreview(-1)}
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            className="icon-button preview-next"
            aria-label="下一张"
            disabled={previewIndex >= total - 1}
            onClick={() => switchPreview(1)}
          >
            <Icon name="chevronRight" />
          </button>
          <span className="preview-position">
            {previewIndex + 1} / {total}
          </span>
        </div>
        <aside className="preview-details">
          <h3>生成信息</h3>
          <dl>
            <dt>提示词</dt>
            <dd>{selectedImage.prompt}</dd>
            <dt>模型</dt>
            <dd>
              {MODELS.find((m) => m.id === selectedImage.options.modelId)?.name}
            </dd>
            <dt>生成参数</dt>
            <dd>
              {[
                selectedImage.options.quality,
                selectedImage.options.ratio,
                selectedImage.options.resolution,
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
            <dt>生成时间</dt>
            <dd>{new Date(selectedImage.createdAt).toLocaleString("zh-CN")}</dd>
            <dt>所在文件夹</dt>
            <dd>
              {data.folders
                .filter((f) => selectedImage.folderIds.includes(f.id))
                .map((f) => f.name)
                .join(" · ") || "未分类"}
            </dd>
          </dl>
          <div className="preview-actions">
            <button
              className="btn"
              onClick={() => downloadImage(selectedImage)}
            >
              <Icon name="download" size={16} />
              下载
            </button>
            <button
              className="btn"
              disabled={
                !isGallery &&
                data.generations.some(
                  (job) =>
                    job.userId === currentUser.id &&
                    job.status === "processing",
                )
              }
              onClick={() => {
                if (isGallery) onFolder(selectedImage.id);
                else {
                  onAdd(selectedImage);
                  onClose();
                  onCreate();
                }
              }}
            >
              {isGallery ? "加入文件夹" : "添加"}
            </button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
