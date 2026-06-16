import { describe, expect, it } from "vitest";
import {
  ContextHandoffSchema,
  DecisionLogSchema,
  ModelProfileSchema,
  PromptQualitySchema,
  WorkspacePolicySchema,
  IndexManifestSchema,
  AgentBriefSchema
} from "./index.js";

describe("wrapper schemas", () => {
  it("validates the core YAML-backed documents used by the sidecar", () => {
    expect(
      ContextHandoffSchema.parse({
        version: 1,
        updatedAt: "2026-06-15T14:30:00.000Z",
        project: {
          name: "Wrapper",
          goal: "Refine prompts and maintain context handoff"
        },
        activeContext: {
          summary: "Greenfield Cursor-native sidecar",
          currentFocus: "Scaffold local context wrapper",
          constraints: ["Cursor main model remains hosted"],
          nextSteps: ["Implement schemas"]
        },
        signals: {
          confidence: 0.82,
          staleAfterMinutes: 45
        }
      }).activeContext.nextSteps
    ).toEqual(["Implement schemas"]);

    expect(
      DecisionLogSchema.parse({
        version: 1,
        decisions: [
          {
            id: "dec-001",
            madeAt: "2026-06-15T14:30:00.000Z",
            title: "Use MLX first",
            rationale: "Optimize for Apple Silicon MacBooks",
            status: "accepted"
          }
        ]
      }).decisions[0]?.status
    ).toBe("accepted");

    expect(
      PromptQualitySchema.parse({
        version: 1,
        prompt: "Build the sidecar",
        score: 78,
        missingContext: ["target runtime"],
        recommendedQuestions: ["Which runtime should v1 use?"],
        refinedPrompt: "Build a Cursor-native local sidecar...",
        createdAt: "2026-06-15T14:30:00.000Z"
      }).score
    ).toBe(78);

    expect(
      ModelProfileSchema.parse({
        version: 1,
        detected: {
          platform: "darwin",
          arch: "arm64",
          memoryGb: 16,
          cpuBrand: "Apple M3"
        },
        selectedTier: "standard",
        modelId: "mlx-community/gemma-3-4b-it-4bit",
        reason: "16 GB Apple Silicon machine"
      }).selectedTier
    ).toBe("standard");

    expect(
      WorkspacePolicySchema.parse({
        version: 1,
        indexing: {
          enabled: true,
          include: ["src/**"],
          exclude: [".env", "node_modules/**"]
        },
        privacy: {
          allowPromptLogs: false,
          redactSecrets: true
        },
        promptHistory: {
          enabled: true,
          directory: ".wrapper/prompts",
          maxEntries: 20
        }
      }).privacy.redactSecrets
    ).toBe(true);
    expect(
      WorkspacePolicySchema.parse({
        version: 1,
        indexing: {
          enabled: true,
          include: ["src/**"],
          exclude: [".env", "node_modules/**"]
        },
        privacy: {
          allowPromptLogs: false,
          redactSecrets: true
        },
        promptHistory: {
          enabled: true,
          directory: ".wrapper/prompts",
          maxEntries: 20
        }
      }).indexing.embedModel
    ).toBe("nomic-embed-text");

    expect(
      IndexManifestSchema.parse({
        version: 1,
        builtAt: "2026-06-15T14:30:00.000Z",
        embedModel: "nomic-embed-text",
        chunkCount: 15,
        fileCount: 3,
        mode: "semantic"
      }).mode
    ).toBe("semantic");

    expect(
      AgentBriefSchema.parse({
        version: 1,
        task: "Implement indexing",
        intent: "implementation",
        briefMarkdown: "# Brief\n...",
        inScope: ["src/index.ts"],
        outOfScope: ["tests/"],
        acceptanceCriteria: ["npm test"],
        retrievalHits: [
          {
            path: "src/index.ts",
            startLine: 1,
            endLine: 10,
            text: "code",
            score: 0.95
          }
        ],
        createdAt: "2026-06-15T14:30:00.000Z"
      }).task
    ).toBe("Implement indexing");
  });

  it("rejects invalid prompt quality scores", () => {
    expect(() =>
      PromptQualitySchema.parse({
        version: 1,
        prompt: "x",
        score: 101,
        missingContext: [],
        recommendedQuestions: [],
        refinedPrompt: "x",
        createdAt: "2026-06-15T14:30:00.000Z"
      })
    ).toThrow();
  });
});
