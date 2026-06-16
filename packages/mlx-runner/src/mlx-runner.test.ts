import { describe, expect, it } from "vitest";
import { createMlxRunner } from "./index.js";

describe("MLX runner", () => {
  it("uses an injected generator to produce structured local model output", async () => {
    const runner = createMlxRunner({
      modelId: "mlx-community/gemma-3-4b-it-4bit",
      generate: async ({ system, prompt }) => `${system}\n${prompt}\nrefined`
    });

    await expect(
      runner.generate({
        system: "Refine rough prompts.",
        prompt: "make app better"
      })
    ).resolves.toContain("refined");
  });
});
