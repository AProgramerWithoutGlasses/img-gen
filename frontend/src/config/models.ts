import type { GenerationOptions, ModelConfig } from "../types";

const gptRatios = ["自动", "1:1", "1:1 HD", "3:4", "9:16", "4:3", "16:9"];
const geminiRatios = [
  "自动",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
];
export let MODELS: ModelConfig[] = [
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    qualities: ["高", "中", "低"],
    resolutions: ["1K", "2K", "3K", "4K"],
    ratios: gptRatios,
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    qualities: ["高", "中", "低"],
    resolutions: [],
    ratios: ["1:1", "3:2", "2:3"],
  },
  {
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    qualities: ["自动", "最高", "超高", "高", "中", "低"],
    resolutions: ["1K", "2K", "3K", "4K"],
    ratios: gptRatios,
  },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash Image",
    qualities: [],
    resolutions: ["0.5K", "1K", "2K", "4K"],
    ratios: geminiRatios,
  },
  {
    id: "gemini-3-pro-image",
    name: "Gemini 3 Pro Image",
    qualities: [],
    resolutions: ["1K", "2K", "4K"],
    ratios: geminiRatios,
  },
];
export const DEFAULT_OPTIONS: GenerationOptions = {
  modelId: "gpt-image-2.5-sunburst",
  quality: "高",
  resolution: "1K",
  ratio: "4:3",
  count: 2,
};
export function setModels(models: ModelConfig[]) {
  if (!models.length) throw new Error("服务端未提供可用模型");
  MODELS = models;
}
export function normalizeOptions(
  options: GenerationOptions,
): GenerationOptions {
  const model = MODELS.find((m) => m.id === options.modelId) ?? MODELS[0];
  return {
    modelId: model.id,
    count: Math.max(1, Math.min(4, Math.trunc(options.count) || 1)),
    ratio: model.ratios.includes(options.ratio)
      ? options.ratio
      : model.ratios[0],
    quality: model.qualities.includes(options.quality ?? "")
      ? options.quality
      : model.qualities[0],
    resolution: model.resolutions.includes(options.resolution ?? "")
      ? options.resolution
      : model.resolutions[0],
  };
}
