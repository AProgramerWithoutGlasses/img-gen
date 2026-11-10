import type { Attachment, ImageAsset } from "../types";
import { api } from "../services/api";

export function placeholderImage(
  label: string,
  width: number,
  height: number,
): string {
  const safe = label.replace(/[<>&"']/g, "");
  const size = Math.min(width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eeeeee"/><path d="M0 0L${width} ${height} M${width} 0L0 ${height}" stroke="#d9d9d9"/><rect x="${width / 2 - size * 0.24}" y="${height / 2 - size * 0.07}" width="${size * 0.48}" height="${size * 0.14}" fill="#eeeeee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(size * 0.045)}" fill="#888">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
export function downloadImage(image: Pick<Attachment, "url" | "name">): void {
  const anchor = document.createElement("a");
  anchor.href = image.url;
  if (image.url.startsWith("/api/images/")) anchor.href = image.url + "?download=1";
  anchor.download = image.url.startsWith("data:image/svg")
    ? image.name.replace(/\.[^.]+$/, "") + ".svg"
    : image.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

let batchDownloadActive = false;
const batchDownloadBudget = 256 * 1024 * 1024;

function archiveFilename(image: ImageAsset, used: Set<string>) {
  let name = image.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim() || "image";
  if (image.url.startsWith("data:image/svg")) name = name.replace(/\.[^.]+$/, "") + ".svg";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name, suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${stem} (${suffix++})${extension}`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

/** Fetch original files once and save one ZIP only after every file succeeds. */
export async function downloadImages(images: ImageAsset[]): Promise<void> {
  if (batchDownloadActive) throw new Error("已有下载正在准备，请稍候。");
  const selected = [...new Map(images.map(image => [image.id, image])).values()];
  if (!selected.length) return;
  if (selected.length > 500) throw new Error("一次最多下载 500 张图片，请分批选择。");
  batchDownloadActive = true;
  let zip: import("fflate").Zip | undefined;
  try {
    const { Zip, ZipPassThrough } = await import("fflate");
    const chunks: BlobPart[] = [];
    const used = new Set<string>();
    let total = 0, finalized = false;
    let archiveError: Error | undefined;
    zip = new Zip((error, chunk, final) => {
      if (error) { archiveError = error; return; }
      chunks.push(new Uint8Array(chunk));
      if (final) finalized = true;
    });
    for (const image of selected) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetch(image.url, { credentials: "same-origin", signal: controller.signal });
        if (response.status === 401) window.dispatchEvent(new Event("studio:unauthorized"));
        if (!response.ok) throw new Error("图片读取失败，未生成下载包，请重试。");
        const expected = Number(response.headers.get("content-length"));
        if (expected > 0 && total + expected > batchDownloadBudget)
          throw new Error("所选原图总大小超过 256 MB，请分批下载。");
        if (!response.body) throw new Error("浏览器无法读取下载内容，请更新浏览器后重试。");
        const entry = new ZipPassThrough(archiveFilename(image, used));
        // PNG/JPEG/WebP are already compressed. Store them without recompression.
        zip.add(entry);
        reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > batchDownloadBudget) throw new Error("所选原图总大小超过 256 MB，请分批下载。");
          entry.push(value, false);
          if (archiveError) throw archiveError;
        }
        entry.push(new Uint8Array(), true);
      } catch (cause) {
        controller.abort();
        if (cause instanceof DOMException && cause.name === "AbortError")
          throw new Error("图片下载超时，请稍后重试。");
        throw cause;
      } finally {
        clearTimeout(timeout);
        await reader?.cancel().catch(() => undefined);
      }
    }
    zip.end();
    if (archiveError) throw archiveError;
    if (!finalized) throw new Error("下载包未能完成，请重试。");
    const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AiCraft-images-${new Date().toISOString().slice(0, 10)}.zip`;
    try {
      document.body.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } finally {
    zip?.terminate();
    batchDownloadActive = false;
  }
}
export async function readImageFile(file: File): Promise<Attachment> {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片");
  if (file.size > 20 * 1024 * 1024) throw new Error("单张图片不能超过 20 MB");
  if (import.meta.env.MODE !== "preview") {
    const body = new FormData();
    body.append("image", file);
    return api<Attachment>("/api/studio/attachments", { method: "POST", body });
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败，请重试"));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("无法读取这张图片"));
      image.src = url;
    },
  );
  return { id: crypto.randomUUID(), name: file.name, url, ...dimensions };
}
