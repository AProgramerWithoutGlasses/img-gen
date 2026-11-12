import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MODELS, setModels } from "../config/models";
import type { Attachment, Generation, ImagePage, ModelConfig, Preferences, StudioActions, StudioData, StudioUser } from "../types";
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
function mergeRecords<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const records = new Map(existing.map(record => [record.id, record]));
  for (const record of incoming) records.set(record.id, record);
  return [...records.values()];
}
function RemoteStudioProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ServerData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(data);
  const epoch = useRef(0);
  const imageRevision = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSubmission = useRef<{ signature: string; id: string } | null>(null);
  const legacyAttachments = useRef(new Map<string, string>());
  const creditRequests = useRef(new Map<string, string>());
  const pendingReads = useRef(new Set<AbortController>());
  const historyRequest = useRef<Promise<void> | null>(null);
  function publish(next: ServerData) { ref.current = next; setData(next); }
  function clear() {
    epoch.current++;
    for (const controller of pendingReads.current) controller.abort();
    pendingReads.current.clear();
    historyRequest.current = null;
    pendingSubmission.current = null;
    legacyAttachments.current.clear();
    creditRequests.current.clear();
    publish(emptyData());
  }
  function refresh(fullHistory = false) {
    const generation = epoch.current;
    const revision = imageRevision.current;
    const task = refreshQueue.current.catch(() => undefined).then(async () => {
      if (generation !== epoch.current || revision !== imageRevision.current) return;
      const controller = new AbortController();
      pendingReads.current.add(controller);
      try {
        const query = new URLSearchParams({ view: "workspace" });
        const processing = [...new Set(ref.current.generations
          .filter(record => record.userId === ref.current.currentUserId && record.status === "processing")
          .map(record => record.id.match(/^[a-f0-9]{32}/)?.[0])
          .filter((id): id is string => !!id))].slice(0, 100);
        if (processing.length) query.set("watch", processing.join(","));
        const next = await api<ServerData>(fullHistory ? "/api/studio/state" : "/api/studio/state?" + query, { signal: controller.signal });
        if (generation !== epoch.current || revision !== imageRevision.current || controller.signal.aborted) return;
        const previous = ref.current.currentUserId === next.currentUserId ? ref.current : emptyData();
        const updatedBatches = new Map(next.generations.map(record => [record.id, record]));
        const retainedAssets = previous.assets.flatMap(image => {
          const output = updatedBatches.get(image.batchId)?.outputs?.find(item => item.outputIndex === image.outputIndex);
          const state = output?.imageStates?.[image.id] ?? output?.imageState;
          if (state === "deleted") return [];
          if (state === "trashed") return [{ ...image, trashedAt: image.trashedAt ?? new Date().toISOString() }];
          if (state === "available") return [{ ...image, trashedAt: undefined }];
          return [image];
        });
        publish({ ...next, preferences: preferences(next.currentUserId),
          assets: mergeRecords(retainedAssets, next.assets),
          generations: mergeRecords(previous.generations, next.generations),
          imageSummary: next.imageSummary ?? previous.imageSummary,
        });
      } catch (cause) {
        if (!controller.signal.aborted) throw cause;
      } finally { pendingReads.current.delete(controller); }
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
      if (active) timer = setTimeout(poll, ref.current.generations.some(g => g.userId === ref.current.currentUserId && g.status === "processing") ? 1500 : 15000);
    };
    timer = setTimeout(poll, data.generations.some(g => g.userId === data.currentUserId && g.status === "processing") ? 1500 : 15000);
    return () => { active = false; clearTimeout(timer); };
  }, [ready, data.currentUserId, data.generations.some(g => g.userId === data.currentUserId && g.status === "processing")]);
  const actions = useMemo<StudioActions>(() => {
    async function changeImages(action: "trash" | "restore" | "purge", imageIds: string[]) {
      const session = epoch.current;
      const ids = new Set(imageIds);
      await api("/api/studio/images/" + action, { method: "POST", body: JSON.stringify({ imageIds }) });
      if (session !== epoch.current) return;
      // Reads started before this write must not reintroduce an old image state.
      imageRevision.current++;
      for (const controller of pendingReads.current) controller.abort();
      pendingReads.current.clear();
      historyRequest.current = null;
      const affected = ref.current.assets.filter(image => ids.has(image.id));
      const now = new Date().toISOString();
      publish({ ...ref.current,
        assets: ref.current.assets.flatMap(image => !ids.has(image.id) ? [image]
          : action === "purge" ? [] : [{ ...image, trashedAt: action === "trash" ? image.trashedAt ?? now : undefined }]),
        generations: ref.current.generations.map(record => {
          const outputs = affected.filter(image => image.batchId === record.id);
          if (!outputs.length) return record;
          return { ...record,
            imageIds: action === "restore" ? [...new Set([...record.imageIds, ...outputs.map(image => image.id)])]
              : record.imageIds.filter(id => !ids.has(id)),
            outputs: record.outputs?.map(output => {
              const changed = outputs.filter(image => image.outputIndex === output.outputIndex);
              if (!changed.length) return output;
              const known = ref.current.assets.filter(image => image.batchId === record.id && image.outputIndex === output.outputIndex);
              const states: NonNullable<typeof output.imageStates> = {
                ...Object.fromEntries(known.map(image => [image.id, image.trashedAt ? "trashed" as const : "available" as const])),
                ...output.imageStates,
                ...Object.fromEntries(changed.map(image => [image.id, action === "trash" ? "trashed" as const : action === "restore" ? "available" as const : "deleted" as const])),
              };
              const values = Object.values(states);
              return { ...output, imageStates: states,
                imageState: values.includes("available") ? "available" : values.includes("trashed") ? "trashed" : "deleted" };
            }),
          };
        }),
      });
      try { await refresh(); } catch {
        window.dispatchEvent(new CustomEvent("studio:error", { detail: "操作已提交，更新列表失败，请刷新核对。" }));
      }
    }
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
          if (ref.current.assets.find(image => image.id === attachment.id)?.trashedAt
            || ("trashedAt" in attachment && attachment.trashedAt))
            throw new Error("图片已移入回收站，请先复原后使用。");
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
      async deleteFolder(id) {
        const generation = epoch.current;
        await mutate("/api/studio/folders/" + id, "DELETE");
        if (generation === epoch.current) publish({ ...ref.current,
          assets: ref.current.assets.map(image => ({ ...image, folderIds: image.folderIds.filter(folderId => folderId !== id) })),
        });
      },
      async addToFolders(imageIds, folderIds) {
        const generation = epoch.current;
        await mutate("/api/studio/folder-memberships", "POST", { imageIds, folderIds, remove: false });
        if (generation === epoch.current) publish({ ...ref.current,
          assets: ref.current.assets.map(image => imageIds.includes(image.id)
            ? { ...image, folderIds: [...new Set([...image.folderIds, ...folderIds])] } : image),
        });
      },
      async removeFromFolder(imageIds, folderId) {
        const generation = epoch.current;
        await mutate("/api/studio/folder-memberships", "POST", { imageIds, folderIds: [folderId], remove: true });
        if (generation === epoch.current) publish({ ...ref.current,
          assets: ref.current.assets.map(image => imageIds.includes(image.id)
            ? { ...image, folderIds: image.folderIds.filter(id => id !== folderId) } : image),
        });
      },
      trashImages: imageIds => changeImages("trash", imageIds),
      restoreImages: imageIds => changeImages("restore", imageIds),
      purgeImages: imageIds => changeImages("purge", imageIds),
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
      async listImages(options = {}) {
        const generation = epoch.current;
        const revision = imageRevision.current;
        const userId = ref.current.currentUserId;
        const controller = new AbortController();
        pendingReads.current.add(controller);
        const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        const query = new URLSearchParams({ limit: "50" });
        if (options.view) query.set("view", options.view);
        if (options.folderId) query.set("folderId", options.folderId);
        if (options.cursor) query.set("cursor", options.cursor);
        try {
          const result = await api<ImagePage>("/api/studio/images?" + query, { signal });
          if (signal.aborted || generation !== epoch.current || revision !== imageRevision.current || userId !== ref.current.currentUserId) {
            throw new DOMException("图片读取已取消", "AbortError");
          }
          publish({ ...ref.current, assets: mergeRecords(ref.current.assets, result.images) });
          return result;
        } finally { pendingReads.current.delete(controller); }
      },
      loadHistory() {
        if (historyRequest.current) return historyRequest.current;
        const task = refresh(true).finally(() => { if (historyRequest.current === task) historyRequest.current = null; });
        historyRequest.current = task;
        return task;
      },
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
        for (const controller of pendingReads.current) controller.abort();
        pendingReads.current.clear();
        historyRequest.current = null;
        await loadWorkspace();
      },
      async register(username, password) {
        await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
        // Registration is never retried. If login/read fails the account exists;
        // use the normal login instead of registering the account again.
        try {
          await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
          epoch.current++;
          for (const controller of pendingReads.current) controller.abort();
          pendingReads.current.clear();
          historyRequest.current = null;
          await loadWorkspace();
        } catch {
          throw new Error("账号已创建，请切换到登录后进入。");
        }
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
