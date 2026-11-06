export class APIError extends Error {
  constructor(message: string, public status: number, public retryAfter?: string) { super(message); }
}
// A lost response does not mean a mutation was rejected. Never automatically retry.
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin", headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers,
    } });
  } catch {
    throw new APIError(init.method && init.method !== "GET"
      ? "连接中断，提交结果未知，请先刷新核对，避免重复提交。" : "无法连接服务，请稍后重试。", 0);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const retryAfter = response.headers.get("Retry-After") ?? undefined;
    if (response.status === 401 && path !== "/api/auth/login") window.dispatchEvent(new Event("studio:unauthorized"));
    throw new APIError((error.error || `请求失败（${response.status}）`) +
      (response.status === 429 && retryAfter ? `，请在 ${retryAfter} 秒后重试。` : ""), response.status, retryAfter);
  }
  return response;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}
export async function apiBlob(path: string): Promise<Blob> { return (await request(path)).blob(); }
export const requestID = () => crypto.randomUUID().replaceAll("-", "");
