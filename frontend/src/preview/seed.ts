import { DEFAULT_OPTIONS, MODELS } from "../config/models";
import { placeholderImage } from "../lib/images";
import type { ImageAsset, StudioData } from "../types";

export function createSeed(): StudioData {
  // Seed history must precede tasks created during the preview session.
  const today = new Date(Date.now() - 60000);
  const date = today.toISOString();
  const yesterday = new Date(today.getTime() - 86400000).toISOString();
  const ratios = [
    [4, 3],
    [1, 1],
    [3, 4],
    [16, 9],
    [1, 1],
    [4, 3],
    [3, 2],
    [1, 1],
    [16, 9],
    [3, 4],
    [4, 3],
    [1, 1],
  ];
  const prompt =
    "极简护肤品产品图：白色圆柱瓶、浅灰背景、柔和侧光。保持主体完整，使用横向构图。";
  const assets: ImageAsset[] = ratios.map(([w, h], index) => {
    const label = `图片 ${String(index + 1).padStart(2, "0")}`;
    return {
      id: `image-${index + 1}`,
      userId: "admin",
      name: `${label}.svg`,
      url: placeholderImage(label, w * 192, h * 192),
      width: w * 192,
      height: h * 192,
      createdAt: index < 8 ? date : yesterday,
      batchId: index < 2 ? "seed-request" : "history-" + index,
      outputIndex: index,
      prompt,
      options: { ...DEFAULT_OPTIONS, ratio: `${w}:${h}` },
      folderIds: [
        ...(index < 6 ? ["inspiration"] : []),
        ...([0, 1, 4, 6].includes(index) ? ["poster"] : []),
      ],
    };
  });
  return {
    version: 1,
    assets,
    folders: [
      { id: "inspiration", userId: "admin", name: "项目灵感", createdAt: date },
      { id: "poster", userId: "admin", name: "海报探索", createdAt: date },
      { id: "pending", userId: "admin", name: "待整理", createdAt: date },
    ],
    generations: [
      {
        id: "seed-request",
        userId: "admin",
        username: "admin",
        prompt,
        attachments: [],
        options: DEFAULT_OPTIONS,
        status: "completed",
        imageIds: ["image-1", "image-2"],
        outputs: [0, 1].map(outputIndex => ({ outputIndex, status: "succeeded" as const, startedAt: new Date(today.getTime() - 12800).toISOString(), finishedAt: date })),
        createdAt: new Date(today.getTime() - 12800).toISOString(),
        completedAt: date,
        durationMs: 12800,
        cost: 6,
      },
      {
        id: "failed-request",
        userId: "user1",
        username: "user1",
        prompt: "一张安静的海边照片",
        attachments: [],
        options: { ...DEFAULT_OPTIONS, count: 1 },
        status: "failed",
        imageIds: [],
        outputs: [{ outputIndex: 0, status: "failed", startedAt: new Date(today.getTime() - 1000).toISOString(), finishedAt: date }],
        createdAt: new Date(today.getTime() - 1000).toISOString(),
        completedAt: date,
        cost: 0,
        error: "生成服务暂时不可用，请稍后重试。",
      },
    ],
    users: [
      {
        id: "admin",
        username: "admin",
        role: "admin",
        status: "enabled",
        balance: 991,
        createdAt: "2026-11-03T08:00:00.000Z",
      },
      {
        id: "user1",
        username: "user1",
        role: "user",
        status: "enabled",
        balance: 200,
        createdAt: "2026-11-04T08:00:00.000Z",
      },
      {
        id: "user2",
        username: "user2",
        role: "user",
        status: "disabled",
        balance: 0,
        createdAt: "2026-11-05T08:00:00.000Z",
      },
    ],
    currentUserId: "",
    prices: Object.fromEntries(
      MODELS.map((m, i) => [m.id, [2, 2, 3, 1, 1][i]]),
    ) as StudioData["prices"],
    priceUpdatedAt: {},
    preferences: { theme: "light", enterToSend: false },
  };
}
