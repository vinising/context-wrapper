import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "os";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";
import { createRuntimeGenerator } from "./runtime-generator.js";

describe("agent brief integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds and records agent briefs with mocked Ollama structured JSON", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-brief-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Build task-scoped briefs"
      });

      // Mock fetch to reject so indexing runs in fallback lexical mode instantly without real network hits
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("Ollama connection refused for indexer mock"));

      // Write a file to index
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src/foo.ts"), "export function hello() { return 'world'; } // foo.ts tests");

      // Build index in lexical fallback mode
      await store.ensurePolicy();
      const policy = await store.readPolicy();
      policy.autonomous.briefMode = "llm";
      const { writeYaml } = await import("@wrapper/context-store");
      // Since writeYaml is not exported, we can just write it using YAML string or JSON
      await writeFile(join(workspace, ".wrapper/policy.yaml"), JSON.stringify(policy), "utf8");

      const manifest = await store.paths.root; // Just to make sure store is ready

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async () => { throw new Error("not used"); },
          assessOnly: async () => { throw new Error("not used"); },
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/foo.ts"],
            outOfScope: ["tests/"],
            constraints: ["Use TypeScript"],
            acceptanceCriteria: ["npm test passes"],
            verificationSteps: ["Run test"],
            firstStep: "Review src/foo.ts",
            briefMarkdown: `# Task Brief: ${task}\n\n## Goal\n${task}`,
            scoringMethod: "llm"
          })
        }
      });

      // Index the workspace first
      await tools.indexWorkspace();

      const brief = await tools.buildAgentBrief({
        task: "Add tests for foo.ts",
        intent: "implementation"
      });

      expect(brief.task).toBe("Add tests for foo.ts");
      expect(brief.briefPath).toBeDefined();
      expect(brief.retrievalHits.length).toBeGreaterThanOrEqual(1);
      expect(brief.retrievalHits.some(h => h.path === "src/foo.ts")).toBe(true);
      expect(brief.verificationSteps).toEqual(["Run test"]);

      const fileContent = await readFile(brief.briefPath!, "utf8");
      expect(fileContent).toContain("# Task Brief: Add tests for foo.ts");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("falls back to heuristic brief generation when LLM fails or is offline", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-brief-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Build task-scoped briefs"
      });

      // Mock fetch to reject so LLM fails
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("Ollama connection refused"));

      // Create runtime generator with default settings (will fallback to heuristic)
      const runtime = createRuntimeGenerator();
      const tools = createWrapperTools({
        store,
        runtime
      });

      const brief = await tools.buildAgentBrief({
        task: "Implement semantic index",
        intent: "implementation"
      });

      expect(brief.task).toBe("Implement semantic index");
      expect(brief.briefPath).toBeDefined();
      expect(brief.briefMarkdown).toContain("# Task Brief: Implement semantic index");
      expect(brief.verificationSteps).toEqual(["Run test suite or compile checks"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
