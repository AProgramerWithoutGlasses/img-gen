import { ImageCardActions } from "../../components/ImageCardActions";
import { ImageSelectionControl } from "../../components/ImageSelectionControl";
import { RenditionImage } from "../../components/RenditionImage";
import { downloadImage } from "../../lib/images";
import type { ImageAsset, Notify, PreviewImage } from "../../types";
import { errorText } from "./shared";

export function GalleryImage({ image, collection, selecting, selected,
  onToggle, onPreview, onEdit, folderId, onOrganize, onRemove, notify, busy, width, height }: {
  image: ImageAsset;
  collection: ImageAsset[];
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onPreview: PreviewImage;
  onEdit: (images: ImageAsset[]) => void;
  folderId?: string;
  onOrganize: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  notify: Notify;
  busy: boolean;
  width: number;
  height: number;
}) {
  return (
    <article className={`gallery-tile image-card${selecting ? " is-selecting" : ""}${selected ? " is-selected" : ""}`}
      style={{ width, height }}>
      <button className="gallery-tile-image"
        aria-label={selecting ? `${selected ? "取消选择" : "选择"} ${image.name}` : `查看 ${image.name}`}
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggle : () => onPreview(image, collection)}>
        <RenditionImage source={image} displayWidth={width} displayHeight={height} fit="cover"
          alt={image.name} loading="lazy" decoding="async" draggable={false} />
      </button>
      <ImageSelectionControl selected={selected} onToggle={onToggle} label={`选中 ${image.name}`} />
      <ImageCardActions image={image} selecting={selecting} compact={width < 260 || height < 112}
        onEdit={() => onEdit([image])} onFolder={() => onOrganize([image.id])}
        onDownload={() => {
          try { downloadImage(image); }
          catch (failure) { notify(errorText(failure)); }
        }}
        editDisabled={busy}
        extraActions={folderId ? [{ label: "从此文件夹移出", icon: "arrowLeft", onClick: () => onRemove([image.id]), disabled: busy }] : []}
      />
    </article>
  );
}
