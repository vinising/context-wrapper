import { describe, expect, it } from "vitest";
import {
  assessPromptHeuristically,
  LlmRefinementResponseSchema,
  parseModelJson,
  toRefinementAssessment
} from "./prompt-assessment.js";

const handoff = {
  version: 1 as const,
  updatedAt: "2026-06-15T14:30:00.000Z",
  project: {
    name: "Wrapper",
    goal: "Refine prompts"
  },
  activeContext: {
    summary: "Sidecar prototype",
    currentFocus: "Prompt scoring",
    constraints: ["Local runtime only"],
    nextSteps: ["Ship LLM scoring"]
  },
  signals: {
    confidence: 0.8,
    staleAfterMinutes: 45
  }
};

describe("prompt assessment", () => {
  it("parses JSON returned by the local model", () => {
    const parsed = parseModelJson(
      JSON.stringify({
        score: 82,
        missingContext: ["verification steps"],
        recommendedQuestions: ["How should we verify this change?"],
        refinedPrompt: "Implement LLM-based prompt scoring with tests.",
        readyForImplementation: true
      }),
      LlmRefinementResponseSchema
    );

    expect(toRefinementAssessment(parsed).scoringMethod).toBe("llm");
    expect(toRefinementAssessment(parsed).score).toBe(82);
  });

  it("extracts JSON from fenced model output", () => {
    const parsed = parseModelJson(
      "```json\n{\"score\":55,\"missingContext\":[\"goal\"],\"recommendedQuestions\":[\"Why?\"],\"refinedPrompt\":\"Do X\",\"readyForImplementation\":false}\n```",
      LlmRefinementResponseSchema
    );

    expect(parsed.score).toBe(55);
  });

  it("keeps heuristic scoring as fallback metadata", () => {
    const result = assessPromptHeuristically({
      handoff,
      prompt: "build it",
      intent: "implementation"
    });

    expect(result.scoringMethod).toBe("heuristic");
    expect(result.score).toBeLessThan(20);
    expect(result.missingContext.length).toBeGreaterThan(0);
  });
});
