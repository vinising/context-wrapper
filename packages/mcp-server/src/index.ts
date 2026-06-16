import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ContextStore, HandoffUpdate } from "@wrapper/context-store";
import { PromptQuality, PromptQualitySchema, AgentBrief, AgentBriefSchema } from "@wrapper/schemas";
import { indexWorkspace, retrieveContext } from "@wrapper/semantic-index";
import { createRuntimeGenerator } from "./runtime-generator.js";
export { createRuntimeGenerator };
import { RefineIntent } from "./prompt-assessment.js";
import { recommendModelProfile } from "@wrapper/model-router";

export type RefinePromptInput = {
  prompt: string;
  intent?: RefineIntent;
};

export type BuildAgentBriefInput = {
  task: string;
  intent?: RefineIntent;
  topK?: number;
  subAgent?: boolean;
};

export type WrapperTools = ReturnType<typeof createWrapperTools>;

type RuntimeRefinement = Pick<
  ReturnType<typeof createRuntimeGenerator>,
  "assessAndRefine" | "assessOnly" | "buildAgentBrief"
>;

export function createWrapperTools(options: { store: ContextStore; runtime: RuntimeRefinement }) {
  async function refinePrompt(input: RefinePromptInput): Promise<PromptQuality> {
    const handoff = await options.store.readHandoff();
    const assessment = await options.runtime.assessAndRefine({
      handoff,
      prompt: input.prompt,
      intent: input.intent ?? "implementation"
    });

    return persistPromptResult(input.prompt, assessment);
  }

  async function scorePromptQuality(input: RefinePromptInput): Promise<PromptQuality> {
    const handoff = await options.store.readHandoff();
    const assessment = await options.runtime.assessOnly({
      handoff,
      prompt: input.prompt,
      intent: input.intent ?? "implementation"
    });

    return persistPromptResult(input.prompt, assessment);
  }

  async function persistPromptResult(
    prompt: string,
    assessment: z.infer<typeof import("./prompt-assessment.js").LlmRefinementResponseSchema> & { scoringMethod: "llm" | "heuristic" }
  ): Promise<PromptQuality> {
    const result = PromptQualitySchema.parse({
      version: 1,
      prompt,
      score: assessment.score,
      missingContext: assessment.missingContext,
      recommendedQuestions: assessment.recommendedQuestions,
      refinedPrompt: assessment.refinedPrompt,
      scoringMethod: assessment.scoringMethod,
      readyForImplementation: assessment.readyForImplementation,
      createdAt: new Date().toISOString()
    });

    const historyPath = await options.store.recordPromptResult(result);
    return PromptQualitySchema.parse({
      ...result,
      ...(historyPath ? { historyPath } : {})
    });
  }

  async function getContextHandoff() {
    return options.store.readHandoff();
  }

  async function updateContextHandoff(update: HandoffUpdate) {
    return options.store.updateHandoff(update);
  }

  async function recommendClarifyingQuestions(input: RefinePromptInput): Promise<string[]> {
    const handoff = await options.store.readHandoff();
    const assessment = await options.runtime.assessOnly({
      handoff,
      prompt: input.prompt,
      intent: input.intent ?? "implementation"
    });
    return assessment.recommendedQuestions;
  }

  async function indexWorkspaceTool(optionsIndex: { force?: boolean } = {}) {
    const policy = await options.store.readPolicy();
    const workspaceRoot = dirname(options.store.paths.root);
    const manifest = await indexWorkspace(workspaceRoot, policy, {
      force: optionsIndex.force
    });
    return manifest;
  }

  async function retrieveContextTool(optionsRetrieve: { query: string; topK?: number }) {
    const policy = await options.store.readPolicy();
    const workspaceRoot = dirname(options.store.paths.root);
    const topK = optionsRetrieve.topK ?? policy.indexing.retrievalTopK;
    const hits = await retrieveContext(workspaceRoot, optionsRetrieve.query, topK);
    return hits;
  }

  async function buildAgentBrief(input: BuildAgentBriefInput): Promise<AgentBrief> {
    const handoff = await options.store.readHandoff();
    const policy = await options.store.readPolicy();
    const decisions = await options.store.readDecisions();

    const workspaceRoot = dirname(options.store.paths.root);
    const topK = input.topK ?? policy.indexing.retrievalTopK;
    const retrievalHits = await retrieveContext(workspaceRoot, input.task, topK);

    const assessment = await options.runtime.buildAgentBrief({
      handoff,
      decisions: decisions.decisions,
      retrievalHits,
      task: input.task,
      intent: input.intent ?? "implementation",
      subAgent: input.subAgent
    });

    const result = AgentBriefSchema.parse({
      version: 1,
      task: input.task,
      intent: input.intent ?? "implementation",
      briefMarkdown: assessment.briefMarkdown,
      inScope: assessment.inScope,
      outOfScope: assessment.outOfScope,
      acceptanceCriteria: assessment.acceptanceCriteria,
      retrievalHits,
      createdAt: new Date().toISOString()
    });

    const briefPath = await options.store.recordAgentBrief(result);
    return AgentBriefSchema.parse({
      ...result,
      ...(briefPath ? { briefPath } : {})
    });
  }

  async function diagnoseSetup() {
    const workspaceRoot = dirname(options.store.paths.root);
    const profile = recommendModelProfile();
    const checks: Array<{ name: string; status: "PASS" | "FAIL" | "WARN"; details: string }> = [];
    const recommendations: string[] = [];

    // 1. MCP Server Connection (Implicit PASS if this runs)
    checks.push({
      name: "MCP Server Connection",
      status: "PASS",
      details: "The Local Context Wrapper MCP sidecar is active and communicating successfully with Cursor."
    });

    // 2. Ollama Status
    let ollamaRunning = false;
    let ollamaModels: string[] = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        ollamaRunning = true;
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        ollamaModels = (data.models || []).map((m) => m.name);
        checks.push({
          name: "Ollama Service Status",
          status: "PASS",
          details: "Ollama background service is running and responsive."
        });
      }
    } catch {
      checks.push({
        name: "Ollama Service Status",
        status: "FAIL",
        details: "Could not connect to Ollama at http://127.0.0.1:11434. Ensure Ollama is running (`ollama serve`)."
      });
      recommendations.push("Start Ollama service using `ollama serve` or open the Ollama app.");
    }

    // 3. Check Gemma model
    if (ollamaRunning) {
      const gemmaInstalled = ollamaModels.some((name) => name.startsWith("gemma4:e4b") || name.startsWith("gemma-3") || name.startsWith("gemma4") || name.startsWith("gemma2") || name.startsWith("gemma:"));
      if (gemmaInstalled) {
        checks.push({
          name: "Ollama Model (gemma4:e4b)",
          status: "PASS",
          details: `Found gemma model in Ollama tags: ${ollamaModels.find((name) => name.includes("gemma")) || "gemma4:e4b"}.`
        });
      } else {
        checks.push({
          name: "Ollama Model (gemma4:e4b)",
          status: "FAIL",
          details: "Required model gemma4:e4b is missing from Ollama tags."
        });
        recommendations.push("Pull the missing gemma model by running `ollama pull gemma4:e4b`.");
      }

      // Check Embed model
      const embedInstalled = ollamaModels.some((name) => name.startsWith("nomic-embed-text"));
      if (embedInstalled) {
        checks.push({
          name: "Ollama Embed Model (nomic-embed-text)",
          status: "PASS",
          details: "Found nomic-embed-text model in Ollama tags."
        });
      } else {
        checks.push({
          name: "Ollama Embed Model (nomic-embed-text)",
          status: "FAIL",
          details: "Required embedding model nomic-embed-text is missing from Ollama tags."
        });
        recommendations.push("Pull the embedding model by running `ollama pull nomic-embed-text`.");
      }
    } else {
      checks.push({
        name: "Ollama Model (gemma4:e4b)",
        status: "FAIL",
        details: "Ollama is offline, cannot check installed models."
      });
      checks.push({
        name: "Ollama Embed Model (nomic-embed-text)",
        status: "FAIL",
        details: "Ollama is offline, cannot check installed embedding models."
      });
    }

    // 4. Check Python virtual environment
    let hasVenv = false;
    const venvNames = [".venv", "venv"];
    for (const name of venvNames) {
      try {
        const s = await stat(join(workspaceRoot, name));
        if (s.isDirectory()) {
          hasVenv = true;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (hasVenv) {
      checks.push({
        name: "Python Virtual Environment",
        status: "PASS",
        details: "Found active local python virtual environment for MLX acceleration."
      });
    } else {
      if (profile.selectedTier === "fallback") {
        checks.push({
          name: "Python Virtual Environment",
          status: "WARN",
          details: "No local Python virtual environment found. Since this machine uses Ollama-fallback mode, Python/MLX is completely optional."
        });
      } else {
        checks.push({
          name: "Python Virtual Environment",
          status: "WARN",
          details: "No Python virtual environment found (.venv). Python/MLX environment is recommended for Apple Silicon native performance."
        });
        recommendations.push("To bootstrap the python MLX environment, run `npm run setup` in your terminal.");
      }
    }

    // Determine overall status
    const status = checks.some((c) => c.status === "FAIL")
      ? "FAIL"
      : checks.some((c) => c.status === "WARN")
      ? "WARN"
      : "PASS";

    return {
      status,
      machineProfile: {
        platform: profile.detected.platform,
        arch: profile.detected.arch,
        memoryGb: profile.detected.memoryGb,
        selectedTier: profile.selectedTier,
        recommendedModel: profile.modelId
      },
      checks,
      recommendations
    };
  }

  return {
    refinePrompt,
    scorePromptQuality,
    getContextHandoff,
    updateContextHandoff,
    recommendClarifyingQuestions,
    indexWorkspace: indexWorkspaceTool,
    retrieveContext: retrieveContextTool,
    buildAgentBrief,
    diagnoseSetup
  };
}
