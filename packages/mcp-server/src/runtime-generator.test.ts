import { describe, expect, it } from "vitest";
import { createRuntimeGenerator } from "./runtime-generator.js";

describe("createRuntimeGenerator", () => {
  it("uses deterministic fallback when no command bridge is configured", async () => {
    const generator = createRuntimeGenerator({ mode: "fallback" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "build app quickly"
    });

    expect(output).toContain("Refined prompt:");
    expect(output).toContain("Model recommendation:");
  });
});
