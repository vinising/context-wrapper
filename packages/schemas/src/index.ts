import { z } from "zod";

const IsoDateSchema = z.string().datetime();

export const ContextHandoffSchema = z.object({
  version: z.literal(1),
  updatedAt: IsoDateSchema,
  project: z.object({
    name: z.string().min(1),
    goal: z.string().min(1)
  }),
  activeContext: z.object({
    summary: z.string().min(1),
    currentFocus: z.string().min(1),
    constraints: z.array(z.string().min(1)),
    nextSteps: z.array(z.string().min(1))
  }),
  signals: z.object({
    confidence: z.number().min(0).max(1),
    staleAfterMinutes: z.number().int().positive()
  })
});

export type ContextHandoff = z.infer<typeof ContextHandoffSchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  madeAt: IsoDateSchema,
  title: z.string().min(1),
  rationale: z.string().min(1),
  status: z.enum(["accepted", "superseded"])
});

export const DecisionLogSchema = z.object({
  version: z.literal(1),
  decisions: z.array(DecisionSchema)
});

export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionLog = z.infer<typeof DecisionLogSchema>;

export const PromptQualitySchema = z.object({
  version: z.literal(1),
  prompt: z.string().min(1),
  score: z.number().int().min(0).max(100),
  missingContext: z.array(z.string().min(1)),
  recommendedQuestions: z.array(z.string().min(1)),
  refinedPrompt: z.string().min(1),
  scoringMethod: z.enum(["llm", "heuristic"]).optional(),
  readyForImplementation: z.boolean().optional(),
  createdAt: IsoDateSchema,
  historyPath: z.string().min(1).optional()
});

export type PromptQuality = z.infer<typeof PromptQualitySchema>;

export const ModelProfileSchema = z.object({
  version: z.literal(1),
  detected: z.object({
    platform: z.string().min(1),
    arch: z.string().min(1),
    memoryGb: z.number().positive(),
    cpuBrand: z.string().min(1)
  }),
  selectedTier: z.enum(["base", "standard", "pro", "fallback"]),
  modelId: z.string().min(1),
  reason: z.string().min(1)
});

export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type DetectedMachine = ModelProfile["detected"];

export const WorkspacePolicySchema = z.object({
  version: z.literal(1),
  indexing: z.object({
    enabled: z.boolean(),
    include: z.array(z.string().min(1)),
    exclude: z.array(z.string().min(1)),
    embedModel: z.string().min(1).default("nomic-embed-text"),
    maxFileBytes: z.number().int().positive().default(256000),
    maxFiles: z.number().int().positive().default(500),
    chunkCharSize: z.number().int().positive().default(1800),
    retrievalTopK: z.number().int().positive().default(8)
  }),
  privacy: z.object({
    allowPromptLogs: z.boolean(),
    redactSecrets: z.boolean()
  }),
  promptHistory: z.object({
    enabled: z.boolean(),
    directory: z.string().min(1),
    maxEntries: z.number().int().positive()
  }),
  agentBrief: z.object({
    enabled: z.boolean().default(true),
    directory: z.string().min(1).default(".wrapper/runs"),
    maxEntries: z.number().int().positive().default(10)
  }).default({
    enabled: true,
    directory: ".wrapper/runs",
    maxEntries: 10
  }),
  autonomous: z.object({
    interactiveApproval: z.boolean().default(true),
    maxTaskTurns: z.number().int().positive().default(5),
    maxFilesModified: z.number().int().positive().default(10),
    forcedTier: z.enum(["tier1_local", "tier2_hybrid", "tier3_hosted", "auto"]).default("auto"),
    autoValidate: z.boolean().default(true),
    autoRollbackOnFailure: z.boolean().default(false)
  }).default({
    interactiveApproval: true,
    maxTaskTurns: 5,
    maxFilesModified: 10,
    forcedTier: "auto",
    autoValidate: true,
    autoRollbackOnFailure: false
  })
});

