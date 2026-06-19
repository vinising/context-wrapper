import { describe, expect, it, vi } from "vitest";
import { createRuntimeGenerator } from "./runtime-generator.js";

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

describe("runtime generator llm assessment", () => {
  it("uses local model JSON for scoring and refinement", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          score: 88,
          missingContext: [],
          recommendedQuestions: [],
          refinedPrompt: "Implement LLM-based prompt scoring with acceptance tests.",
          readyForImplementation: true
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createRuntimeGenerator({ mode: "ollama" });
    const result = await runtime.assessAndRefine({
      handoff,
      prompt: "add llm scoring",
      intent: "implementation"
    });

    expect(result.scoringMethod).toBe("llm");
    expect(result.score).toBe(88);
    expect(result.refinedPrompt).toContain("acceptance tests");
    const generateCall = fetchMock.mock.calls.find(call => typeof call[0] === "string" && call[0].endsWith("/api/generate"));
    expect(generateCall?.[1]?.body).toContain('"format":"json"');
    vi.unstubAllGlobals();
  });

  it("scores without rewriting the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          score: 41,
          missingContext: ["goal", "success criteria"],
          recommendedQuestions: ["What outcome matters?"],
          readyForImplementation: false
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createRuntimeGenerator({ mode: "ollama" });
    const result = await runtime.assessOnly({
      handoff,
      prompt: "fix the bug",
      intent: "debugging"
    });

    expect(result.scoringMethod).toBe("llm");
    expect(result.refinedPrompt).toBe("fix the bug");
    expect(result.score).toBe(41);
    vi.unstubAllGlobals();
  });
});
