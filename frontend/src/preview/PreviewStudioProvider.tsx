import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createSeed } from "./seed";
import { normalizeOptions } from "../config/models";
import { placeholderImage } from "../lib/images";
import { loadData, persistData } from "./persistence";
import { acceptsPreviewCredentials } from "./auth";
import { passwordLengthError, USERNAME_PATTERN } from "../lib/auth";
import type {
  Folder,
  Generation,
  ImageAsset,
  StudioActions,
  StudioData,
  StudioUser,
} from "../types";

import { Context } from "../state/context";
const id = () => crypto.randomUUID();
async function previewPasswordFingerprint(password: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function failUnfinishedOutputs(record: Generation, finishedAt: string): number {
  const unfinished = record.outputs?.filter(output => output.status === "queued" || output.status === "running");
  const billable = record.outputs?.filter(output => output.status !== "failed").length ?? record.options.count;
  const refund = billable ? Math.floor(record.cost * (unfinished?.length ?? billable) / billable) : 0;
  unfinished?.forEach(output => { output.status = "failed"; output.finishedAt = finishedAt; });
  record.status = "failed";
  record.completedAt = finishedAt;
  record.cost -= refund;
  return refund;
}
export default function PreviewStudioProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [data, setData] = useState<StudioData>(createSeed);
  const ref = useRef(data);
  // Preview-only credentials stay in memory and are never saved in IndexedDB.
  const registeredCredentials = useRef(new Map<string, string>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const boot = useRef<Promise<StudioData> | null>(null);
  useEffect(() => {
    let active = true;
    boot.current ??= (async () => {
      const loaded = (await loadData()) ?? createSeed();
      // A browser refresh ends simulated work; keep completed assets and refund only its local reservation.
      for (const job of loaded.generations.filter(
        (j) => j.status === "processing",
      )) {
        const refund = failUnfinishedOutputs(job, new Date().toISOString());
        job.error = "本地预览已重新加载，请重新发送。";
        const user = loaded.users.find((u) => u.id === job.userId);
        if (user) user.balance += refund;
      }
      await persistData(loaded);
      return loaded;
    })();
    boot.current
      .then((loaded) => {
        if (active) {
          ref.current = loaded;
          setData(loaded);
          setReady(true);
        }
      })
      .catch((e) => active && setError(String(e.message)));
    return () => {
      active = false;
    };
  }, []);
  const actions = useMemo<StudioActions>(() => {
    function update<T>(fn: (draft: StudioData) => T): Promise<T> {
      const task = queue.current.then(async () => {
        const next = structuredClone(ref.current);
        const result = fn(next);
        await persistData(next);
        ref.current = next;
        setData(next);
        return result;
      });
      queue.current = task.catch(() => undefined);
      return task;
    }
    const actor = (d: StudioData) => {
      const user = d.users.find((u) => u.id === d.currentUserId);
      if (!user || user.status !== "enabled")
        throw new Error("请先进入一个启用的预览账号");
      return user;
    };
    const admin = (d: StudioData) => {
      const user = actor(d);
      if (user.role !== "admin") throw new Error("没有管理员权限");
      return user;
    };
    const folder = (d: StudioData, folderId: string) => {
      const user = actor(d);
      const item = d.folders.find(
        (f) => f.id === folderId && f.userId === user.id,
      );
      if (!item) throw new Error("文件夹不存在");
      return item;
    };
    const validName = (d: StudioData, name: string, exceptId?: string) => {
      const user = actor(d);
      const clean = name.trim();
      if (!clean || clean.length > 60)
        throw new Error("请输入 1–60 个字符的文件夹名称");
      if (
        d.folders.some(
          (f) =>
            f.userId === user.id &&
            f.id !== exceptId &&
            f.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
        )
      )
        throw new Error("此名称已被使用，请换一个名称");
      return clean;
    };
    const changeImages = (action: "trash" | "restore" | "purge", imageIds: string[]) => update(d => {
      const user = actor(d);
      const ids = [...new Set(imageIds)];
      if (!ids.length || ids.length > 500) throw new Error("请选择 1–500 张图片");
      const images = ids.map(imageId => d.assets.find(image => image.id === imageId && image.userId === user.id));
      if (images.some(image => !image)) throw new Error("图片不存在");
      if (action === "purge" && images.some(image => !image!.trashedAt)) throw new Error("只能彻底删除回收站中的图片");
      for (const image of images) {
        image!.trashedAt = action === "trash" ? image!.trashedAt ?? new Date().toISOString() : undefined;
        const record = d.generations.find(generation => generation.id === image!.batchId);
        if (!record) continue;
        const output = record.outputs?.find(item => item.outputIndex === image!.outputIndex);
        if (output) {
          const known = d.assets.filter(item => item.batchId === record.id && item.outputIndex === output.outputIndex);
          output.imageStates = {
            ...Object.fromEntries(known.map(item => [item.id, item.trashedAt ? "trashed" as const : "available" as const])),
            ...output.imageStates,
            [image!.id]: action === "trash" ? "trashed" : action === "restore" ? "available" : "deleted",
          };
          const values = Object.values(output.imageStates);
          output.imageState = values.includes("available") ? "available" : values.includes("trashed") ? "trashed" : "deleted";
        }
        record.imageIds = action === "restore" ? [...new Set([...record.imageIds, image!.id])]
          : record.imageIds.filter(id => id !== image!.id);
      }
      if (action === "purge") d.assets = d.assets.filter(image => !ids.includes(image.id));
    });
    return {
      async generate(prompt, attachments, options, onAccepted) {
        const normalized = normalizeOptions(options, attachments.length > 0);
        if (!prompt.trim()) throw new Error("请输入提示词");
        const job = await update<Generation>((d) => {
          const user = actor(d);
          if (attachments.some(attachment => d.assets.some(image => image.id === attachment.id && (image.trashedAt || image.userId !== user.id))))
            throw new Error("图片已移入回收站，请先复原后使用");
          const cost = d.prices[normalized.modelId] * normalized.count;
          if (user.balance < cost) throw new Error("积分不足，请先充值");
          const record: Generation = {
            id: id(),
            userId: user.id,
            username: user.username,
            prompt: prompt.trim(),
            attachments: structuredClone(attachments),
            options: normalized,
            status: "processing",
            imageIds: [],
            outputs: Array.from({ length: normalized.count }, (_, outputIndex) => ({ outputIndex, status: "queued" as const })),
            createdAt: new Date().toISOString(),
            cost,
          };
          user.balance -= cost;
          d.generations.push(record);
          return record;
        });
        onAccepted?.(job);
        let nextOutput = 0;
        let halted = false;
        try {
          // Match the server's two queue consumers. Each slot is started and
          // completed separately; these timers belong only to the local preview.
          const worker = async () => {
            while (!halted) {
              const outputIndex = nextOutput++;
              if (outputIndex >= normalized.count) return;
              try {
                await update(d => {
                  const output = d.generations.find(j => j.id === job.id)!.outputs![outputIndex];
                  output.status = "running";
                  output.startedAt = new Date().toISOString();
                });
                await new Promise(resolve => setTimeout(resolve, 1000 + outputIndex * 180));
                await update(d => {
                  const record = d.generations.find(j => j.id === job.id)!;
                  const ratio = normalized.ratio.replace(" HD", "");
                  const [rw, rh] = ratio.includes(":") ? ratio.split(":").map(Number)
                    : attachments[0]?.width && attachments[0]?.height ? [attachments[0].width, attachments[0].height] : [1, 1];
                  const width = Math.round(1024 * rw / rh), height = 1024;
                  const date = new Date().toISOString();
                  const image: ImageAsset = {
                    id: id(),
                    userId: job.userId,
                    name: `生成图片-${outputIndex + 1}.svg`,
                    url: placeholderImage(`生成图片 ${outputIndex + 1}`, width, height),
                    width,
                    height,
                    createdAt: date,
                    batchId: job.id,
                    outputIndex,
                    prompt: job.prompt,
                    options: normalized,
                    folderIds: [],
                  };
                  d.assets.unshift(image);
                  const output = record.outputs![outputIndex];
                  output.status = "succeeded";
                  output.finishedAt = date;
                  record.imageIds = d.assets.filter(asset => asset.batchId === job.id)
                    .sort((a, b) => a.outputIndex - b.outputIndex).map(asset => asset.id);
                  if (record.outputs!.every(item => item.status === "succeeded")) {
                    record.status = "completed";
                    record.completedAt = date;
                    record.durationMs = Date.now() - new Date(job.createdAt).getTime();
                  }
                });
              } catch (cause) { halted = true; throw cause; }
            }
          };
          const workers = await Promise.allSettled([worker(), worker()]);
          const failure = workers.find(result => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          return ref.current.generations.find(record => record.id === job.id)!;
        } catch (e) {
          await update((d) => {
            const record = d.generations.find((j) => j.id === job.id)!;
            const refund = failUnfinishedOutputs(record, new Date().toISOString());
            record.error = "保存结果失败，请重试";
            const user = d.users.find((u) => u.id === job.userId);
            if (user) user.balance += refund;
          }).catch(() => undefined);
          throw e;
        }
      },
      createFolder: (name) =>
        update<Folder>((d) => {
          const item: Folder = {
            id: id(),
            userId: actor(d).id,
            name: validName(d, name),
            createdAt: new Date().toISOString(),
          };
          d.folders.push(item);
          return item;
        }),
      renameFolder: (folderId, name) =>
        update((d) => {
          const item = folder(d, folderId);
          item.name = validName(d, name, folderId);
        }),
      deleteFolder: (folderId) =>
        update((d) => {
          folder(d, folderId);
          d.folders = d.folders.filter((f) => f.id !== folderId);
          d.assets.forEach((a) => {
            a.folderIds = a.folderIds.filter((f) => f !== folderId);
          });
        }),
      addToFolders: (imageIds, folderIds) =>
        update((d) => {
          const user = actor(d);
          folderIds.forEach((f) => folder(d, f));
          const assets = imageIds.map((i) =>
            d.assets.find((a) => a.id === i && a.userId === user.id && !a.trashedAt),
          );
          if (assets.some((a) => !a)) throw new Error("图片不存在");
          assets.forEach((a) => {
            a!.folderIds = [...new Set([...a!.folderIds, ...folderIds])];
          });
        }),
      removeFromFolder: (imageIds, folderId) =>
        update((d) => {
          folder(d, folderId);
          const user = actor(d);
          d.assets
            .filter((a) => a.userId === user.id && imageIds.includes(a.id))
            .forEach((a) => {
              a.folderIds = a.folderIds.filter((f) => f !== folderId);
            });
        }),
      trashImages: imageIds => changeImages("trash", imageIds),
      restoreImages: imageIds => changeImages("restore", imageIds),
      purgeImages: imageIds => changeImages("purge", imageIds),
      setPreferences: (patch) =>
        update((d) => {
          actor(d);
          d.preferences = { ...d.preferences, ...patch };
        }),
      createUser: (input) =>
        update((d) => {
          admin(d);
          const username = input.username.trim();
          if (!USERNAME_PATTERN.test(username))
            throw new Error("用户名格式不正确");
          if (
            d.users.some(
              (u) => u.username.toLowerCase() === username.toLowerCase(),
            )
          )
            throw new Error("用户名已存在");
          if (passwordLengthError(input.password))
            throw new Error("初始密码应为 4–128 字节");
          const user: StudioUser = {
            id: id(),
            username,
            role: input.role,
            status: input.status,
            balance: 0,
            createdAt: new Date().toISOString(),
          };
          d.users.push(user);
          return user;
        }),
      updateUser: (userId, patch) =>
        update((d) => {
          const current = admin(d);
          const user = d.users.find((u) => u.id === userId);
          if (!user) throw new Error("用户不存在");
          if (
            user.id === current.id &&
            (patch.role !== "admin" || patch.status !== "enabled")
          )
            throw new Error("不能停用或降低当前账号的权限");
          Object.assign(user, patch);
        }),
      adjustCredits: (userId, amount) =>
        update((d) => {
          admin(d);
          const user = d.users.find((u) => u.id === userId);
          if (!user) throw new Error("用户不存在");
          if (
            !Number.isSafeInteger(amount) ||
            !Number.isSafeInteger(user.balance + amount) ||
            user.balance + amount < 0
          )
            throw new Error("调整后积分应为非负整数");
          user.balance += amount;
        }),
      savePrice: (modelId, amount) =>
        update((d) => {
          admin(d);
          if (!Number.isSafeInteger(amount) || amount < 0)
            throw new Error("价格必须为非负整数");
          d.prices[modelId] = amount;
          d.priceUpdatedAt[modelId] = new Date().toISOString();
        }),
      changePassword: async () => {
        throw new Error("本地预览尚未接入认证服务，密码未修改。");
      },
      signOut: () => {
        void update((d) => {
          d.currentUserId = "";
        }).catch((e) => setError(e.message));
      },
      signIn: async (username, password) => {
        const fingerprint = await previewPasswordFingerprint(password);
        return update((d) => {
          const user = d.users.find(
            (u) => u.username.toLowerCase() === username.toLowerCase() && u.status === "enabled",
          );
          if (!user || !(acceptsPreviewCredentials(user.username, password) || registeredCredentials.current.get(user.username.toLowerCase()) === fingerprint)) {
            throw new Error("用户名或密码不正确");
          }
          d.currentUserId = user.id;
        });
      },
      async register(username, password) {
        username = username.trim();
        if (!USERNAME_PATTERN.test(username)) throw new Error("用户名格式不正确");
        const lengthError = passwordLengthError(password, true);
        if (lengthError) throw new Error(lengthError);
        const fingerprint = await previewPasswordFingerprint(password);
        await update(d => {
          if (d.users.some(user => user.username.toLowerCase() === username.toLowerCase())) throw new Error("用户名已存在");
          const user: StudioUser = { id: id(), username, role: "user", status: "enabled", balance: 0, createdAt: new Date().toISOString() };
          d.users.push(user);
          d.currentUserId = user.id;
        });
        registeredCredentials.current.set(username.toLowerCase(), fingerprint);
      },
    };
  }, []);
  if (error)
    return (
      <div className="boot-error">
        <h1>无法读取本地预览</h1>
        <p>{error}</p>
        <button className="btn" onClick={() => location.reload()}>
          重试
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="boot-error" role="status">
        正在载入…
      </div>
    );
  const currentUser = data.users.find((u) => u.id === data.currentUserId) ?? {
    id: "",
    username: "",
    role: "user" as const,
    status: "disabled" as const,
    balance: 0,
    createdAt: "",
  };
  return (
    <Context.Provider value={{ data, currentUser, actions }}>
      {children}
    </Context.Provider>
  );
}
