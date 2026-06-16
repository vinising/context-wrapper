import { ContextHandoff, Decision, RetrievalHit } from "@wrapper/schemas";
import { z } from "zod";

export type RefineIntent = "implementation" | "debugging" | "planning" | "review";

export type RefinementContext = {
  handoff: ContextHandoff;
  prompt: string;
  intent: RefineIntent;
};

export type RefinementAssessment = {
  score: number;
  missingContext: string[];
  recommendedQuestions: string[];
  refinedPrompt: string;
  scoringMethod: "llm" | "heuristic";
  readyForImplementation: boolean;
};

export const LlmRefinementResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  missingContext: z.array(z.string().min(1)),
  recommendedQuestions: z.array(z.string().min(1)),
  refinedPrompt: z.string().min(1),
  readyForImplementation: z.boolean()
});

export const LlmAssessmentResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  missingContext: z.array(z.string().min(1)),
  recommendedQuestions: z.array(z.string().min(1)),
  readyForImplementation: z.boolean()
});

const REFINEMENT_JSON_EXAMPLE = JSON.stringify(
  {
    score: 72,
    missingContext: ["acceptance criteria"],
    recommendedQuestions: ["What tests prove this is done?"],
    refinedPrompt: "Refined prompt text...",
    readyForImplementation: false
  },
  null,
  2
);

const ASSESSMENT_JSON_EXAMPLE = JSON.stringify(
  {
    score: 45,
    missingContext: ["goal", "constraints"],
    recommendedQuestions: ["What outcome matters most?"],
    readyForImplementation: false
  },
  null,
  2
);

export function buildRefinementPrompt(context: RefinementContext): string {
  return [
    buildContextBlock(context),
    "",
    "Assess the user prompt, then rewrite it for a Cursor coding agent.",
    "",
    "Return ONLY valid JSON matching this shape:",
    REFINEMENT_JSON_EXAMPLE,
    "",
    "Scoring guidance:",
    "- 0-39: vague or missing goal, scope, and success criteria",
    "- 40-69: workable but important gaps remain",
    "- 70-89: clear enough to implement with minor assumptions",
    "- 90-100: specific goal, constraints, acceptance criteria, and verification steps",
    "",
    "Use short labels in missingContext (e.g. goal, success criteria, constraints, scope, detail).",
    "readyForImplementation is true only when score >= 70 and no critical gaps remain."
  ].join("\n");
}

export function buildAssessmentPrompt(context: RefinementContext): string {
  return [
    buildContextBlock(context),
    "",
    "Assess the user prompt quality for a Cursor coding agent. Do NOT rewrite the prompt.",
    "",
    "Return ONLY valid JSON matching this shape:",
    ASSESSMENT_JSON_EXAMPLE,
    "",
    "Use the same scoring guidance as refinement assessment.",
    "Use short labels in missingContext (e.g. goal, success criteria, constraints, scope, detail).",
    "readyForImplementation is true only when score >= 70 and no critical gaps remain."
  ].join("\n");
}

export function assessPromptHeuristically(context: RefinementContext): RefinementAssessment {
  const missingContext = findMissingContextHeuristic(context.prompt);
  const recommendedQuestions = recommendQuestionsHeuristic(context.intent, missingContext);
  const score = scorePromptHeuristic(context.prompt, missingContext);

  return {
    score,
    missingContext,
    recommendedQuestions,
    refinedPrompt: context.prompt,
    scoringMethod: "heuristic",
    readyForImplementation: score >= 70 && missingContext.length === 0
  };
}

