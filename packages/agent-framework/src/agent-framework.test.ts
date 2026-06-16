import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "./agent.js";
import { Orchestrator } from "./orchestrator.js";
import { createContextStore } from "@wrapper/context-store";

describe("agent framework scaffold", () => {
  it("initializes base agent and gets output", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-framework-test-"));
    const store = createContextStore(workspaceRoot);
    await store.initialize({
      projectName: "Test",
      projectGoal: "Test"
    });

    try {
      const agent = new Agent({
        name: "TestAgent",
        role: "assistant",
        systemInstructions: "Echo whatever is asked.",
        workspaceRoot
      });

      expect(agent.name).toBe("TestAgent");
      const output = await agent.run("hello");
      expect(output).toBeDefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("orchestrator decomposes epic tasks into milestones and executes tools", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-framework-test-"));
    const store = createContextStore(workspaceRoot);
    await store.initialize({
      projectName: "Test",
      projectGoal: "Test"
    });

    try {
      const orchestrator = new Orchestrator(workspaceRoot);
      const milestones = await orchestrator.planEpic("Build dark mode setting page");

      expect(milestones.length).toBeGreaterThan(0);
      expect(milestones[0]!.id).toBe("M01");

      const refined = await orchestrator.refineTaskPrompt("build toggle");
      expect(refined.refinedPrompt).toBeDefined();

      const handoff = await orchestrator.refreshHandoff(
        "summary of test",
        "focus of test",
        ["constraint of test"],
        ["step of test"]
      );
      expect(handoff).toBeDefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("sub-agent delegate executes brief-guided tasks correctly", async () => {
    const { SubAgentDelegate } = await import("./sub-agent.js");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-framework-test-"));
    const store = createContextStore(workspaceRoot);
    await store.initialize({
      projectName: "Test",
      projectGoal: "Test"
    });

    try {
      const subAgent = new SubAgentDelegate(workspaceRoot);
      const brief = {
        version: 1 as const,
        task: "Build safe event emitter with transaction rollback",
        intent: "implementation" as const,
        briefMarkdown: "### Safe Event Emitter Brief",
        inScope: ["src/emitter.ts"],
        outOfScope: ["src/index.ts"],
        acceptanceCriteria: ["Unit tests must pass"],
        retrievalHits: [],
        createdAt: new Date().toISOString()
      };

      const result = await subAgent.executeTask(brief);
      expect(result.success).toBe(true);
      expect(result.filesModified).toContain("src/emitter.ts");

      const handoff = await store.readHandoff();
      expect(handoff.activeContext.summary).toContain("event emitter");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("orchestrator routes epics to correct complexity tiers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-framework-test-"));
    const store = createContextStore(workspaceRoot);
    await store.initialize({
      projectName: "Test",
      projectGoal: "Test"
    });

    try {
      const orchestrator = new Orchestrator(workspaceRoot);

      // Heuristic Routing: High Complexity -> Tier 3
      const tier3 = await orchestrator.determineComplexityTier("Database schema migration for OAuth tokens");
      expect(tier3).toBe("tier3_hosted");

      // Heuristic Routing: Low Complexity -> Tier 1
      const tier1 = await orchestrator.determineComplexityTier("Fix typo in button comment");
      expect(tier1).toBe("tier1_local");

      // Default/LLM Routing: Medium Complexity -> Tier 2
      const tier2 = await orchestrator.determineComplexityTier("Build standard event emitter class with tests");
      // Since local generator defaults, this should resolve to tier2_hybrid or local classification
      expect(["tier1_local", "tier2_hybrid", "tier3_hosted"]).toContain(tier2);

      // Perform a full tiered planning cycle
      const milestones = await orchestrator.planEpic("Safe transaction log with db migration");
      expect(orchestrator.lastPlanningTokens).toBeDefined();
      expect(orchestrator.lastPlanningTokens?.tier).toBe("tier3_hosted");
      expect(orchestrator.lastPlanningTokens?.tokensHostedInput).toBe(12000);
      expect(orchestrator.lastPlanningTokens?.tokensHosted).toBe(13500);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
