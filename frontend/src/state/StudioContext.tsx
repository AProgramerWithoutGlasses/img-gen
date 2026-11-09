import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MODELS, setModels } from "../config/models";
import type { Attachment, Generation, ModelConfig, Preferences, StudioActions, StudioData, StudioUser } from "../types";
import { api, apiBlob, APIError, requestID } from "../services/api";
import { Context } from "./context";
export { useStudio } from "./context";

const PreviewProvider = import.meta.env.MODE === "preview"
  ? lazy(() => import("../preview/PreviewStudioProvider")) : null;
type ServerData = StudioData & { priceVersions: Record<string, number> };
const defaults: Preferences = { theme: "system", enterToSend: true };
function emptyData(): ServerData {
  return { version: 1, assets: [], folders: [], generations: [], users: [], currentUserId: "",
    prices: Object.fromEntries(MODELS.map(m => [m.id, 0])) as StudioData["prices"],
    priceUpdatedAt: {}, priceVersions: {}, preferences: defaults };
}
function preferences(userId: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("studio-preferences:" + userId) ?? "null");
    return { theme: ["light", "dark", "system"].includes(saved?.theme) ? saved.theme : "system",
      enterToSend: typeof saved?.enterToSend === "boolean" ? saved.enterToSend : true };
  } catch { return defaults; }
}
function RemoteStudioProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ServerData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(data);
  const epoch = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSubmission = useRef<{ signature: string; id: string } | null>(null);
  const legacyAttachments = useRef(new Map<string, string>());
  const creditRequests = useRef(new Map<string, string>());
  function publish(next: ServerData) { ref.current = next; setData(next); }
  function clear() { epoch.current++; pendingSubmission.current = null; legacyAttachments.current.clear(); creditRequests.current.clear(); publish(emptyData()); }
  function refresh() {
    const generation = epoch.current;
    const task = refreshQueue.current.catch(() => undefined).then(async () => {
      if (generation !== epoch.current) return;
      const next = await api<ServerData>("/api/studio/state");
      if (generation !== epoch.current) return;
      next.preferences = preferences(next.currentUserId);
      publish(next);
    });
    refreshQueue.current = task;
    return task;
  }
  async function loadWorkspace() {
    // Both endpoints authenticate. Wait for both reads to settle before showing
    // login so a late initial 401 cannot clear a newly established session.
    const reads = await Promise.allSettled([
      api<ModelConfig[]>("/api/studio/models").then(setModels),
      refresh(),
    ]);
    for (const read of reads) if (read.status === "rejected") throw read.reason;
  }
  useEffect(() => {
    let active = true;
    const unauthorized = () => clear();
    addEventListener("studio:unauthorized", unauthorized);
    (async () => {
      try {
        await loadWorkspace();
      } catch (cause) {
        if (!(cause instanceof APIError && cause.status === 401) && active)
          setError(cause instanceof Error ? cause.message : "读取工作区失败");
      } finally { if (active) setReady(true); }
    })();
    return () => { active = false; removeEventListener("studio:unauthorized", unauthorized); };
  }, []);
  useEffect(() => {
    if (!ready || !data.currentUserId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); }
      catch (cause) {
        if (active && !(cause instanceof APIError && cause.status === 401))
          window.dispatchEvent(new CustomEvent("studio:error", { detail: cause instanceof Error ? cause.message : "更新失败" }));
      }
      if (active) timer = setTimeout(poll, ref.current.generations.some(g => g.status === "processing") ? 1500 : 15000);
    };
    timer = setTimeout(poll, data.generations.some(g => g.status === "processing") ? 1500 : 15000);
    return () => { active = false; clearTimeout(timer); };
  }, [ready, data.currentUserId, data.generations.some(g => g.status === "processing")]);
  const actions = useMemo<StudioActions>(() => {
    async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
      const result = await api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      // A failed subsequent read must not turn a successful mutation into a retry.
      try { await refresh(); } catch {
        window.dispatchEvent(new CustomEvent("studio:error", { detail: "操作已提交，更新列表失败，请刷新核对。" }));
      }
      return result;
    }
    return {
      async generate(prompt, attachments, options, onAccepted) {
        const attachmentIds: string[] = [];
        for (const attachment of attachments) {
          const foreignResult = "userId" in attachment && attachment.userId !== ref.current.currentUserId;
          if (/^[a-f0-9]{32}$/.test(attachment.id) && !foreignResult) { attachmentIds.push(attachment.id); continue; }
          let uploaded = legacyAttachments.current.get(attachment.id);
          if (!uploaded) {
            const blob = await apiBlob(attachment.url);
            const body = new FormData(); body.append("image", blob, attachment.name);
            uploaded = (await api<Attachment>("/api/studio/attachments", { method: "POST", body })).id;
            legacyAttachments.current.set(attachment.id, uploaded);
          }
          attachmentIds.push(uploaded);
        }
        const payload = { prompt, attachmentIds, options,
          expectedCredits: ref.current.prices[options.modelId] * options.count };
        const signature = JSON.stringify(payload);
        if (pendingSubmission.current?.signature !== signature) pendingSubmission.current = { signature, id: requestID() };
        const id = pendingSubmission.current.id;
        try {
          await api("/api/studio/generations", { method: "POST", body: JSON.stringify({ ...payload, requestId: id }) });
        } catch (cause) {
          await refresh().catch(() => undefined);
          const accepted = ref.current.generations.find(g => g.id === id);
          if (accepted) { pendingSubmission.current = null; onAccepted?.(accepted); return accepted; }
          if (cause instanceof APIError && cause.status >= 400 && cause.status < 500) pendingSubmission.current = null;
          throw cause;
        }
        pendingSubmission.current = null;
        // A successful POST confirms acceptance and validates expectedCredits.
        // Switch the result stage before any queued state read; balances and assets still come from refresh.
        const accepted: Generation = ref.current.generations.find(g => g.id === id) ?? {
          id, userId: ref.current.currentUserId, username: "", prompt, attachments, options,
          status: "processing", imageIds: [], createdAt: new Date().toISOString(), cost: payload.expectedCredits,
        };
        onAccepted?.(accepted);
        try { await refresh(); } catch {
          window.dispatchEvent(new CustomEvent("studio:error", { detail: "任务已提交，读取状态失败，请刷新查看，避免重复提交。" }));
        }
        return ref.current.generations.find(g => g.id === id) ?? accepted;
      },
      createFolder: name => mutate("/api/studio/folders", "POST", { name }),
      renameFolder: (id, name) => mutate("/api/studio/folders/" + id, "PATCH", { name }),
      deleteFolder: id => mutate("/api/studio/folders/" + id, "DELETE"),
      addToFolders: (imageIds, folderIds) => mutate("/api/studio/folder-memberships", "POST", { imageIds, folderIds, remove: false }),
      removeFromFolder: (imageIds, folderId) => mutate("/api/studio/folder-memberships", "POST", { imageIds, folderIds: [folderId], remove: true }),
      async setPreferences(patch) {
        const next = { ...ref.current.preferences, ...patch };
        localStorage.setItem("studio-preferences:" + ref.current.currentUserId, JSON.stringify(next));
        publish({ ...ref.current, preferences: next });
      },
      async createUser(input) {
        const result = await mutate<{ id: string }>("/api/admin/users", "POST", {
          username: input.username, password: input.password, role: input.role, active: input.status === "enabled",
        });
        return ref.current.users.find(u => u.id === result.id) ?? { id: result.id, username: input.username,
          role: input.role, status: input.status, balance: 0, createdAt: new Date().toISOString() };
      },
      updateUser: (id, patch) => mutate("/api/admin/users/" + id, "PATCH", { role: patch.role, active: patch.status === "enabled" }),
      async adjustCredits(id, amount) {
        const key = id + ":" + amount;
        if (!creditRequests.current.has(key)) creditRequests.current.set(key, requestID());
        try {
          await mutate("/api/admin/users/" + id + "/credits", "POST", {
            delta: amount, note: "管理员通过工作室调整积分", request_id: creditRequests.current.get(key),
          });
          creditRequests.current.delete(key);
        } catch (cause) {
          if (cause instanceof APIError && cause.status >= 400 && cause.status < 500) creditRequests.current.delete(key);
          throw cause;
        }
      },
      refreshData: async () => { await refresh(); return ref.current; },
      async savePrice(id, amount, version) {
        try { await mutate("/api/admin/prices/" + id, "PATCH", { credits: amount, version: version ?? ref.current.priceVersions[id] }); }
        catch (cause) { if (cause instanceof APIError && cause.status === 409) await refresh().catch(() => undefined); throw cause; }
      },
      async changePassword(current, next) {
        await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, password: next }) });
        clear(); location.hash = "/login";
      },
      signOut() {
        void api("/api/auth/logout", { method: "POST" }).then(() => { clear(); location.hash = "/login"; })
          .catch(cause => window.dispatchEvent(new CustomEvent("studio:error", { detail: cause.message })));
      },
      async signIn(username, password) {
        await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
        epoch.current++;
        await loadWorkspace();
      },
    };
  }, []);
  if (error) return <div className="boot-error"><h1>无法读取工作区</h1><p>{error}</p><button className="btn" onClick={() => location.reload()}>重试</button></div>;
  if (!ready) return <div className="boot-error" role="status">正在载入…</div>;
  const currentUser: StudioUser = data.users.find(u => u.id === data.currentUserId) ?? {
    id: "", username: "", role: "user", status: "disabled", balance: 0, createdAt: "",
  };
  return <Context.Provider value={{ data, currentUser, actions }}>{children}</Context.Provider>;
}
export function StudioProvider({ children }: { children: ReactNode }) {
  return PreviewProvider
    ? <Suspense fallback={null}><PreviewProvider>{children}</PreviewProvider></Suspense>
    : <RemoteStudioProvider>{children}</RemoteStudioProvider>;
}
