import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";

describe("wrapper MCP tools", () => {
  it("refines rough prompts with context and recommended questions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 35,
            missingContext: ["goal", "success criteria", "constraints", "detail"],
            recommendedQuestions: ["What outcome should the working model optimize for?"],
            refinedPrompt: `Refined: ${prompt}\nAcceptance criteria: clear and testable.`,
            scoringMethod: "heuristic" as const,
            readyForImplementation: false
          }),
          assessOnly: async ({ prompt }) => ({
            score: 35,
            missingContext: ["goal"],
            recommendedQuestions: ["What outcome should the working model optimize for?"],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: false
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "heuristic" as const
          })
        }
      });

      const result = await tools.refinePrompt({
        prompt: "build it",
        intent: "implementation"
      });

      expect(result.refinedPrompt).toContain("Acceptance criteria");
      expect(result.historyPath).toContain(".wrapper/prompts/");
      expect(result.recommendedQuestions.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(80);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("updates and returns the context handoff", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      await tools.updateContextHandoff({
        summary: "User chose Cursor-native sidecar",
        currentFocus: "MCP tool prototype",
        constraints: ["No unsupported prompt rewriting"],
        nextSteps: ["Package Cursor plugin"]
      });

      expect((await tools.getContextHandoff()).activeContext.currentFocus).toBe("MCP tool prototype");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("orchestrates step-by-step hybrid execution with localDraftPlan and localExecuteMilestone", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      // 1. Run tools.localDraftPlan with mock input task: "Implement SafeEmitter", forceTier: "tier1_local"
      const plan = await tools.localDraftPlan({
        task: "Implement SafeEmitter",
        forceTier: "tier1_local"
      });

      // Assert that the returned plan status is pending or in_progress initially and has pending milestones
      expect(["pending", "in_progress"]).toContain(plan.status);
      expect(plan.milestones.length).toBeGreaterThan(0);
      expect(plan.milestones[0].status).toBe("pending");

      // Verify that reading the active plan from the store returns the drafted plan correctly
      const savedPlan = await store.readActivePlan();
      expect(savedPlan).not.toBeNull();
      expect(savedPlan?.taskId).toBe(plan.taskId);
      expect(savedPlan?.taskDescription).toBe("Implement SafeEmitter");

      // Call tools.localExecuteMilestone for the first milestone, passing correct taskId, milestoneId, and an optional context string
      const firstMilestone = plan.milestones[0];
      const result = await tools.localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: firstMilestone.id,
        context: "Optional context string"
      });

      // Assert that the execution succeeds and returns a success status of completed for that specific milestone
      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");

      // Verify that reading the active plan shows that the milestone's status was set to completed and that the overall plan is updated accordingly
      const updatedPlan = await store.readActivePlan();
      expect(updatedPlan).not.toBeNull();
      const updatedMilestone = updatedPlan?.milestones.find((m) => m.id === firstMilestone.id);
      expect(updatedMilestone?.status).toBe("completed");
      expect(updatedPlan?.status).toBe("in_progress");

      // Verify that the context handoff was updated with the summary of the completed task
      const handoff = await store.readHandoff();
      expect(handoff.activeContext.summary).toContain("Successfully completed sub-task: Scaffold and Setup");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
