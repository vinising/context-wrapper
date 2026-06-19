import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OLLAMA_NUM_CTX,
  enforceOllamaContextWindow,
  estimateMaxVramBytes,
  parseOllamaNumCtx
} from "./ollama-context.js";

describe("ollama context enforcement", () => {
  it("defaults num_ctx to 64k", () => {
    expect(DEFAULT_OLLAMA_NUM_CTX).toBe(65536);
    expect(parseOllamaNumCtx(undefined)).toBe(65536);
    expect(parseOllamaNumCtx("65536")).toBe(65536);
  });

  it("estimates tighter VRAM for 64k than 262k contexts", () => {
    const at64k = estimateMaxVramBytes(65536);
    const at262k = estimateMaxVramBytes(262144);
    expect(at64k).toBeLessThan(at262k);
    expect(at64k).toBeLessThan(11e9);
    expect(at262k).toBeGreaterThan(12e9);
  });

  it("unloads when loaded model VRAM exceeds configured num_ctx budget", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "gemma4:12b-mlx", size_vram: 13_700_000_000, context_length: 262144 }]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    vi.stubGlobal("fetch", fetchMock);

    const result = await enforceOllamaContextWindow({
      host: "http://127.0.0.1:11434",
      model: "gemma4:12b-mlx",
      numCtx: 65536
    });

    expect(result.unloaded).toBe(true);
    expect(result.previousContextLength).toBe(262144);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain("\"keep_alive\":0");

    vi.unstubAllGlobals();
  });

  it("keeps loaded model when VRAM fits configured num_ctx", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "gemma4:12b-mlx", size_vram: 6_800_000_000, context_length: 262144 }]
      })
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await enforceOllamaContextWindow({
      host: "http://127.0.0.1:11434",
      model: "gemma4:12b-mlx",
      numCtx: 65536
    });

    expect(result.unloaded).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
