import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createContextStore } from "./index.js";

describe("context store", () => {
  it("initializes the segregated .wrapper folder with validated documents", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-store-"));
    try {
      const store = createContextStore(workspace);

      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Refine prompts with a local sidecar"
      });

      const handoff = await store.readHandoff();
      const policy = await store.readPolicy();

      expect(handoff.project.name).toBe("Wrapper");
      expect(handoff.activeContext.nextSteps).toContain("Run prompt refinement");
      expect(policy.privacy.redactSecrets).toBe(true);
      await expect(readFile(join(workspace, ".wrapper/context/handoff.md"), "utf8")).resolves.toContain(
        "# Context Handoff"
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("updates handoff context and appends accepted decisions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-store-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Refine prompts with a local sidecar"
      });

      await store.updateHandoff({
        summary: "MCP prototype is underway",
        currentFocus: "Expose local refinement tools",
        constraints: ["Do not log raw secrets"],
        nextSteps: ["Implement MCP tools"]
      });
      await store.addDecision({
        title: "Keep runs out of git",
        rationale: "Prompt scores may contain user-specific metadata"
      });

      expect((await store.readHandoff()).activeContext.currentFocus).toBe("Expose local refinement tools");
      expect((await store.readDecisions()).decisions[0]?.status).toBe("accepted");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("records prompt outputs as timestamped markdown and prunes to policy max entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-store-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Refine prompts with a local sidecar"
      });

      const first = await store.recordPromptResult({
        version: 1,
        prompt: "First prompt",
        score: 40,
        missingContext: ["constraints"],
        recommendedQuestions: ["Which constraints apply?"],
        refinedPrompt: "First refined prompt",
        createdAt: "2026-06-15T10:00:00.000Z"
      }, 2);
      const second = await store.recordPromptResult({
        version: 1,
        prompt: "Second prompt",
        score: 80,
        missingContext: [],
        recommendedQuestions: [],
        refinedPrompt: "Second refined prompt",
        createdAt: "2026-06-15T10:01:00.000Z"
      }, 2);
      const third = await store.recordPromptResult({
        version: 1,
        prompt: "Third prompt",
        score: 90,
        missingContext: [],
        recommendedQuestions: [],
        refinedPrompt: "Third refined prompt",
        createdAt: "2026-06-15T10:02:00.000Z"
      }, 2);

      expect(await store.listPromptHistory()).toEqual([second, third]);
      await expect(readFile(first, "utf8")).rejects.toThrow();
      await expect(readFile(third, "utf8")).resolves.toContain("Third refined prompt");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("records agent briefs and prunes to policy max entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-store-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Refine prompts with a local sidecar"
      });

      const first = await store.recordAgentBrief({
        version: 1,
        task: "First task",
        intent: "implementation",
        briefMarkdown: "First brief",
        inScope: ["src/index.ts"],
        outOfScope: [],
        acceptanceCriteria: ["npm test"],
        retrievalHits: [],
        createdAt: "2026-06-15T10:00:00.000Z"
      }, 2);
      const second = await store.recordAgentBrief({
        version: 1,
        task: "Second task",
        intent: "implementation",
        briefMarkdown: "Second brief",
        inScope: ["src/index.ts"],
        outOfScope: [],
        acceptanceCriteria: ["npm test"],
        retrievalHits: [],
        createdAt: "2026-06-15T10:01:00.000Z"
      }, 2);
      const third = await store.recordAgentBrief({
        version: 1,
        task: "Third task",
        intent: "implementation",
        briefMarkdown: "Third brief",
        inScope: ["src/index.ts"],
        outOfScope: [],
        acceptanceCriteria: ["npm test"],
        retrievalHits: [],
        createdAt: "2026-06-15T10:02:00.000Z"
      }, 2);

      expect(await store.listAgentBriefHistory()).toEqual([second, third]);
      await expect(readFile(first, "utf8")).rejects.toThrow();
      await expect(readFile(third, "utf8")).resolves.toContain("Third brief");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
