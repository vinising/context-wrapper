import { cpus, totalmem } from "node:os";
import { DetectedMachine, ModelProfile, ModelProfileSchema } from "@wrapper/schemas";

export type ModelTier = ModelProfile["selectedTier"];

const modelByTier: Record<ModelTier, string> = {
  base: "mlx-community/gemma-3-1b-it-4bit",
  standard: "mlx-community/gemma-3-4b-it-4bit",
  pro: "mlx-community/gemma-3-12b-it-4bit",
  fallback: "external-runtime-required"
};

export function detectMachine(): DetectedMachine {
  return {
    platform: process.platform,
    arch: process.arch,
    memoryGb: Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024)),
    cpuBrand: cpus()[0]?.model ?? "Unknown CPU"
  };
}

export function recommendModelProfile(detected: DetectedMachine = detectMachine()): ModelProfile {
  const selectedTier = selectTier(detected);
  return ModelProfileSchema.parse({
    version: 1,
    detected,
    selectedTier,
    modelId: modelByTier[selectedTier],
    reason: recommendationReason(detected, selectedTier)
  });
}

function selectTier(detected: DetectedMachine): ModelTier {
  if (detected.platform !== "darwin" || detected.arch !== "arm64") {
    return "fallback";
  }

  if (detected.memoryGb >= 32) {
    return "pro";
  }

  if (detected.memoryGb >= 16) {
    return "standard";
  }

  return "base";
}

function recommendationReason(detected: DetectedMachine, tier: ModelTier): string {
  if (tier === "fallback") {
    return "MLX acceleration requires Apple Silicon; use an external runtime adapter on this machine.";
  }

  return `${detected.memoryGb} GB Apple Silicon machine fits the ${tier} local refinement tier.`;
}
