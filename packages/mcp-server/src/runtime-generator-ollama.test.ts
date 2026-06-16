import { describe, expect, it, vi } from "vitest";
import { createRuntimeGenerator } from "./runtime-generator.js";

describe("runtime generator ollama mode", () => {
  it("returns ollama text on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "Refined with Gemma 4 via Ollama." })
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = createRuntimeGenerator({ mode: "ollama" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "build wrapper"
    });

    expect(output).toContain("Gemma 4");
    vi.unstubAllGlobals();
  });

  it("falls back safely when ollama request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const generator = createRuntimeGenerator({ mode: "ollama" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "build wrapper"
    });

    expect(output).toContain("Fallback mode active");
    expect(output).toContain("Ollama error:");
    vi.unstubAllGlobals();
  });
});