export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>;

export const IndexManifestSchema = z.object({
  version: z.literal(1),
  builtAt: IsoDateSchema,
  embedModel: z.string().min(1),
  chunkCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  mode: z.enum(["semantic", "lexical"])
});

export type IndexManifest = z.infer<typeof IndexManifestSchema>;

export const IndexChunkSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
  hash: z.string().min(1),
  embedding: z.array(z.number()).optional()
});

export type IndexChunk = z.infer<typeof IndexChunkSchema>;

export const IndexDataSchema = z.object({
  version: z.literal(1),
  chunks: z.array(IndexChunkSchema)
});

export type IndexData = z.infer<typeof IndexDataSchema>;

export const RetrievalHitSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
  score: z.number()
});

export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;

export const AgentBriefSchema = z.object({
  version: z.literal(1),
  task: z.string().min(1),
  intent: z.enum(["implementation", "debugging", "planning", "review"]),
  briefMarkdown: z.string().min(1),
  inScope: z.array(z.string().min(1)),
  outOfScope: z.array(z.string()),
  acceptanceCriteria: z.array(z.string().min(1)),
  retrievalHits: z.array(RetrievalHitSchema),
  createdAt: IsoDateSchema,
  briefPath: z.string().min(1).optional()
});

export type AgentBrief = z.infer<typeof AgentBriefSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  rawPrompt: z.string().min(1),
  intent: z.enum(["implementation", "debugging", "planning", "review"]),
  timestamp: z.string().datetime().optional(),
  followUpTurns: z.number().int().nonnegative().optional(),
  toolsUsed: z.array(z.string()).optional(),
  fixture: z.string().optional(),
  goldenOutcome: z.string().optional(),
  sourceLineStart: z.number().int().positive().optional(),
  sourceLineEnd: z.number().int().positive().optional()
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalRunSchema = z.object({
  caseId: z.string().min(1),
  arm: z.enum(["baseline_raw", "hosted_refine", "wrapper_local"]),
  refinedPrompt: z.string().optional(),
  promptQualityScore: z.number().min(0).max(100).optional(),
  outcomeQualityScore: z.number().min(0).max(100).optional(),
  tokensLocal: z.number().int().nonnegative().optional(),
  tokensHosted: z.number().int().nonnegative().optional(),
  filesTouched: z.array(z.string()).optional(),
  linesAdded: z.number().int().nonnegative().optional(),
  linesDeleted: z.number().int().nonnegative().optional(),
  sameFileRewrites: z.number().int().nonnegative().optional(),
  revertRatio: z.number().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().optional(),
  runAt: IsoDateSchema
});

export type EvalRun = z.infer<typeof EvalRunSchema>;

export const JudgeVerdictSchema = z.object({
  score: z.number().int().min(0).max(100),
  goal_clarity: z.number().int().min(1).max(5),
  scope_bounds: z.number().int().min(1).max(5),
  acceptance_criteria: z.number().int().min(1).max(5),
  constraints: z.number().int().min(1).max(5),
  verification_steps: z.number().int().min(1).max(5),
  context_grounding: z.number().int().min(1).max(5),
  reason: z.string().min(1)
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const ActivePlanMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  assignedTo: z.string().min(1),
  result: z.object({
    success: z.boolean(),
    filesModified: z.array(z.string()),
    logs: z.string().optional()
  }).optional()
});

export type ActivePlanMilestone = z.infer<typeof ActivePlanMilestoneSchema>;

export const ActivePlanSchema = z.object({
  version: z.literal(1),
  taskId: z.string().min(1),
  taskDescription: z.string().min(1),
  tier: z.enum(["tier1_local", "tier2_hybrid", "tier3_hosted"]),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  milestones: z.array(ActivePlanMilestoneSchema),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema
});

export type ActivePlan = z.infer<typeof ActivePlanSchema>;

