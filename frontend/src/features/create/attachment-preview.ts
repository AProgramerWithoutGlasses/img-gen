interface PreviewDimensions {
  width?: number;
  height?: number;
}

interface PreviewRect {
  left: number;
  top: number;
  width: number;
}

export interface AttachmentPreviewLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  pictureWidth: number;
  pictureHeight: number;
}

const validDimension = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

// Preview pixels may be smaller than the original. Only their aspect ratio can
// correct old EXIF metadata; their rendition size must not shrink the layout.
export function visibleAttachmentDimensions(
  source: PreviewDimensions,
  natural?: PreviewDimensions,
): { width: number; height: number } {
  if (validDimension(source.width) && validDimension(source.height)) {
    if (validDimension(natural?.width) && validDimension(natural?.height)) {
      const ratio = natural.width / natural.height;
      const expected = source.width / source.height;
      // Tiny rendition dimensions may round heavily for extreme aspect ratios.
      // Only an identifiable EXIF width/height swap should override metadata.
      if (Math.abs(ratio * expected - 1) < .02 && Math.abs(ratio / expected - 1) > .02) {
        return { width: source.height, height: source.width };
      }
    }
    return { width: source.width, height: source.height };
  }
  if (validDimension(natural?.width) && validDimension(natural?.height)) {
    return { width: natural.width, height: natural.height };
  }
  return { width: 288, height: 288 };
}

export function attachmentPreviewLayout(
  dimensions: { width: number; height: number },
  anchor: PreviewRect,
  container: { left: number; top: number },
  viewportWidth: number,
): AttachmentPreviewLayout | null {
  const edge = 8;
  const gap = 10;
  const maxWidth = Math.min(324, viewportWidth - edge * 2);
  const maxHeight = Math.min(324, anchor.top - gap - edge);
  if (maxWidth <= 8 || maxHeight <= 36) return null;
  const scale = Math.min(1, (maxWidth - 8) / dimensions.width,
    (maxHeight - 36) / dimensions.height);
  const pictureWidth = dimensions.width * scale;
  const pictureHeight = dimensions.height * scale;
  const width = Math.min(maxWidth, Math.max(128, pictureWidth + 8));
  const height = pictureHeight + 36;
  const desiredLeft = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.max(edge, Math.min(viewportWidth - edge - width, desiredLeft));
  return {
    left: left - container.left,
    top: anchor.top - gap - height - container.top,
    width,
    height,
    pictureWidth,
    pictureHeight,
  };
}
