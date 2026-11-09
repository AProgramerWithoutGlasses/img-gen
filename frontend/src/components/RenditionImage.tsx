import { useLayoutEffect, useRef, useState } from "react";
import type { ImgHTMLAttributes } from "react";
import { selectImageURL } from "../lib/image-renditions";
import type { ImageRenditionSource } from "../lib/image-renditions";
import { canFallbackImage } from "../services/image-resource";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> {
  source: ImageRenditionSource;
  displayWidth?: number;
  displayHeight?: number;
  fit?: "contain" | "cover";
  purpose?: "thumbnail" | "preview";
}

export function RenditionImage({ source, displayWidth, displayHeight, fit = "contain", purpose = "preview", onLoad, onError, ...props }: Props) {
  const image = useRef<HTMLImageElement>(null);
  const alive = useRef(true);
  const [layout, setLayout] = useState({ width: 0, height: 0, dpr: window.devicePixelRatio || 1 });
  const [fallbackKey, setFallbackKey] = useState("");
  const identity = [source.url, source.thumbnailUrl, source.previewUrl, source.previewLargeUrl].join("\n");
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const pendingFallback = useRef("");
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    const element = image.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const parent = element.parentElement?.getBoundingClientRect();
      const width = displayWidth ?? (box.width || parent?.width || 1);
      const height = displayHeight ?? (box.height || parent?.height || 1);
      const dpr = window.devicePixelRatio || 1;
      setLayout(previous => previous.width === width && previous.height === height && previous.dpr === dpr
        ? previous : { width, height, dpr });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    const onResize = () => { measure(); watchDPR(); };
    let media: MediaQueryList;
    const watchDPR = () => {
      media?.removeEventListener("change", onResize);
      media = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", onResize);
    };
    watchDPR();
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [displayWidth, displayHeight, source.width, source.height]);
  const selectedURL = layout.width > 0 && layout.height > 0
    ? selectImageURL(source, layout.width, layout.height, layout.dpr, fit, purpose) : undefined;
  const src = fallbackKey === identity ? source.url : selectedURL;
  const currentRequest = useRef("");
  currentRequest.current = identity + "\n" + src;
  return <img {...props} ref={image} src={src} onLoad={onLoad} onError={event => {
    if (!src || src === source.url || !source.url || fallbackKey === identity) {
      onError?.(event);
      return;
    }
    const requestKey = identity + "\n" + src;
    if (pendingFallback.current === requestKey) return;
    pendingFallback.current = requestKey;
    const element = event.currentTarget;
    void canFallbackImage(src).then(allowed => {
      if (!alive.current || currentIdentity.current !== identity || currentRequest.current !== requestKey || pendingFallback.current !== requestKey) return;
      if (allowed) setFallbackKey(identity);
      else {
        // React clears currentTarget after synchronous event dispatch.
        const previousTarget = event.currentTarget;
        event.currentTarget = element;
        try { onError?.(event); } finally { event.currentTarget = previousTarget; }
      }
    });
  }} />;
}
