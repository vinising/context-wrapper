import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  ContextStore,
  HandoffUpdate,
  isValidCompactionSummary,
  parseCompactionSummaryContract
} from "@wrapper/context-store";
import {
  PromptQuality,
  PromptQualitySchema,
  PromptTargetFile,
  AgentBrief,
  AgentBriefSchema,
  ActivePlan,
  ActivePlanSchema,
  CompactHistoryMessage,
  ValidationRun,
  MilestoneExecution
} from "@wrapper/schemas";
import { indexWorkspace, retrieveContext } from "@wrapper/semantic-index";
import { createRuntimeGenerator } from "./runtime-generator.js";
export { createRuntimeGenerator };
import { RefineIntent, buildAgentBriefHeuristically } from "./prompt-assessment.js";
import { recommendModelProfile } from "@wrapper/model-router";
import { parseSignatures } from "./signature-parser.js";
import { resolveValidationCommand, runValidationCommand } from "./project-validator.js";
import {
  estimateMaxVramBytes,
  getLoadedOllamaModel,
  parseOllamaNumCtx
} from "./ollama-context.js";

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

export type LocalRefreshDocsInput = {
  taskId?: string;
  scope?: "smart_touched" | "full";
  apply?: boolean;
  includeDocs?: string[];
};

export type LocalGitHygieneInput = {
  taskId?: string;
  mode?: "plan_scoped" | "all_tracked";
  includeFiles?: string[];
  commit?: boolean;
  commitMessage?: string;
};

export type LocalFileReadInput = {
  filePath: string;
  mode?: "auto" | "raw_window" | "signature_map" | "summary_blocks";
  offset?: number;
  limit?: number;
  focus?: string;
  forceRefresh?: boolean;
};

export type WrapperTools = ReturnType<typeof createWrapperTools>;

type RuntimeRefinement = Pick<
  ReturnType<typeof createRuntimeGenerator>,
  "assessAndRefine" | "assessOnly" | "buildAgentBrief"
> & {
  generate?: ReturnType<typeof createRuntimeGenerator>["generate"];
  usesLlmScoring?: boolean;
};

