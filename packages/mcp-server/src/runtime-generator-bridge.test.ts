import { describe, expect, it } from "vitest";
import { createRuntimeGenerator } from "./runtime-generator.js";

describe("runtime generator bridge behavior", () => {
  it("falls back safely when bridge command is invalid", async () => {
    process.env.WRAPPER_MLX_COMMAND_JSON = JSON.stringify(["python3", "does-not-exist.py"]);
    const generator = createRuntimeGenerator({ mode: "bridge" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "ship this"
    });

    expect(output).toContain("Fallback mode active");
    expect(output).toContain("Bridge error:");
    delete process.env.WRAPPER_MLX_COMMAND_JSON;
  });
});
