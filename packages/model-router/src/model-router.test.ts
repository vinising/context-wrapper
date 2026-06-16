import { describe, expect, it } from "vitest";
import { recommendModelProfile } from "./index.js";

describe("model router", () => {
  it("recommends an MLX base tier for smaller Apple Silicon MacBooks", () => {
    const profile = recommendModelProfile({
      platform: "darwin",
      arch: "arm64",
      memoryGb: 8,
      cpuBrand: "Apple M1"
    });

    expect(profile.selectedTier).toBe("base");
    expect(profile.modelId).toContain("mlx-community");
  });

  it("recommends a standard tier for 16 GB Apple Silicon MacBooks", () => {
    const profile = recommendModelProfile({
      platform: "darwin",
      arch: "arm64",
      memoryGb: 16,
      cpuBrand: "Apple M3"
    });

    expect(profile.selectedTier).toBe("standard");
    expect(profile.reason).toContain("16 GB");
  });

  it("recommends a pro tier when memory supports a larger local model", () => {
    const profile = recommendModelProfile({
      platform: "darwin",
      arch: "arm64",
      memoryGb: 64,
      cpuBrand: "Apple M3 Max"
    });

    expect(profile.selectedTier).toBe("pro");
  });

  it("falls back to external runtime guidance for unsupported machines", () => {
    const profile = recommendModelProfile({
      platform: "linux",
      arch: "x64",
      memoryGb: 32,
      cpuBrand: "Generic"
    });

    expect(profile.selectedTier).toBe("fallback");
    expect(profile.reason).toContain("Apple Silicon");
  });
});
