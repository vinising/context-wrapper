import { describe, expect, it, vi } from "vitest";
import { createRuntimeGenerator } from "./runtime-generator.js";

describe("runtime generator ollama mode", () => {
  it("returns ollama text on success", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/ps")) {
        return {
          ok: true,
          json: async () => ({ models: [] })
        };
      }
      return {
        ok: true,
        json: async () => ({ response: "Refined with Gemma 4 via Ollama." })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = createRuntimeGenerator({ mode: "ollama" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "build wrapper"
    });

    expect(output).toContain("Gemma 4");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"num_ctx\":65536")
      })
    );
    vi.unstubAllGlobals();
  });

  it("falls back safely when ollama request fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/ps")) {
        return {
          ok: true,
          json: async () => ({ models: [] })
        };
      }
      if (url.endsWith("/api/tags")) {
        throw new Error("connect ECONNREFUSED");
      }
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = createRuntimeGenerator({ mode: "ollama" });
    const output = await generator.generate({
      system: "Refine prompts",
      prompt: "build wrapper"
    });

    expect(output).toContain("Fallback mode active");
    expect(output).toContain("OLLAMA OFFLINE WARNING");
    vi.unstubAllGlobals();
  });

  it("triggers cloud fallback or busy message when concurrent requests occur", async () => {
    let resolveFirstCall: (value: any) => void = () => {};
    const firstCallPromise = new Promise((resolve) => {
      resolveFirstCall = resolve;
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/ps")) {
        return {
          ok: true,
          json: async () => ({ models: [] })
        };
      }
      if (url.endsWith("/api/generate")) {
        await firstCallPromise;
        return {
          ok: true,
          json: async () => ({ response: "First call response" })
        };
      }
      return {
        ok: true,
        json: async () => ({})
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = createRuntimeGenerator({ mode: "ollama" });

    // Start first call (will block until resolveFirstCall is called)
    const p1 = generator.generate({
      system: "Refine prompts",
      prompt: "first"
    });

    // Start second call (should immediately hit mutex and return busy fallback since no cloud key is set)
    const p2 = generator.generate({
      system: "Refine prompts",
      prompt: "second"
    });

    const output2 = await p2;
    expect(output2).toContain("[OLLAMA_BUSY_FALLBACK]");

    // Resolve first call
    resolveFirstCall({ response: "First call response" });
    const output1 = await p1;
    expect(output1).toBe("First call response");

    vi.unstubAllGlobals();
  });
});
