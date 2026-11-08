import { useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { downloadImage } from "../../lib/images";
import type { ImageAsset, Notify, PreviewImage } from "../../types";
import { errorText, useOutsideClose } from "./shared";
function ImageMenu({
  image,
  collection,
  folderId,
  onPreview,
  onOrganize,
  onRemove,
  onClose,
  notify,
}: {
  image: ImageAsset;
  collection: ImageAsset[];
  folderId?: string;
  onPreview: PreviewImage;
  onOrganize: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  return (
    <div
      className="gallery-menu gallery-image-menu"
      role="menu"
      aria-label={`${image.name} 操作`}
      ref={ref}
    >
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onPreview(image, collection);
        }}
      >
        <Icon name="expand" />
        查看大图
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          try {
            downloadImage(image);
          } catch (error) {
            notify(errorText(error));
          }
        }}
      >
        <Icon name="download" />
        下载
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onOrganize([image.id]);
        }}
      >
        <Icon name="folder" />
        加入文件夹
      </button>
      {folderId && (
        <button
          role="menuitem"
          onClick={() => {
            onClose();
            onRemove([image.id]);
          }}
        >
          <Icon name="arrowLeft" />
          从此文件夹移出
        </button>
      )}
    </div>
  );
}

export function GalleryImage({
  image,
  collection,
  selecting,
  selected,
  onToggle,
  onPreview,
  folderId,
  onOrganize,
  onRemove,
  notify,
  width,
  height,
}: {
  image: ImageAsset;
  collection: ImageAsset[];
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onPreview: PreviewImage;
  folderId?: string;
  onOrganize: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  notify: Notify;
  width: number;
  height: number;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <article
      className={`gallery-tile${selected ? " is-selected" : ""}`}
      style={{ width, height }}
    >
      <button
        className="gallery-tile-image"
        aria-label={
          selecting
            ? `${selected ? "取消选择" : "选择"} ${image.name}`
            : `查看 ${image.name}`
        }
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggle : () => onPreview(image, collection)}
      >
        <img
          src={image.thumbnailUrl ?? image.url}
          alt={image.name}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </button>
      {selecting ? (
        <input
          type="checkbox"
          className="gallery-image-checkbox"
          aria-label={`选中 ${image.name}`}
          checked={selected}
          onChange={onToggle}
        />
      ) : (
        <button
          className="icon-button gallery-image-more"
          aria-label={`${image.name} 更多操作`}
          aria-expanded={menu}
          onClick={() => setMenu((previous) => !previous)}
        >
          <Icon name="more" />
        </button>
      )}
      {menu && (
        <ImageMenu
          image={image}
          collection={collection}
          folderId={folderId}
          onPreview={onPreview}
          onOrganize={onOrganize}
          onRemove={onRemove}
          notify={notify}
          onClose={() => setMenu(false)}
        />
      )}
    </article>
  );
}
