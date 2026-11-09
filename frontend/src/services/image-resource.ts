/** Only probe after an image load error; successful displays perform no HEAD.
 * An img error does not expose its HTTP status. Do not turn auth failures into
 * a second request for the original, or mask an expired session.
 */
export async function canFallbackImage(failedURL: string): Promise<boolean> {
  if (!failedURL.startsWith("/api/")) return true;
  try {
    const response = await fetch(failedURL, { method: "HEAD", credentials: "same-origin" });
    if (response.status === 401) window.dispatchEvent(new Event("studio:unauthorized"));
    return response.status !== 401 && response.status !== 403;
  } catch {
    return true;
  }
}
