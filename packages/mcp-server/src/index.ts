import { dirname } from "node:path";
import { z } from "zod";
import { ContextStore, HandoffUpdate } from "@wrapper/context-store";
import { PromptQuality, PromptQualitySchema, AgentBrief, AgentBriefSchema } from "@wrapper/schemas";
import { indexWorkspace, retrieveContext } from "@wrapper/semantic-index";
import { createRuntimeGenerator } from "./runtime-generator.js";
export { createRuntimeGenerator };
import { RefineIntent } from "./prompt-assessment.js";

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

  return {
    refinePrompt,
    scorePromptQuality,
    getContextHandoff,
    updateContextHandoff,
    recommendClarifyingQuestions,
    indexWorkspace: indexWorkspaceTool,
    retrieveContext: retrieveContextTool,
    buildAgentBrief
  };
}
