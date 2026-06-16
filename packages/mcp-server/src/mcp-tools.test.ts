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
});