export function parseModelJson<T>(text: string, schema: z.ZodSchema<T>): T {
  const candidates = [text.trim(), extractJsonBlock(text)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  throw new Error("Model response was not valid JSON for prompt assessment.");
}

export function toRefinementAssessment(
  parsed: z.infer<typeof LlmRefinementResponseSchema>
): RefinementAssessment {
  return {
    score: parsed.score,
    missingContext: parsed.missingContext,
    recommendedQuestions: parsed.recommendedQuestions,
    refinedPrompt: parsed.refinedPrompt,
    scoringMethod: "llm",
    readyForImplementation: parsed.readyForImplementation
  };
}

export function toAssessmentOnlyResult(
  parsed: z.infer<typeof LlmAssessmentResponseSchema>,
  prompt: string
): RefinementAssessment {
  return {
    score: parsed.score,
    missingContext: parsed.missingContext,
    recommendedQuestions: parsed.recommendedQuestions,
    refinedPrompt: prompt,
    scoringMethod: "llm",
    readyForImplementation: parsed.readyForImplementation
  };
}

function buildContextBlock(context: RefinementContext): string {
  return [
    `Project: ${context.handoff.project.name}`,
    `Goal: ${context.handoff.project.goal}`,
    `Current focus: ${context.handoff.activeContext.currentFocus}`,
    `Intent: ${context.intent}`,
    `User prompt: ${context.prompt}`
  ].join("\n");
}

function extractJsonBlock(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  return undefined;
}

function findMissingContextHeuristic(prompt: string): string[] {
  const normalized = prompt.toLowerCase();
  const missing: string[] = [];

  if (!/(goal|purpose|why|outcome|intention)/.test(normalized)) {
    missing.push("goal");
  }

  if (!/(acceptance|done|success|criteria|test|verify)/.test(normalized)) {
    missing.push("success criteria");
  }

  if (!/(constraint|must|should|do not|don't|cannot|cursor|local|runtime)/.test(normalized)) {
    missing.push("constraints");
  }

  if (prompt.trim().split(/\s+/).length < 8) {
    missing.push("detail");
  }

  return [...new Set(missing)];
}

function scorePromptHeuristic(prompt: string, missingContext: string[]): number {
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const base = Math.min(70, wordCount * 5);
  const penalty = missingContext.length * 12;
  return Math.max(0, Math.min(100, base + 30 - penalty));
}

function recommendQuestionsHeuristic(intent: RefineIntent, missingContext: string[]): string[] {
  const questions: string[] = missingContext.map((gap) => {
    if (gap === "goal") {
      return "What outcome should the working model optimize for?";
    }

    if (gap === "success criteria") {
      return "What observable behavior or test should prove this is done?";
    }

    if (gap === "constraints") {
      return "What constraints, APIs, files, or product decisions must the solution respect?";
    }

    return "What extra context would prevent the model from guessing?";
  });

  if (intent === "implementation") {
    questions.push("Should the model ask clarifying questions before coding when requirements are incomplete?");
  }

  return [...new Set(questions)];
}

export const LlmAgentBriefResponseSchema = z.object({
  goal: z.string().min(1),
  inScope: z.array(z.string().min(1)),
  outOfScope: z.array(z.string()),
  constraints: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(z.string().min(1)),
  verificationSteps: z.array(z.string().min(1)),
  firstStep: z.string().min(1),
  briefMarkdown: z.string().min(1)
});

export type LlmAgentBriefResponse = z.infer<typeof LlmAgentBriefResponseSchema>;

export type AgentBriefContext = {
  handoff: ContextHandoff;
  decisions: Decision[];
  retrievalHits: RetrievalHit[];
  task: string;
  intent: RefineIntent;
  subAgent?: boolean;
};

export function buildAgentBriefPrompt(context: AgentBriefContext): string {
  const decisionsBlock = context.decisions
    .slice(0, 5)
    .map((d) => `- ${d.title}: ${d.rationale}`)
    .join("\n") || "None";

  const retrievalBlock = context.retrievalHits
    .map((hit, i) => `Hit ${i + 1} (${hit.path} lines ${hit.startLine}-${hit.endLine}, score: ${hit.score.toFixed(2)}):\n${hit.text}`)
    .join("\n\n") || "None";

  const subAgentInstruction = context.subAgent
    ? "IMPORTANT: This brief is for a specialized sub-agent. Instruct it to execute ONLY this slice and strictly respect the architecture; it must NOT re-plan or re-architect the project."
    : "";

  return [
    `Project: ${context.handoff.project.name}`,
    `Project Goal: ${context.handoff.project.goal}`,
    `Current Focus: ${context.handoff.activeContext.currentFocus}`,
    `Task: ${context.task}`,
    `Intent: ${context.intent}`,
    "",
    "## Accepted Architectural Decisions",
    decisionsBlock,
    "",
    "## Relevant Codebase Snippets (Retrieval)",
    retrievalBlock,
    "",
    subAgentInstruction,
    "",
    "Generate a task-scoped execution brief for a Cursor coding agent.",
    "Return ONLY valid JSON matching this shape:",
    JSON.stringify({
      goal: "Clear description of what the agent must achieve",
      inScope: ["file1.ts", "file2.ts"],
      outOfScope: ["tests/"],
      constraints: ["Constraint 1", "Constraint 2"],
      acceptanceCriteria: ["npm test passes", "criteria 2"],
      verificationSteps: ["Run npm test", "Verify output"],
      firstStep: "The very first concrete action to take",
      briefMarkdown: "# Task Brief: [Task Name]\n\n## Goal\n...\n\n## In Scope\n...\n\n## Out of Scope\n...\n\n## Constraints\n...\n\n## Acceptance Criteria\n...\n\n## Verification Steps\n...\n\n## First Step\n..."
    }, null, 2),
    "",
    "Make briefMarkdown extremely rich, professional, and dense. It will be passed to the agent as its primary context."
  ].join("\n");
}

export function buildAgentBriefHeuristically(context: AgentBriefContext): LlmAgentBriefResponse {
  const inScope = [...new Set(context.retrievalHits.map((h) => h.path))];
  const briefMarkdown = [
    `# Task Brief: ${context.task}`,
    "",
    "## Goal",
    `Execute task: ${context.task} (Intent: ${context.intent})`,
    "",
    "## Project Context",
    `- **Project:** ${context.handoff.project.name}`,
    `- **Goal:** ${context.handoff.project.goal}`,
    `- **Focus:** ${context.handoff.activeContext.currentFocus}`,
    "",
    "## In Scope",
    ...inScope.map((f) => `- ${f}`),
    inScope.length === 0 ? "- To be determined by agent" : "",
    "",
    "## Constraints",
    ...context.handoff.activeContext.constraints.map((c) => `- ${c}`),
    "",
    "## Acceptance Criteria",
    "- Task completed successfully with no errors",
    "",
    "## Verification Steps",
    "- Run test suite or compile checks",
    "",
    "## First Step",
    "Review the codebase and prepare the implementation plan."
  ].join("\n");

  return {
    goal: context.task,
    inScope,
    outOfScope: [],
    constraints: context.handoff.activeContext.constraints,
    acceptanceCriteria: ["Task completed successfully with no errors"],
    verificationSteps: ["Run test suite or compile checks"],
    firstStep: "Review the codebase and prepare the implementation plan.",
    briefMarkdown
  };
}

