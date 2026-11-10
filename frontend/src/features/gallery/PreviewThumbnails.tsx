import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RenditionImage } from "../../components/RenditionImage";
import type { ImageAsset } from "../../types";

interface Props {
  images: ImageAsset[];
  selectedIndex: number;
  switchPreview: (step: number) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadError?: string;
  onLoadMore?: () => void;
  onRetryMore?: () => void;
}

export function PreviewThumbnails(props: Props) {
  const { images, selectedIndex, switchPreview, hasMore, loadingMore, loadError, onRetryMore } = props;
  const nav = useRef<HTMLElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const slots = images.length + (hasMore ? 1 : 0);
  const [window, setWindow] = useState({ start: 0, end: 16, horizontal: false, step: 74, size: 64 });

  useLayoutEffect(() => {
    const element = nav.current!;
    let frame = 0;
    const measure = () => {
      const style = getComputedStyle(element);
      const horizontal = style.flexDirection === "row";
      const size = Number.parseFloat(style.getPropertyValue("--preview-thumbnail-size"));
      const gap = Number.parseFloat(style.gap);
      const step = size + gap;
      const offset = horizontal ? element.scrollLeft : element.scrollTop;
      const viewport = horizontal ? element.clientWidth : element.clientHeight;
      const start = Math.max(0, Math.floor(offset / step) - 3);
      const end = Math.min(slots, Math.ceil((offset + viewport) / step) + 3);
      setWindow(previous => previous.start === start && previous.end === end && previous.horizontal === horizontal
        && previous.step === step && previous.size === size ? previous : { start, end, horizontal, step, size });
      const current = latest.current;
      if (offset + viewport >= current.images.length * step - step * 3
        && current.hasMore && !current.loadingMore && !current.loadError) current.onLoadMore?.();
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener("scroll", schedule); };
  }, [slots]);

  useLayoutEffect(() => {
    const element = nav.current!;
    const style = getComputedStyle(element);
    const horizontal = style.flexDirection === "row";
    const size = Number.parseFloat(style.getPropertyValue("--preview-thumbnail-size"));
    const step = size + Number.parseFloat(style.gap);
    const padding = Number.parseFloat(horizontal ? style.paddingLeft : style.paddingTop);
    const offset = horizontal ? element.scrollLeft : element.scrollTop;
    const viewport = horizontal ? element.clientWidth : element.clientHeight;
    const start = selectedIndex * step;
    const end = start + size + padding * 2;
    const next = start < offset ? start : end > offset + viewport ? end - viewport : offset;
    if (horizontal) element.scrollLeft = Math.max(0, next);
    else element.scrollTop = Math.max(0, next);
    element.dispatchEvent(new Event("scroll"));
  }, [selectedIndex, window.horizontal]);

  useEffect(() => {
    const current = latest.current;
    if (selectedIndex >= images.length - 5 && current.hasMore && !current.loadingMore && !current.loadError) current.onLoadMore?.();
  }, [selectedIndex, images.length, hasMore]);

  const length = Math.max(0, slots * window.step - (window.step - window.size));
  const indices = Array.from({ length: Math.max(0, Math.min(window.end, images.length) - window.start) }, (_, index) => window.start + index);
  const position = (index: number) => window.horizontal ? { left: index * window.step } : { top: index * window.step };
  return (
    <nav ref={nav} className="preview-thumbnails" aria-label="图片切换" tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault(); event.stopPropagation();
          switchPreview((event.key === "Home" ? 0 : images.length - 1) - selectedIndex);
        }
      }}>
      <div className="preview-thumbnail-track" style={window.horizontal ? { width: length, height: window.size } : { height: length, width: window.size }}>
        {indices.map(index => {
          const image = images[index];
          return (
            <button key={image.id} style={position(index)}
              className={`preview-thumbnail${index === selectedIndex ? " is-current" : ""}`}
              tabIndex={index === selectedIndex ? 0 : -1}
              aria-label={`查看第 ${index + 1} 张图片`} aria-current={index === selectedIndex ? "true" : undefined}
              onClick={() => switchPreview(index - selectedIndex)}>
              <RenditionImage source={image} fit="contain" purpose="thumbnail" displayWidth={56} displayHeight={56} alt="" loading="lazy" decoding="async" />
              <span>{index + 1}</span>
            </button>
          );
        })}
        {hasMore && window.end > images.length && (
          <button className="preview-thumbnail preview-thumbnail-more" style={position(images.length)} disabled={loadingMore}
            title={loadError} onClick={loadError ? onRetryMore : props.onLoadMore}>
            {loadingMore ? "加载中…" : loadError ? "重试" : "加载更多"}
          </button>
        )}
      </div>
    </nav>
  );
}
