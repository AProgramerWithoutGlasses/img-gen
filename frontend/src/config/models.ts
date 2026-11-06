import type { GenerationOptions, ModelConfig } from "../types";

// GPT ratios are prompt guidance; this channel does not honor size/quality fields.
const gptRatios = ["自动", "1:1", "16:9", "9:16", "3:2"];
const geminiRatios = [
  "自动",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "9:16",
];
export let MODELS: ModelConfig[] = [
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    qualities: [],
    resolutions: [],
    ratios: gptRatios,
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    qualities: [],
    resolutions: [],
    ratios: gptRatios,
  },
  {
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    qualities: [],
    resolutions: [],
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
    resolutions: ["0.5K", "1K", "2K", "4K"],
    ratios: ["自动", "1:1", "9:16", "16:9"],
  },
];
export const DEFAULT_OPTIONS: GenerationOptions = {
  modelId: "gpt-image-2.5-sunburst",
  ratio: "自动",
  count: 2,
};
export function setModels(models: ModelConfig[]) {
  if (!models.length) throw new Error("服务端未提供可用模型");
  MODELS = models;
}
export function normalizeOptions(
  options: GenerationOptions,
  editing = false,
): GenerationOptions {
  const model = MODELS.find((m) => m.id === options.modelId) ?? MODELS[0];
  return {
    modelId: model.id,
    count: Math.max(1, Math.min(4, Math.trunc(options.count) || 1)),
    ratio: !editing && model.ratios.includes(options.ratio)
      ? options.ratio
      : model.ratios[0],
    quality: !editing && model.qualities.includes(options.quality ?? "")
      ? options.quality
      : editing ? undefined : model.qualities[0],
    resolution: !editing && model.resolutions.includes(options.resolution ?? "")
      ? options.resolution
      : editing ? undefined : model.resolutions.includes("1K") ? "1K" : model.resolutions[0],
  };
}
