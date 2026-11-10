export interface ResultLayout {
  columns: number;
  rows: number;
  imageWidth: number;
  imageHeight: number;
  cardHeight: number;
  positions: { left: number; top: number }[];
}

/** Complete images share a slot size; source images can still use contain. */
export function resultLayout(
  count: number,
  ratio: number,
  width: number,
  height: number,
  previousColumns?: number,
): ResultLayout | null {
  const total = Math.max(1, Math.min(4, Math.trunc(count) || 1));
  if (width <= 0 || height <= 0) return null;
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const gap = width < 560 ? 12 : 16;
  const toolbar = 0;
  const candidates = Array.from({ length: total }, (_, index) => index + 1)
    .filter(columns => !(total === 4 && columns === 3))
    .map(columns => {
      const rows = Math.ceil(total / columns);
      const imageHeight = Math.min(
        (width - (columns - 1) * gap) / columns / aspect,
        (height - (rows - 1) * gap) / rows - toolbar,
      );
      const imageWidth = imageHeight * aspect;
      return { columns, rows, imageWidth, imageHeight, area: imageWidth * imageHeight };
    })
    .filter(candidate => candidate.imageHeight > 0 && candidate.imageWidth > 0)
    .sort((a, b) => b.area - a.area || a.rows - b.rows);
  if (!candidates.length) return null;
  let best = candidates[0];
  const previous = candidates.find(candidate => candidate.columns === previousColumns);
  // Keep an almost-equivalent layout while the composer grows or a panel moves.
  if (previous && previous.area >= best.area * .92) best = previous;
  const cardHeight = best.imageHeight + toolbar;
  const top = 0;
  const positions = Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / best.columns);
    const column = index % best.columns;
    const rowCount = Math.min(best.columns, total - row * best.columns);
    const rowWidth = rowCount * best.imageWidth + (rowCount - 1) * gap;
    return {
      left: (width - rowWidth) / 2 + column * (best.imageWidth + gap),
      top: top + row * (cardHeight + gap),
    };
  });
  return { ...best, cardHeight, positions };
}

export function requestedRatio(value: string, attachment?: { width: number; height: number }): number {
  const dimensions = value.split(":").map(Number);
  if (dimensions.length === 2 && dimensions.every(n => Number.isFinite(n) && n > 0))
    return dimensions[0] / dimensions[1];
  return attachment && attachment.width > 0 && attachment.height > 0
    ? attachment.width / attachment.height : 1;
}
