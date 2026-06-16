import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "os";
import { describe, expect, it, vi, afterEach } from "vitest";
import { WorkspacePolicy } from "@wrapper/schemas";
import {
  indexWorkspace,
  retrieveContext,
  calculateLexicalScore
} from "./index.js";
import { cosineSimilarity } from "./embeddings.js";

const mockPolicy: WorkspacePolicy = {
  version: 1,
  indexing: {
    enabled: true,
    include: ["**/*"],
    exclude: [".env", "node_modules/**", ".git/**", ".wrapper/index/**"],
    embedModel: "nomic-embed-text",
    maxFileBytes: 10000,
    maxFiles: 10,
    chunkCharSize: 100,
    retrievalTopK: 2
  },
  privacy: {
    allowPromptLogs: false,
    redactSecrets: true
  },
  promptHistory: {
    enabled: true,
    directory: ".wrapper/prompts",
    maxEntries: 5
  },
  agentBrief: {
    enabled: true,
    directory: ".wrapper/runs",
    maxEntries: 5
  },
  autonomous: {
    interactiveApproval: true,
    maxTaskTurns: 5,
    maxFilesModified: 10,
    forcedTier: "auto",
    autoValidate: true,
    autoRollbackOnFailure: false
  }
};

describe("semantic index", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates cosine similarity correctly", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it("calculates lexical score based on token overlap", () => {
    const chunk = "The quick brown fox jumps over the lazy dog";
    expect(calculateLexicalScore(chunk, "quick fox")).toBeGreaterThan(0);
    expect(calculateLexicalScore(chunk, "cat")).toBe(0);
  });

  it("indexes workspace and retrieves context in lexical fallback mode", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-index-"));
    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src/foo.txt"), "hello world\nthis is a test file for indexing");
      await writeFile(join(workspace, "src/bar.txt"), "another text file with different words");

      // Mock fetch to fail so we fall back to lexical mode
      const globalFetch = vi.spyOn(global, "fetch").mockRejectedValue(new Error("Ollama offline"));

      const manifest = await indexWorkspace(workspace, mockPolicy);

      expect(manifest.mode).toBe("lexical");
      expect(manifest.fileCount).toBe(2);
      expect(manifest.chunkCount).toBe(2);

      const hits = await retrieveContext(workspace, "test file", 1);
      expect(hits.length).toBe(1);
      expect(hits[0]?.path).toBe("src/foo.txt");
      expect(hits[0]?.text).toContain("test file");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("indexes workspace and retrieves context in semantic mode when Ollama is online", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-index-"));
    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src/foo.txt"), "hello world\nthis is a test file for indexing");

      // Mock fetch to succeed with a dummy embedding
      const globalFetch = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] })
      } as Response);

      const manifest = await indexWorkspace(workspace, mockPolicy);

      expect(manifest.mode).toBe("semantic");
      expect(manifest.fileCount).toBe(1);

      const hits = await retrieveContext(workspace, "hello", 1);
      expect(hits.length).toBe(1);
      expect(hits[0]?.path).toBe("src/foo.txt");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
