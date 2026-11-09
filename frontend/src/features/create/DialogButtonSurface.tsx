import { useLayoutEffect, useRef } from "react";

/** Keep the visible capsule concentric even at fractional browser/OS scales.
 * CSS borders/backgrounds can snap independently. Draw both contours together,
 * aligning only the outside bounds to device pixels; CSS layout stays intact.
 */
export function DialogButtonSurface() {
  const surface = useRef<SVGSVGElement>(null);
  const redraw = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const svg = surface.current;
    const button = svg?.parentElement;
    if (!svg || !button) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const bounds = button.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = window.devicePixelRatio || 1;
      // Chromium snaps an SVG viewport's paint origin to CSS pixels even when
      // getBoundingClientRect reports fractions. Align that viewport first.
      const originX = Math.floor(bounds.x), originY = Math.floor(bounds.y);
      svg.style.left = `${originX - bounds.x}px`;
      svg.style.top = `${originY - bounds.y}px`;
      const x = Math.round(bounds.x * ratio) / ratio - originX;
      const y = Math.round(bounds.y * ratio) / ratio - originY;
      const width = Math.round(bounds.width * ratio) / ratio;
      const height = Math.round(bounds.height * ratio) / ratio;
      const inset = Number.parseFloat(getComputedStyle(button).getPropertyValue("--dialog-control-inset")) || 2;
      svg.querySelectorAll("rect").forEach((rect, index) => {
        const offset = [0, inset, inset + 1][index];
        const attributes = { x: x + offset, y: y + offset, width: width - 2 * offset,
          height: height - 2 * offset, rx: Math.max(0, height / 2 - offset) };
        for (const [key, value] of Object.entries(attributes)) rect.setAttribute(key, String(value));
      });
    };
    redraw.current = update;
    const observer = new ResizeObserver(update);
    observer.observe(button);
    // Ancestor layout changes can move a fixed-size button onto another pixel phase.
    if (button.parentElement?.parentElement) observer.observe(button.parentElement.parentElement);
    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", watchResolution);
      update();
    };
    watchResolution();
    window.addEventListener("resize", update);
    document.fonts.ready.then(update);
    return () => {
      active = false;
      redraw.current = () => {};
      observer.disconnect();
      resolution.removeEventListener("change", watchResolution);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Prompt growth, model options and other React layout changes also move buttons.
  useLayoutEffect(() => { redraw.current(); });

  return (
    <svg ref={surface} className="dialog-button-surface" aria-hidden="true" focusable="false">
      <rect />
      <rect className="dialog-button-surface-line" />
      <rect />
    </svg>
  );
}
