import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createSeed } from "../data/seed";
import { normalizeOptions } from "../config/models";
import { placeholderImage } from "../lib/images";
import { loadData, persistData } from "../services/persistence";
import { acceptsPreviewCredentials } from "../services/previewAuth";
import type {
  Folder,
  Generation,
  ImageAsset,
  StudioActions,
  StudioData,
  StudioUser,
} from "../types";

import { Context } from "./context";
const id = () => crypto.randomUUID();
export default function PreviewStudioProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<StudioData>(createSeed);
  const ref = useRef(data);
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
        job.status = "failed";
        job.error = "本地预览已重新加载，请重新发送。";
        const user = loaded.users.find((u) => u.id === job.userId);
        if (user) user.balance += job.cost;
        job.cost = 0;
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
    return {
      async generate(prompt, attachments, options) {
        const normalized = normalizeOptions(options);
        if (!prompt.trim()) throw new Error("请输入提示词");
        const job = await update<Generation>((d) => {
          const user = actor(d);
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
            createdAt: new Date().toISOString(),
            cost,
          };
          user.balance -= cost;
          d.generations.push(record);
          return record;
        });
        await new Promise((resolve) => setTimeout(resolve, 1300));
        try {
          return await update<Generation>((d) => {
            const record = d.generations.find((j) => j.id === job.id)!;
            const ratio = normalized.ratio.replace(" HD", "");
            const [rw, rh] = ratio.includes(":")
              ? ratio.split(":").map(Number)
              : [1, 1];
            const width = Math.round((1024 * rw) / rh),
              height = 1024,
              date = new Date().toISOString();
            const images: ImageAsset[] = Array.from(
              { length: normalized.count },
              (_, outputIndex) => ({
                id: id(),
                userId: job.userId,
                name: `生成图片-${outputIndex + 1}.svg`,
                url: placeholderImage(
                  `生成图片 ${outputIndex + 1}`,
                  width,
                  height,
                ),
                width,
                height,
                createdAt: date,
                batchId: job.id,
                outputIndex,
                prompt: job.prompt,
                options: normalized,
                folderIds: [],
              }),
            );
            d.assets.unshift(...images);
            record.status = "completed";
            record.completedAt = date;
            record.durationMs = Date.now() - new Date(job.createdAt).getTime();
            record.imageIds = images.map((a) => a.id);
            return record;
          });
        } catch (e) {
          await update((d) => {
            const record = d.generations.find((j) => j.id === job.id)!;
            record.status = "failed";
            record.error = "保存结果失败，请重试";
            const user = d.users.find((u) => u.id === job.userId);
            if (user) user.balance += record.cost;
            record.cost = 0;
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
            d.assets.find((a) => a.id === i && a.userId === user.id),
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
      setPreferences: (patch) =>
        update((d) => {
          actor(d);
          d.preferences = { ...d.preferences, ...patch };
        }),
      createUser: (input) =>
        update((d) => {
          admin(d);
          const username = input.username.trim();
          if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$/.test(username))
            throw new Error("用户名格式不正确");
          if (
            d.users.some(
              (u) => u.username.toLowerCase() === username.toLowerCase(),
            )
          )
            throw new Error("用户名已存在");
          const bytes = new TextEncoder().encode(input.password).length;
          if (bytes < 4 || bytes > 128)
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
      signIn: (username, password) =>
        update((d) => {
          const user = d.users.find(
            (u) => u.username === username && u.status === "enabled",
          );
          if (!user || !acceptsPreviewCredentials(username, password)) {
            throw new Error("用户名或密码不正确");
          }
          d.currentUserId = user.id;
        }),
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