export function createWrapperTools(options: { store: ContextStore; runtime: RuntimeRefinement }) {
  const execFileAsync = promisify(execFile);

  async function refinePrompt(input: RefinePromptInput): Promise<PromptQuality> {
    const policy = await options.store.readPolicy();
    const workspaceRoot = dirname(options.store.paths.root);
    const handoff = await options.store.readHandoff();
    const assessment = await options.runtime.assessAndRefine({
      handoff,
      prompt: input.prompt,
      intent: input.intent ?? "implementation"
    });

    const retrievalQuery = assessment.refinedPrompt.trim() || input.prompt;
    let targetFiles: PromptTargetFile[] = [];
    try {
      const retrievalHits = await retrieveContext(workspaceRoot, retrievalQuery, policy.indexing.retrievalTopK);
      targetFiles = mapRetrievalHitsToTargetFiles(retrievalHits);
    } catch {
      targetFiles = [];
    }

    return persistPromptResult(input.prompt, assessment, targetFiles);
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
    assessment: z.infer<typeof import("./prompt-assessment.js").LlmRefinementResponseSchema> & { scoringMethod: "llm" | "heuristic" },
    targetFiles: PromptTargetFile[] = []
  ): Promise<PromptQuality> {
    const result = PromptQualitySchema.parse({
      version: 1,
      prompt,
      score: assessment.score,
      missingContext: assessment.missingContext,
      recommendedQuestions: assessment.recommendedQuestions,
      refinedPrompt: assessment.refinedPrompt,
      targetFiles,
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

  function mapRetrievalHitsToTargetFiles(
    hits: Array<{ path: string; startLine: number; endLine: number; text: string }>
  ): PromptTargetFile[] {
    const deduped = new Map<string, PromptTargetFile>();

    for (const hit of hits) {
      const existing = deduped.get(hit.path);
      const reason = summarizeHitReason(hit.text);
      if (!existing) {
        deduped.set(hit.path, {
          path: hit.path,
          startLine: hit.startLine,
          endLine: hit.endLine,
          reason
        });
        continue;
      }

      existing.startLine = Math.min(existing.startLine, hit.startLine);
      existing.endLine = Math.max(existing.endLine, hit.endLine);
      if (!existing.reason && reason) {
        existing.reason = reason;
      }
    }

    return Array.from(deduped.values());
  }

  function summarizeHitReason(text: string): string {
    const firstNonEmpty = text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstNonEmpty) {
      return "Relevant semantic retrieval match.";
    }
    if (firstNonEmpty.length <= 96) {
      return firstNonEmpty;
    }
    return `${firstNonEmpty.slice(0, 93)}...`;
  }

  async function getContextHandoff() {
    return options.store.readHandoff();
  }

  async function updateContextHandoff(
    update: HandoffUpdate,
    handoffOptions?: { compactSync?: boolean }
  ) {
    return options.store.updateHandoff(update, handoffOptions);
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

    const assessment = policy.autonomous.briefMode === "heuristic"
      ? buildAgentBriefHeuristically({
          handoff,
          decisions: decisions.decisions,
          retrievalHits,
          task: input.task,
          intent: input.intent ?? "implementation",
          subAgent: input.subAgent
        })
      : await options.runtime.buildAgentBrief({
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
      verificationSteps: assessment.verificationSteps,
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
    const requiredOllamaModel = process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx";
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
      const modelInstalled = ollamaModels.some(
        (name) => name === requiredOllamaModel || name.startsWith(`${requiredOllamaModel}:`)
      );
      if (modelInstalled) {
        checks.push({
          name: `Ollama Model (${requiredOllamaModel})`,
          status: "PASS",
          details: `Found required model in Ollama tags: ${ollamaModels.find((name) => name === requiredOllamaModel || name.startsWith(`${requiredOllamaModel}:`)) || requiredOllamaModel}.`
        });
      } else {
        checks.push({
          name: `Ollama Model (${requiredOllamaModel})`,
          status: "FAIL",
          details: `Required model ${requiredOllamaModel} is missing from Ollama tags.`
        });
        recommendations.push(`Pull the missing model by running \`ollama pull ${requiredOllamaModel}\`.`);
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

      const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
      const configuredNumCtx = parseOllamaNumCtx(process.env.WRAPPER_OLLAMA_NUM_CTX);
      const loadedModel = await getLoadedOllamaModel(ollamaHost, requiredOllamaModel);
      if (loadedModel) {
        const maxAllowedVram = estimateMaxVramBytes(configuredNumCtx) * 1.12;
        const loadedGb = (loadedModel.sizeVram / 1e9).toFixed(1);
        const budgetGb = (maxAllowedVram / 1e9).toFixed(1);
        if (loadedModel.sizeVram > maxAllowedVram) {
          checks.push({
            name: "Ollama Context Budget",
            status: "WARN",
            details: `Model is loaded at ${loadedGb}GB VRAM, above the ${budgetGb}GB budget for WRAPPER_OLLAMA_NUM_CTX=${configuredNumCtx}.`
          });
          recommendations.push(
            `Restart the MCP server or run \`ollama stop ${requiredOllamaModel}\` so LCW can reload the model with num_ctx=${configuredNumCtx}.`
          );
        } else {
          checks.push({
            name: "Ollama Context Budget",
            status: "PASS",
            details: `Loaded model uses ${loadedGb}GB VRAM (budget ${budgetGb}GB for num_ctx=${configuredNumCtx}).`
          });
        }
      } else {
        checks.push({
          name: "Ollama Context Budget",
          status: "PASS",
          details: `No loaded model instance; next LCW request will use num_ctx=${configuredNumCtx}.`
        });
      }
    } else {
      checks.push({
        name: `Ollama Model (${requiredOllamaModel})`,
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

  type ComplexityTier = "tier1_local" | "tier2_hybrid" | "tier3_hosted";
  type LocalExecutionPlan = {
    route: "direct_local" | "decomposed_local";
    complexityTier: ComplexityTier;
    microTasks: string[];
    decompositionDepth: number;
  };

  function detectPlannerModel(): string {
    const runtime = options.runtime as RuntimeRefinement & { mode?: string };
    const mode = runtime.mode;
    if (!mode) {
      return "unknown";
    }
    if (mode === "ollama") {
      return "local_ollama";
    }
    if (mode === "bridge") {
      return "local_bridge";
    }
    if (mode === "fallback") {
      return "local_fallback";
    }
    return `local_${mode}`;
  }

  function normalizeMicroTask(input: string): string {
    return input
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
  }

  function extractMicroTasksFromContext(context?: string): string[] {
    if (!context) {
      return [];
    }
    const microTasks = context
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
      .map(normalizeMicroTask)
      .filter((line) => line.length > 0);
    return Array.from(new Set(microTasks)).slice(0, 6);
  }

  function parseFirstJsonObject(raw: string): unknown | null {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  async function generateMicroTasksWithRuntime(input: {
    title: string;
    description: string;
    context?: string;
  }): Promise<string[]> {
    if (!options.runtime.generate) {
      return [];
    }

    const prompt = [
      `You are decomposing a coding milestone into micro-tasks for local execution.`,
      `Return only valid JSON with this shape: {"subtasks":["...", "..."]}.`,
      `Each subtask must be concrete and implementation-focused.`,
      `Keep total subtasks between 2 and 4.`,
      ``,
      `Milestone title: ${input.title}`,
      `Milestone description: ${input.description}`,
      input.context ? `Execution context: ${input.context}` : "",
      ``,
      `Do not include markdown. Output JSON only.`
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const raw = await options.runtime.generate({
        system: "You are a strict JSON planner. Output JSON only.",
        prompt
      });
      const parsed = parseFirstJsonObject(raw) as { subtasks?: unknown } | null;
      if (!parsed || !Array.isArray(parsed.subtasks)) {
        return [];
      }
      const subtasks = parsed.subtasks
        .filter((task): task is string => typeof task === "string")
        .map(normalizeMicroTask)
        .filter((task) => task.length > 0);
      return Array.from(new Set(subtasks)).slice(0, 6);
    } catch {
      return [];
    }
  }

  async function buildLocalExecutionPlan(input: {
    determineComplexityTier: (epic: string) => Promise<ComplexityTier>;
    title: string;
    description: string;
    context?: string;
  }): Promise<LocalExecutionPlan> {
    const baseTask = `${input.title}: ${input.description}`;
    const rootTask = input.context
      ? `${baseTask}\nContext:\n${input.context}`
      : baseTask;
    const complexityTier = await input.determineComplexityTier(rootTask);

    if (complexityTier === "tier1_local") {
      return {
        route: "direct_local",
        complexityTier,
        microTasks: [rootTask],
        decompositionDepth: 0
      };
    }

    const fallbackMicroTasks = [
      `Implement core logic for milestone "${input.title}" with explicit file-level boundaries.`,
      `Add or update tests and run verification for milestone "${input.title}".`
    ];

    const candidateMicroTasks = extractMicroTasksFromContext(input.context);
    const generatedMicroTasks =
      candidateMicroTasks.length >= 2
        ? candidateMicroTasks
        : await generateMicroTasksWithRuntime({
            title: input.title,
            description: input.description,
            context: input.context
          });

    const seedMicroTasks =
      (generatedMicroTasks.length > 0 ? generatedMicroTasks : candidateMicroTasks).length > 0
        ? (generatedMicroTasks.length > 0 ? generatedMicroTasks : candidateMicroTasks)
        : fallbackMicroTasks;

    const resolvedTasks: string[] = [];
    let maxDepthReached = 0;
    const MAX_DEPTH = 2;
    const MAX_TASKS = 6;

    const expandTask = async (task: string, depth: number): Promise<void> => {
      if (resolvedTasks.length >= MAX_TASKS) {
        return;
      }
      maxDepthReached = Math.max(maxDepthReached, depth);
      const normalizedTask = normalizeMicroTask(task);
      if (!normalizedTask) {
        return;
      }
      if (depth >= MAX_DEPTH) {
        resolvedTasks.push(normalizedTask);
        return;
      }
      const tier = await input.determineComplexityTier(normalizedTask);
      if (tier === "tier1_local") {
        resolvedTasks.push(normalizedTask);
        return;
      }
      const nested = await generateMicroTasksWithRuntime({
        title: input.title,
        description: normalizedTask,
        context: input.context
      });
      if (nested.length === 0) {
        resolvedTasks.push(normalizedTask);
        return;
      }
      for (const nestedTask of nested.slice(0, 3)) {
        await expandTask(nestedTask, depth + 1);
        if (resolvedTasks.length >= MAX_TASKS) {
          break;
        }
      }
    };

    for (const microTask of seedMicroTasks.slice(0, 4)) {
      await expandTask(microTask, 1);
      if (resolvedTasks.length >= MAX_TASKS) {
        break;
      }
    }

    const finalMicroTasks = Array.from(new Set(resolvedTasks)).slice(0, MAX_TASKS);
    return {
      route: finalMicroTasks.length > 1 ? "decomposed_local" : "direct_local",
      complexityTier,
      microTasks: finalMicroTasks.length > 0 ? finalMicroTasks : [rootTask],
      decompositionDepth: maxDepthReached
    };
  }

  async function resolvePlanForHygiene(taskId?: string): Promise<ActivePlan> {
    const plan = await options.store.readActivePlan();
    if (!plan) {
      throw new Error("No active plan found.");
    }
    if (taskId && plan.taskId !== taskId) {
      throw new Error(`Task ID mismatch: expected ${taskId}, got ${plan.taskId}`);
    }
    return plan;
  }

  function getPlanModifiedFiles(plan: ActivePlan): string[] {
    return Array.from(
      new Set(
        plan.milestones.flatMap((milestone) => milestone.result?.filesModified || [])
      )
    );
  }

  function resolveDocTargets(
    touchedFiles: string[],
    scope: "smart_touched" | "full",
    includeDocs: string[] = []
  ): string[] {
    const docs = new Set<string>(includeDocs);
    if (scope === "full") {
      docs.add("README.md");
      docs.add("docs/technical-reference.md");
      docs.add("docs/onboarding.md");
      return Array.from(docs);
    }

    for (const file of touchedFiles) {
      if (file.startsWith("docs/")) {
        docs.add(file);
      }
      if (file.startsWith("packages/mcp-server/") || file.startsWith("packages/schemas/")) {
        docs.add("README.md");
        docs.add("docs/technical-reference.md");
      }
      if (file.startsWith(".cursor/commands/") || file.startsWith("packages/cursor-plugin/assets/commands/")) {
        docs.add("README.md");
        docs.add("docs/technical-reference.md");
      }
      if (file.startsWith(".cursor/rules/") || file.startsWith("packages/cursor-plugin/assets/rules/")) {
        docs.add("docs/onboarding.md");
        docs.add("docs/technical-reference.md");
      }
    }

    if (docs.size === 0) {
      docs.add("docs/technical-reference.md");
    }
    return Array.from(docs);
  }

  async function localRefreshDocs(input: LocalRefreshDocsInput = {}) {
    const plan = await resolvePlanForHygiene(input.taskId);
    const workspaceRoot = dirname(options.store.paths.root);
    const scope = input.scope ?? "smart_touched";
    const apply = input.apply ?? true;
    const touchedFiles = getPlanModifiedFiles(plan);
    const docTargets = resolveDocTargets(touchedFiles, scope, input.includeDocs);

    const updatedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const now = new Date().toISOString();
    const completedMilestones = plan.milestones.filter((m) => m.status === "completed").length;
    const recentFiles = touchedFiles.slice(0, 8).map((file) => `- \`${file}\``).join("\n");
    const summaryBlock = [
      "",
      "## Automation Hygiene Update",
      `- Timestamp: ${now}`,
      `- Task ID: ${plan.taskId}`,
      `- Task: ${plan.taskDescription}`,
      `- Completed milestones: ${completedMilestones}/${plan.milestones.length}`,
      touchedFiles.length > 0 ? "- Key changed files:" : "- Key changed files: none recorded by plan",
      touchedFiles.length > 0 ? recentFiles : ""
    ]
      .filter(Boolean)
      .join("\n");

    if (!apply) {
      return {
        taskId: plan.taskId,
        scope,
        applied: false,
        touchedFiles,
        docTargets,
        updatedFiles,
        skippedFiles,
        summary: "Doc refresh plan generated. No files were modified."
      };
    }

    for (const docPath of docTargets) {
      const absPath = join(workspaceRoot, docPath);
      try {
        const current = await readFile(absPath, "utf8");
        const next = `${current.trimEnd()}\n${summaryBlock}\n`;
        await writeFile(absPath, next, "utf8");
        updatedFiles.push(docPath);
      } catch {
        skippedFiles.push(docPath);
      }
    }

    return {
      taskId: plan.taskId,
      scope,
      applied: true,
      touchedFiles,
      docTargets,
      updatedFiles,
      skippedFiles,
      summary: `Updated ${updatedFiles.length} documentation file(s) using ${scope} scope.`
    };
  }

  function parseGitStatusPaths(statusOutput: string): string[] {
    const lines = statusOutput
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const files: string[] = [];
    for (const line of lines) {
      if (line.length < 4) continue;
      const rawPath = line.slice(3);
      const resolvedPath = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").pop() ?? rawPath
        : rawPath;
      files.push(resolvedPath);
    }
    return Array.from(new Set(files));
  }

  async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd: workspaceRoot });
    return stdout.toString();
  }

  async function estimateChangedLines(workspaceRoot: string, files: string[]): Promise<number> {
    if (files.length === 0) {
      return 0;
    }
    const output = await runGit(workspaceRoot, ["diff", "--numstat", "--", ...files]);
    return output
      .split("\n")
      .filter(Boolean)
      .reduce((sum, row) => {
        const [adds, dels] = row.split("\t");
        const addCount = adds === "-" ? 0 : Number(adds || 0);
        const delCount = dels === "-" ? 0 : Number(dels || 0);
        return sum + addCount + delCount;
      }, 0);
  }

  async function localGitHygiene(input: LocalGitHygieneInput = {}) {
    const workspaceRoot = dirname(options.store.paths.root);
    const mode = input.mode ?? "plan_scoped";
    const includeFiles = Array.from(new Set(input.includeFiles ?? []));
    const commit = input.commit ?? false;

    const statusOutput = await runGit(workspaceRoot, ["status", "--porcelain"]);
    const changedFiles = parseGitStatusPaths(statusOutput);

    const plan = await resolvePlanForHygiene(input.taskId);
    const planFiles = getPlanModifiedFiles(plan);
    const stagedCandidates =
      mode === "all_tracked"
        ? Array.from(new Set([...changedFiles, ...includeFiles]))
        : Array.from(new Set([...planFiles, ...includeFiles])).filter((file) => changedFiles.includes(file));

    if (mode === "plan_scoped" && stagedCandidates.length === 0) {
      return {
        taskId: plan.taskId,
        mode,
        changedFiles,
        stagedFiles: [],
        committed: false,
        commitHash: null,
        summary: "No plan-scoped changed files detected. Commit was skipped safely.",
        pushRequiresApproval: true
      };
    }

    const diffSummary =
      stagedCandidates.length > 0
        ? await runGit(workspaceRoot, ["diff", "--stat", "--", ...stagedCandidates])
        : "";

    let commitHash: string | null = null;
    if (commit && stagedCandidates.length > 0) {
      await runGit(workspaceRoot, ["add", "--", ...stagedCandidates]);
      const title =
        input.commitMessage?.trim() ||
        `chore: checkpoint hygiene updates for ${plan.taskId}`;
      const body = [
        `Task: ${plan.taskDescription}`,
        `Mode: ${mode}`,
        "Automated by local_git_hygiene (push requires explicit approval)."
      ].join("\n");
      try {
        await runGit(workspaceRoot, ["commit", "-m", title, "-m", body]);
        commitHash = (await runGit(workspaceRoot, ["rev-parse", "HEAD"])).trim();
      } catch (err: any) {
        const message = String(err?.message || err);
        if (!message.includes("nothing to commit")) {
          throw err;
        }
      }
    }

    return {
      taskId: plan.taskId,
      mode,
      changedFiles,
      stagedFiles: stagedCandidates,
      committed: Boolean(commitHash),
      commitHash,
      diffSummary: diffSummary.trim(),
      summary: commit
        ? `Staged ${stagedCandidates.length} file(s); commit ${commitHash ? "created" : "skipped"}.`
        : `Prepared ${stagedCandidates.length} file(s) for a manual commit.`,
      pushRequiresApproval: true
    };
  }

  const codeExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php", ".rb"
  ]);

  function normalizeRelativePath(inputPath: string): string {
    return inputPath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  }

  function isCodePath(filePath: string): boolean {
    return codeExtensions.has(extname(filePath).toLowerCase());
  }

  function buildProjectionCachePath(args: {
    filePath: string;
    mode: string;
    mtimeMs: number;
    size: number;
    offset?: number;
    limit?: number;
    focus?: string;
    maxLines: number;
  }): string {
    const cacheKey = createHash("sha1")
      .update(
        JSON.stringify({
          filePath: args.filePath,
          mode: args.mode,
          mtimeMs: args.mtimeMs,
          size: args.size,
          offset: args.offset,
          limit: args.limit,
          focus: args.focus ?? "",
          maxLines: args.maxLines
        })
      )
      .digest("hex");
    return join(options.store.paths.indexDir, "file-read-cache", `${cacheKey}.json`);
  }

  async function readProjectionCache<T>(path: string): Promise<T | null> {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function writeProjectionCache(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value), "utf8");
  }

  function summarizeBlocks(content: string, blockSize: number): Array<{
    startLine: number;
    endLine: number;
    summary: string;
    preview: string;
  }> {
    const lines = content.split(/\r?\n/);
    const blocks: Array<{
      startLine: number;
      endLine: number;
      summary: string;
      preview: string;
    }> = [];

    for (let idx = 0; idx < lines.length; idx += blockSize) {
      const startLine = idx + 1;
      const endLine = Math.min(lines.length, idx + blockSize);
      const slice = lines.slice(idx, endLine);
      const firstNonEmpty = slice.map((line) => line.trim()).find(Boolean) ?? "(empty block)";
      const preview = firstNonEmpty.length > 120 ? `${firstNonEmpty.slice(0, 117)}...` : firstNonEmpty;
      blocks.push({
        startLine,
        endLine,
        summary: `Lines ${startLine}-${endLine}: ${preview}`,
        preview
      });
      if (blocks.length >= 12) {
        break;
      }
    }

    return blocks;
  }

  async function localFileRead(input: LocalFileReadInput) {
    const policy = await options.store.readPolicy();
    const workspaceRoot = dirname(options.store.paths.root);
    const workspaceRootResolved = resolve(workspaceRoot);
    const filePath = normalizeRelativePath(input.filePath);
    const absolutePath = resolve(workspaceRoot, filePath);
    const maxRawLines = policy.contextManagement?.directorRawReadMaxLines ?? 50;
    const useHostedFallback = policy.contextManagement?.useCheapHostedWorkerWhenOllamaUnavailable ?? true;

    if (absolutePath !== workspaceRootResolved && !absolutePath.startsWith(`${workspaceRootResolved}/`)) {
      throw new Error(`Path escapes workspace root: ${input.filePath}`);
    }

    const fileInfo = await stat(absolutePath);
    const selectedMode = input.mode ?? "auto";
    const resolvedMode = selectedMode === "auto"
      ? (
          input.limit && input.limit <= maxRawLines
            ? "raw_window"
            : isCodePath(filePath)
            ? "signature_map"
            : "summary_blocks"
        )
      : selectedMode;

    const cachePath = buildProjectionCachePath({
      filePath,
      mode: resolvedMode,
      mtimeMs: fileInfo.mtimeMs,
      size: fileInfo.size,
      offset: input.offset,
      limit: input.limit,
      focus: input.focus,
      maxLines: maxRawLines
    });

    if (!input.forceRefresh) {
      const cached = await readProjectionCache<{ payload: any }>(cachePath);
      if (cached) {
        return {
          ...cached.payload,
          fromCache: true
        };
      }
    }

    if (resolvedMode === "raw_window") {
      const requestedLimit = input.limit ?? maxRawLines;
      if (requestedLimit > maxRawLines) {
        return {
          mode: resolvedMode,
          status: "blocked_threshold",
          thresholdLines: maxRawLines,
          requestedLimit,
          requiresProjection: true,
          summary: `Raw read limit ${requestedLimit} exceeds configured threshold ${maxRawLines}. Use signature_map or summary_blocks.`
        };
      }

      const offset = Math.max(1, input.offset ?? 1);
      const content = await readFile(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(lines.length, startIdx + requestedLimit);
      const selectedLines = lines.slice(startIdx, endIdx);

      const payload = {
        mode: resolvedMode,
        status: "ok",
        filePath,
        startLine: startIdx + 1,
        endLine: endIdx,
        totalLines: lines.length,
        thresholdLines: maxRawLines,
        content: selectedLines.join("\n"),
        fromCache: false
      };
      await writeProjectionCache(cachePath, { payload, cachedAt: new Date().toISOString() });
      return payload;
    }

    if (resolvedMode === "signature_map") {
      const signatureMap = await getCodeSignatureMap({ filePath });
      const ollamaFallback = signatureMap.includes("[OLLAMA_BUSY_FALLBACK]");
      const payload = {
        mode: resolvedMode,
        status: ollamaFallback ? "requires_hosted_worker" : "ok",
        filePath,
        thresholdLines: maxRawLines,
        projection: signatureMap,
        requiresHostedWorker: ollamaFallback && useHostedFallback,
        hostedWorkerReason: ollamaFallback && useHostedFallback
          ? "Ollama unavailable; route this projection task to a cheap hosted worker."
          : undefined,
        fromCache: false
      };
      if (!ollamaFallback) {
        await writeProjectionCache(cachePath, { payload, cachedAt: new Date().toISOString() });
      }
      return payload;
    }

    const content = await readFile(absolutePath, "utf8");
    const blocks = summarizeBlocks(content, maxRawLines);
    const localModelUnavailable = options.runtime.usesLlmScoring === false;
    const payload = {
      mode: "summary_blocks",
      status: localModelUnavailable && useHostedFallback ? "requires_hosted_worker" : "ok",
      filePath,
      thresholdLines: maxRawLines,
      blockCount: blocks.length,
      projection: blocks.map((block) => `- ${block.summary}`).join("\n"),
      blocks,
      requiresHostedWorker: localModelUnavailable && useHostedFallback,
      hostedWorkerReason: localModelUnavailable && useHostedFallback
        ? "Ollama unavailable; route non-code block summarization to a cheap hosted worker."
        : undefined,
      fromCache: false
    };
    await writeProjectionCache(cachePath, { payload, cachedAt: new Date().toISOString() });
    return payload;
  }

  async function localDraftPlan(input: {
    task: string;
    forceTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto";
    milestones?: Array<{
      id: string;
      title: string;
      description: string;
      assignedTo?: string;
      status?: "pending" | "in_progress" | "completed" | "failed";
    }>;
  }): Promise<ActivePlan> {
    const { Orchestrator } = await import("@wrapper/agent-framework");
    const workspaceRoot = dirname(options.store.paths.root);

    let milestones: Array<{
      id: string;
      title: string;
      description: string;
      assignedTo?: string;
      status?: "pending" | "in_progress" | "completed" | "failed";
    }>;
    let tier: "tier1_local" | "tier2_hybrid" | "tier3_hosted";

    if (input.milestones && input.milestones.length > 0) {
      milestones = input.milestones;
      tier = input.forceTier && input.forceTier !== "auto" ? input.forceTier : "tier2_hybrid";
    } else {
      // 1. Plan epic using Orchestrator
      const orchestrator = new Orchestrator(workspaceRoot);
      const plannedMilestones = await orchestrator.planEpic(input.task, { forcedTier: input.forceTier });
      tier = orchestrator.lastPlanningTokens?.tier ?? "tier2_hybrid";
      milestones = plannedMilestones;
    }

    // 2. Initialize ActivePlan object
    const plan: ActivePlan = {
      version: 1,
      taskId: Math.random().toString(36).substring(2, 9),
      taskDescription: input.task,
      tier,
      status: "in_progress",
      milestones: milestones.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        status: (m.status as any) || ("pending" as const),
        assignedTo: m.assignedTo || "sub-agent"
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save initial plan
    await options.store.writeActivePlan(plan);
    return plan;
  }

  async function localExecuteMilestone(input: {
    taskId: string;
    milestoneId: string;
    context?: string;
    executionMode?: "auto" | "hosted_opt_out";
    optOutReason?: string;
  }): Promise<{
    success: boolean;
    filesModified: string[];
    logs: string;
    status: "completed" | "failed";
    validation?: ValidationRun;
    execution?: MilestoneExecution;
  }> {
    const { SubAgentDelegate, Orchestrator } = await import("@wrapper/agent-framework");
    const workspaceRoot = dirname(options.store.paths.root);

    // 1. Read existing plan
    const plan = await options.store.readActivePlan();
    if (!plan) {
      throw new Error("No active plan found");
    }
    if (plan.taskId !== input.taskId) {
      throw new Error(`Task ID mismatch: expected ${input.taskId}, got ${plan.taskId}`);
    }

    const milestone = plan.milestones.find((m) => m.id === input.milestoneId);
    if (!milestone) {
      throw new Error(`Milestone with ID ${input.milestoneId} not found in active plan`);
    }
    const policy = await options.store.readPolicy();

    // 2. Set milestone status to in_progress
    milestone.status = "in_progress";
    plan.updatedAt = new Date().toISOString();
    await options.store.writeActivePlan(plan);

    let success = false;
    let filesModified: string[] = [];
    let logs = "";
    let status: "completed" | "failed" = "failed";
    let validation: ValidationRun | undefined;
    let execution: MilestoneExecution | undefined;

    try {
      const plannerModel = detectPlannerModel();
      const orchestrator = new Orchestrator(workspaceRoot);
      const localExecutionPlan = await buildLocalExecutionPlan({
        determineComplexityTier: (epic) => orchestrator.determineComplexityTier(epic),
        title: milestone.title,
        description: milestone.description,
        context: input.context
      });

      if (input.executionMode === "hosted_opt_out") {
        const optOutReason = input.optOutReason?.trim();
        if (!optOutReason) {
          throw new Error("executionMode=hosted_opt_out requires a non-empty optOutReason.");
        }

        success = true;
        filesModified = [];
        logs = `Execution opted out to hosted/manual path: ${optOutReason}`;
        validation = {
          attempted: false,
          success: true,
          source: "none",
          skippedReason: "Validation skipped because milestone execution was explicitly opted out to hosted/manual mode."
        };
        execution = {
          route: "hosted_opt_out",
          complexityTier: localExecutionPlan.complexityTier,
          plannerModel,
          executionSource: "hosted_manual",
          optOutReason
        };
      } else {
        const subAgent = new SubAgentDelegate(workspaceRoot);
        const executionLogs: string[] = [];
        const modifiedFiles = new Set<string>();
        let localExecutionSuccess = true;

        execution = {
          route: localExecutionPlan.route,
          complexityTier: localExecutionPlan.complexityTier,
          plannerModel,
          executionSource: "local_subagent",
          microTaskCount: localExecutionPlan.microTasks.length,
          decompositionDepth: localExecutionPlan.decompositionDepth
        };

        for (let index = 0; index < localExecutionPlan.microTasks.length; index += 1) {
          const microTask = localExecutionPlan.microTasks[index];
          const microTaskPrompt = [
            `${milestone.title}: ${milestone.description}`,
            `Micro-task ${index + 1}/${localExecutionPlan.microTasks.length}: ${microTask}`,
            input.context ? `Global context: ${input.context}` : ""
          ]
            .filter(Boolean)
            .join("\n\n");

          const brief = await buildAgentBrief({
            task: microTaskPrompt,
            subAgent: true
          });

          const result = await subAgent.executeTask(brief);
          for (const file of result.filesModified || []) {
            modifiedFiles.add(file);
          }
          executionLogs.push(
            `[micro-task ${index + 1}/${localExecutionPlan.microTasks.length}]`,
            result.logs || ""
          );

          if (!result.success) {
            localExecutionSuccess = false;
            executionLogs.push(`Micro-task ${index + 1} failed. Aborting remaining micro-tasks.`);
            break;
          }
        }

        success = localExecutionSuccess;
        filesModified = Array.from(modifiedFiles);
        logs = executionLogs.filter(Boolean).join("\n").trim();

        if (!success) {
          validation = {
            attempted: false,
            success: false,
            source: "none",
            skippedReason: "Skipped because milestone execution failed before validation."
          };
        } else if (!policy.autonomous.autoValidate) {
          validation = {
            attempted: false,
            success: true,
            source: "none",
            skippedReason: "Validation skipped because policy autonomous.autoValidate is false."
          };
        } else {
          const resolution = await resolveValidationCommand(workspaceRoot, policy);
          if (resolution) {
            validation = await runValidationCommand(workspaceRoot, resolution);
            logs = [logs, "Validation output:", validation.output ?? ""]
              .filter(Boolean)
              .join("\n")
              .trim();
            if (!validation.success) {
              success = false;
            }
          } else {
            validation = {
              attempted: false,
              success: true,
              source: "none",
              skippedReason: "No project validation command could be detected."
            };
            logs = [logs, "Validation skipped: no project validation command detected."]
              .filter(Boolean)
              .join("\n")
              .trim();
          }
        }
      }

      status = success ? "completed" : "failed";
    } catch (err: any) {
      success = false;
      filesModified = [];
      logs = `Error executing local subagent: ${err?.message || String(err)}`;
      status = "failed";
      validation = {
        attempted: false,
        success: false,
        source: "none",
        skippedReason: "Validation skipped because subagent execution raised an error."
      };
      execution = {
        route: "direct_local",
        complexityTier: "tier2_hybrid",
        plannerModel: detectPlannerModel(),
        executionSource: "local_subagent"
      };
    }

    // 4. Update milestone status
    milestone.status = status;
    milestone.result = {
      success,
      filesModified,
      logs,
      validation,
      execution
    };

    // 5. Update plan-level status
    const hasFailed = plan.milestones.some((m) => m.status === "failed");
    const allCompleted = plan.milestones.every((m) => m.status === "completed");

    if (hasFailed) {
      plan.status = "failed";
    } else if (allCompleted) {
      plan.status = "completed";
    } else {
      plan.status = "in_progress";
    }

    const hygieneNotes: string[] = [];

    if (plan.status === "in_progress" && policy.hygiene.enabled) {
      const completedMilestones = plan.milestones.filter((m) => m.status === "completed").length;
      const trackedFiles = getPlanModifiedFiles(plan);
      let changedLines = 0;
      try {
        changedLines = await estimateChangedLines(workspaceRoot, trackedFiles);
      } catch {
        changedLines = 0;
      }
      const milestonesThreshold = policy.hygiene.promptThresholds.milestones;
      const linesThreshold = policy.hygiene.promptThresholds.changedLines;
      if (completedMilestones >= milestonesThreshold || changedLines >= linesThreshold) {
        const thresholdNote = `[HYGIENE_PROMPT] Consider running /lcw-docs and /lcw-git. Completed milestones=${completedMilestones}/${plan.milestones.length}, changedLines=${changedLines}.`;
        logs = [logs, thresholdNote].filter(Boolean).join("\n");
      }
    }

    if (plan.status === "completed" && policy.hygiene.enabled) {
      try {
        let docsUpdated: string[] = [];
        if (policy.hygiene.autoDocUpdate) {
          const docsResult = await localRefreshDocs({
            taskId: plan.taskId,
            scope: policy.hygiene.docScope,
            apply: true
          });
          docsUpdated = docsResult.updatedFiles;
          hygieneNotes.push(docsResult.summary);
        }

        if (policy.hygiene.autoCommitOnPlanComplete) {
          const gitResult = await localGitHygiene({
            taskId: plan.taskId,
            mode: policy.hygiene.commitMode,
            includeFiles: docsUpdated,
            commit: true
          });
          hygieneNotes.push(gitResult.summary);
          if (gitResult.pushRequiresApproval) {
            hygieneNotes.push("Push is pending explicit user approval.");
          }
        }
      } catch (err: any) {
        hygieneNotes.push(`Hygiene automation skipped due to error: ${err?.message || String(err)}`);
      }
      if (hygieneNotes.length > 0) {
        logs = [logs, ...hygieneNotes].filter(Boolean).join("\n");
      }
    }

    milestone.result.logs = logs;
    plan.updatedAt = new Date().toISOString();
    await options.store.writeActivePlan(plan);

    // 6. Trigger updateContextHandoff() ONLY when the final plan completes or fails
    if (plan.status === "completed" || plan.status === "failed") {
      const allModifiedFiles = plan.milestones
        .flatMap((m) => m.result?.filesModified || []);

      await updateContextHandoff({
        summary: `Completed delegated local task: "${plan.taskDescription}". Tier: ${plan.tier}. Status: ${plan.status}.`,
        currentFocus: plan.status === "completed" ? "Delegated task succeeded. Ready for verification." : "Delegated task failed. Check active-plan.json logs.",
        constraints: [],
        nextSteps: plan.status === "completed"
          ? [
              "Review autonomously modified files: " + allModifiedFiles.join(", "),
              "Run /lcw-docs for any additional documentation polish if needed.",
              "Run /lcw-git to inspect/commit remaining changes if auto commit was skipped.",
              "Request explicit approval before any git push."
            ]
          : ["Triage failures in active-plan.json logs."]
      });
    }

    return {
      success,
      filesModified,
      logs,
      status,
      validation,
      execution
    };
  }

  async function delegateTaskToLocal(input: {
    task: string;
    forceTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto";
  }): Promise<ActivePlan> {
    const plan = await localDraftPlan(input);

    for (const milestone of plan.milestones) {
      const result = await localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: milestone.id
      });

      if (result.status === "failed") {
        break;
      }
    }

    return (await options.store.readActivePlan()) || plan;
  }

  async function localCompactConversation(input: {
    history: CompactHistoryMessage[];
    focus?: string;
  }): Promise<{
    summary: string;
    cleanSlatePrompt: string;
    status: "synced" | "failed_validation" | "failed_write";
    handoffSynced: boolean;
    failureReason?: string;
  }> {
    const handoff = await options.store.readHandoff();
    const focusContext = input.focus
      ? `Ensure you highly prioritize and preserve details regarding: "${input.focus}"`
      : "Preserve all key architectural decisions, file structures, and milestone agreements.";

    const formattedHistory = input.history
      .map((msg) => `[${msg.role.toUpperCase()}]: ${msg.content}`)
      .join("\n\n");

    const compactionPrompt = [
      `You are an expert context compaction engine.`,
      `Your task is to take the following bloated chat conversation history and compress it into a highly dense, high-density, technical architectural summary.`,
      ``,
      `--- START OF BLOATED CHAT CONVERSATION HISTORY ---`,
      formattedHistory,
      `--- END OF BLOATED CHAT CONVERSATION HISTORY ---`,
      ``,
      `Guidelines for compaction:`,
      `1. Classify details into four distinct high-density buckets:`,
      `   - **State Locked-in**: completed files, passing test targets, and verified features.`,
      `   - **Current Focus**: the exact milestone or active task we are in the middle of solving.`,
      `   - **Active Decisions**: technical choices, class parameters, schemas, or specific logic reasons (Why things were built this way).`,
      `   - **Key Files**: the 3-8 most important file paths that were actively discussed, modified, or referenced. Format each as a relative path followed by " -- " and a 5-10 word description.`,
      `2. ${focusContext}`,
      `3. Keep the output extremely clear, professional, and dense. Eliminate fluff, greetings, and conversational fillers.`,
      `4. You MUST follow this exact markdown template and heading order (exactly 4 headings, no extra headings, no renamed headings):`,
      `### State Locked-in`,
      `- <bullet points only>`,
      ``,
      `### Current Focus`,
      `- <bullet points only>`,
      ``,
      `### Active Decisions`,
      `- <bullet points only>`,
      ``,
      `### Key Files`,
      `- <relative/path/to/file.ts -- brief 5-10 word description>`,
      ``,
      `Respond with your complete compacted markdown summary. No json wrapper, no markdown ticks around the whole response.`
    ].join("\n");

    let summary = "Local fallback history summary. Context is saved to disk.";
    let summaryForPrompt = summary;
    let failureReason: string | undefined;
    let status: "synced" | "failed_validation" | "failed_write" = "failed_validation";
    let handoffSynced = false;
    if (options.runtime.usesLlmScoring === false) {
      summary = "[OLLAMA_BUSY_FALLBACK] Ollama is not active or configured. Please perform this operation using your hosted agent (Claude) directly in the chat.";
    } else {
      try {
        if (options.runtime.generate) {
          summary = await options.runtime.generate({
            system: "You are a precise technical summarization engine. Synthesize all decisions, states, and active focuses into dense markdown.",
            prompt: compactionPrompt
          });
        }
      } catch (err: any) {
        // Fallback if local LLM is offline
        summary = `[OLLAMA_BUSY_FALLBACK] Ollama is currently offline or raised an error: ${err?.message || String(err)}`;
      }
    }
    summaryForPrompt = summary;

    if (summary.includes("[OLLAMA_BUSY_FALLBACK]")) {
      const fallbackTopics = handoff.activeContext.nextSteps.length > 0
        ? handoff.activeContext.nextSteps
        : [handoff.activeContext.currentFocus];

      const cleanSlatePrompt = [
        `--- CONTEXT HANDOFF (read-only memory, not a task list) ---`,
        ``,
        `## Project`,
        `${handoff.project.name}: ${handoff.project.goal}`,
        ``,
        `## State (verified)`,
        handoff.activeContext.summary,
        ``,
        `## Pending Topics (awaiting user direction, do NOT execute)`,
        fallbackTopics.map((t) => `- ${t}`).join("\n"),
        ``,
        `NOTE: Ollama was offline during compaction. Key Files and Architecture Decisions were not generated. The above state is from the last synced handoff.`,
        ``,
        `--- END CONTEXT HANDOFF ---`,
        ``,
        `## Behavioral Contract (MANDATORY)`,
        `You have received a context handoff from a previous session.`,
        `Your ONLY permitted actions right now:`,
        `1. Read and internalize the context above silently.`,
        `2. Respond with a 2-3 sentence greeting confirming you understand the project state and current focus.`,
        `3. STOP. Wait for the user to give you explicit instructions.`,
        ``,
        `FORBIDDEN on resumption:`,
        `- Do NOT execute, implement, or modify anything.`,
        `- Do NOT run searches, read files, or call any tools.`,
        `- Do NOT interpret "Pending Topics" as work to begin.`,
        `- Do NOT ask clarifying questions about the codebase.`,
        `- Do NOT call get_context_handoff -- all context is already above.`
      ].join("\n");

      return {
        summary,
        cleanSlatePrompt,
        status: "failed_validation",
        handoffSynced: false,
        failureReason: "Ollama is currently busy or offline."
      };
    }

    const parseCompaction = (candidate: string) =>
      isValidCompactionSummary(candidate) ? parseCompactionSummaryContract(candidate) : null;

    let parsed = parseCompaction(summary);
    if (!parsed && options.runtime.generate) {
      try {
        const repairPrompt = [
          "Rewrite the following compaction output into the exact required markdown contract.",
          "Do not add commentary. Preserve meaning while fixing structure.",
          "",
          "Required format (exactly 4 headings in this order):",
          "### State Locked-in",
          "- ...",
          "",
          "### Current Focus",
          "- ...",
          "",
          "### Active Decisions",
          "- ...",
          "",
          "### Key Files",
          "- relative/path/to/file.ext -- brief description",
          "",
          "--- INVALID OUTPUT START ---",
          summary,
          "--- INVALID OUTPUT END ---"
        ].join("\n");

        const repairedSummary = await options.runtime.generate({
          system: "You are a strict markdown contract rewriter.",
          prompt: repairPrompt
        });
        parsed = parseCompaction(repairedSummary);
        if (parsed) {
          summary = repairedSummary;
          summaryForPrompt = repairedSummary;
        }
      } catch {
        // Keep original parse failure reason
      }
    }

    if (!parsed) {
      failureReason = "Compaction output failed strict markdown contract validation after one repair attempt.";
      status = "failed_validation";
      handoffSynced = false;
    } else {
      const cleanSummary = [
        `### State Locked-in`,
        parsed.stateLockedIn,
        "",
        `### Active Decisions`,
        parsed.activeDecisions
      ].join("\n").trim();

      const focusLines = parsed.currentFocus
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^[-*]\s*/, ""))
        .filter(Boolean);

      const finalFocus = focusLines[0] ?? "Resume session with zero token overhead.";
      const nextSteps =
        focusLines.length > 0
          ? focusLines
          : ["Verify slash commands and current state.", "Resume engineering goals."];

      try {
        const updatedHandoff = await updateContextHandoff(
          {
            summary: cleanSummary,
            currentFocus: finalFocus,
            constraints: handoff.activeContext.constraints,
            nextSteps
          },
          { compactSync: true }
        );
        summaryForPrompt = [
          updatedHandoff.activeContext.summary,
          "",
          "### Current Focus",
          updatedHandoff.activeContext.currentFocus
        ]
          .join("\n")
          .trim();
        handoffSynced = true;
        status = "synced";
      } catch {
        failureReason = "Compaction summary passed validation but handoff write failed.";
        status = "failed_write";
        handoffSynced = false;
      }
    }

    const keyFilesSection = parsed?.keyFiles ?? "";
    const pendingTopics = parsed
      ? parsed.currentFocus
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/^[-*]\s*/, ""))
          .filter(Boolean)
      : handoff.activeContext.nextSteps;

    const cleanSlatePrompt = [
      `--- CONTEXT HANDOFF (read-only memory, not a task list) ---`,
      ``,
      `## Project`,
      `${handoff.project.name}: ${handoff.project.goal}`,
      ``,
      `## State (verified)`,
      parsed?.stateLockedIn ?? summaryForPrompt,
      ``,
      `## Architecture Decisions (rationale, not tasks)`,
      parsed?.activeDecisions ?? "",
      ``,
      `## Key Files (do NOT search for these, paths are exact)`,
      keyFilesSection,
      ``,
      `## Pending Topics (awaiting user direction, do NOT execute)`,
      pendingTopics.map((t) => `- ${t}`).join("\n"),
      ``,
      `--- END CONTEXT HANDOFF ---`,
      ``,
      `## Behavioral Contract (MANDATORY)`,
      `You have received a context handoff from a previous session.`,
      `Your ONLY permitted actions right now:`,
      `1. Read and internalize the context above silently.`,
      `2. Respond with a 2-3 sentence greeting confirming you understand the project state and current focus.`,
      `3. STOP. Wait for the user to give you explicit instructions.`,
      ``,
      `FORBIDDEN on resumption:`,
      `- Do NOT execute, implement, or modify anything.`,
      `- Do NOT run searches, read files, or call any tools.`,
      `- Do NOT interpret "Pending Topics" as work to begin.`,
      `- Do NOT ask clarifying questions about the codebase.`,
      `- Do NOT call get_context_handoff -- all context is already above.`
    ].join("\n");

    return {
      summary: summaryForPrompt,
      cleanSlatePrompt,
      status,
      handoffSynced,
      ...(failureReason ? { failureReason } : {})
    };
  }

  async function getCodeSignatureMap(input: { filePath: string }): Promise<string> {
    if (options.runtime.usesLlmScoring === false) {
      return `[OLLAMA_BUSY_FALLBACK] Ollama is not active or configured. Please perform this operation (e.g. compaction or mapping) using your hosted agent (Claude) directly in the chat.`;
    }

    const { readFile, stat, readdir } = await import("node:fs/promises");
    const { relative, extname } = await import("node:path");
    const workspaceRoot = dirname(options.store.paths.root);
    const absolutePath = join(workspaceRoot, input.filePath);

    let isDir = false;
    try {
      const s = await stat(absolutePath);
      isDir = s.isDirectory();
    } catch (err: any) {
      throw new Error(`Failed to access path ${input.filePath}: ${err?.message || String(err)}`);
    }

    const filesToProcess: string[] = [];
    if (isDir) {
      async function walk(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = join(dir, entry.name);
          const relPath = relative(workspaceRoot, entryPath);

          // Standard excludes
          if (
            entry.name.startsWith(".") ||
            ["node_modules", "dist", "build", "coverage", ".wrapper", "temp", "tmp"].includes(entry.name)
          ) {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(entryPath);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if ([".ts", ".tsx", ".js", ".jsx", ".py"].includes(ext)) {
              filesToProcess.push(relPath);
            }
          }
        }
      }
      await walk(absolutePath);
    } else {
      filesToProcess.push(input.filePath);
    }

    if (filesToProcess.length === 0) {
      return `${input.filePath} (No indexable code files detected)`;
    }

    // Limit to 10 files to keep batch compaction speedy
    const MAX_BATCH_FILES = 10;
    const processingList = filesToProcess.slice(0, MAX_BATCH_FILES);
    const overLimitWarning = filesToProcess.length > MAX_BATCH_FILES
      ? `\n\n⚠️  Showing first ${MAX_BATCH_FILES} of ${filesToProcess.length} total files. Use narrower directory scopes to see specific targets.`
      : "";

    const fileResults: string[] = [];

    for (const relPath of processingList) {
      const fileAbsPath = join(workspaceRoot, relPath);
      let content = "";
      try {
        content = await readFile(fileAbsPath, "utf8");
      } catch {
        continue;
      }

      // 1. Static body-stripping signature parser
      const parsedSignatures = parseSignatures(content, relPath);
      if (parsedSignatures.length === 0) {
        fileResults.push(`${relPath} (No class, method, or function signatures detected statically)`);
        continue;
      }

      // 2. Local LLM descriptive summarization
      const formattedSigs = parsedSignatures
        .map((sig) => `Type: ${sig.type}, Name: ${sig.name}, Signature: \`${sig.signature}\`, Line: ${sig.line}`)
        .join("\n");

      const descriptionPrompt = [
        `You are a high-performance codebase signature explainer.`,
        `For each of the statically extracted raw code signatures below, write a brief, extremely dense 5-to-10 word summary of what its business logic achieves.`,
        ``,
        `File path: ${relPath}`,
        `Raw signatures:`,
        formattedSigs,
        ``,
        `Return ONLY valid JSON matching this structure:`,
        `{`,
        `  "fileSummary": "Dense 10-word description of the file's overall global scope purpose",`,
        `  "signatures": {`,
        `    "nameOfSignature": "Brief 5-10 word business logic summary",`,
        `    ...`,
        `  }`,
        `}`,
        `Do not output markdown code ticks, conversational fillers, or explanations. Respond with pure JSON only.`
      ].join("\n");

      let sigMap: Record<string, string> = {};
      let fileSummary = "Codebase module containing implementation logic.";
      try {
        if (options.runtime.generate) {
          const response = await options.runtime.generate({
            system: "You are a precise JSON-only code summary engine. Explain function signatures in 5-10 words.",
            prompt: descriptionPrompt
          });
          if (response.includes("[OLLAMA_BUSY_FALLBACK]")) {
            return `[OLLAMA_BUSY_FALLBACK] Ollama is currently busy or offline. Please perform this operation (e.g. compaction or mapping) using your hosted agent (Claude) directly in the chat.`;
          }
          // Simple JSON parser
          const cleanResponse = response.substring(response.indexOf("{"), response.lastIndexOf("}") + 1);
          const parsed = JSON.parse(cleanResponse);
          if (parsed.fileSummary) fileSummary = parsed.fileSummary;
          if (parsed.signatures) sigMap = parsed.signatures;
        }
      } catch (err: any) {
        return `[OLLAMA_BUSY_FALLBACK] Ollama is currently offline or raised an error: ${err?.message || String(err)}`;
      }

      // 3. Render Python-Indented Tree layout
      const lines: string[] = [];
      lines.push(`${relPath} (Global: ${fileSummary})`);

      for (const sig of parsedSignatures) {
        const summaryText = sigMap[sig.name] || "Local signature definition.";
        if (sig.type === "class") {
          lines.push(`  class ${sig.name} (${summaryText})`);
        } else if (sig.type === "method") {
          lines.push(`    method ${sig.signature.replace(/^\s*(public|private|protected)\s+/, "")} --> ${summaryText}`);
        } else {
          lines.push(`  ${sig.signature} --> ${summaryText}`);
        }
      }
      fileResults.push(lines.join("\n"));
    }

    return fileResults.join("\n\n") + overLimitWarning;
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
    diagnoseSetup,
    localDraftPlan,
    localExecuteMilestone,
    localFileRead,
    localRefreshDocs,
    localGitHygiene,
    delegateTaskToLocal,
    localCompactConversation,
    getCodeSignatureMap
  };
}
