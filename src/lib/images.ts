import type { Attachment } from "../types";

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
  anchor.download = image.url.startsWith("data:image/svg")
    ? image.name.replace(/\.[^.]+$/, "") + ".svg"
    : image.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
export async function readImageFile(file: File): Promise<Attachment> {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片");
  if (file.size > 20 * 1024 * 1024) throw new Error("单张图片不能超过 20 MB");
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
