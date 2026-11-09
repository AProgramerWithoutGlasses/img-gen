export interface ImageRenditionSource {
  url?: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  previewLargeUrl?: string;
}

interface Candidate {
  url: string;
  width: number;
  height: number;
}

function dimensions(source: ImageRenditionSource) {
  return {
    width: source.width && source.width > 0 ? source.width : 1,
    height: source.height && source.height > 0 ? source.height : 1,
  };
}

function fitted(source: ImageRenditionSource, url: string | undefined, limit: number): Candidate[] {
  if (!url) return [];
  const { width, height } = dimensions(source);
  const known = !!source.width && !!source.height;
  const scale = known ? Math.min(1, limit / Math.max(width, height)) : limit;
  return [{ url, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }];
}

/** Choose by rendered pixels, including the pixels discarded by cover cropping.
 * The rendition limits are longest edges, not srcset pixel widths or fixed DPRs.
 */
export function selectImageURL(
  source: ImageRenditionSource,
  displayWidth: number,
  displayHeight: number,
  dpr = 1,
  fit: "contain" | "cover" = "contain",
  purpose: "thumbnail" | "preview" = "preview",
): string | undefined {
  const candidates: Candidate[] = [];
  if (source.previewLargeUrl) {
    if (purpose === "thumbnail" && source.thumbnailUrl) {
      const edge = source.width && source.height ? Math.min(256, source.width, source.height) : 256;
      candidates.push({ url: source.thumbnailUrl, width: edge, height: edge });
    }
    candidates.push(...fitted(source, source.previewUrl, 640), ...fitted(source, source.previewLargeUrl, 1600));
  } else {
    // Generated images retain the original 640/1600 URL contract. Old input
    // attachments may have only the existing 1600px preview URL.
    candidates.push(...fitted(source, source.thumbnailUrl, 640), ...fitted(source, source.previewUrl, 1600));
  }
  if (!candidates.length) return source.url;
  const density = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const boxWidth = Math.max(1, displayWidth), boxHeight = Math.max(1, displayHeight);
  const { width, height } = dimensions(source);
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const requiredWidth = fit === "cover" ? boxWidth * density : width * scale * density;
  const requiredHeight = fit === "cover" ? boxHeight * density : height * scale * density;
  const enough = candidates.find(candidate => candidate.width + 1 >= requiredWidth && candidate.height + 1 >= requiredHeight);
  // Small originals cannot satisfy high DPR. Pick the best available pixels,
  // keeping the smaller first rendition when larger limits add no resolution.
  const best = enough ?? candidates.reduce((previous, candidate) =>
    Math.min(candidate.width / requiredWidth, candidate.height / requiredHeight) >
      Math.min(previous.width / requiredWidth, previous.height / requiredHeight) + 0.001 ? candidate : previous);
  return best.url;
}
