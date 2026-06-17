import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import {
  ContextHandoff,
  ContextHandoffSchema,
  DecisionLog,
  DecisionLogSchema,
  PromptQuality,
  WorkspacePolicy,
  WorkspacePolicySchema,
  AgentBrief,
  ActivePlan,
  ActivePlanSchema
} from "@wrapper/schemas";

export type InitialContext = {
  projectName: string;
  projectGoal: string;
};

export type HandoffUpdate = ContextHandoff["activeContext"];

export type NewDecision = {
  title: string;
  rationale: string;
};

export type ContextStore = ReturnType<typeof createContextStore>;

const defaultPolicy: WorkspacePolicy = {
  version: 1,
  indexing: {
    enabled: true,
    include: ["**/*"],
    exclude: [".env", ".env.*", "node_modules/**", ".git/**", ".wrapper/index/**", ".wrapper/runs/**"],
    embedModel: "nomic-embed-text",
    maxFileBytes: 256000,
    maxFiles: 500,
    chunkCharSize: 1800,
    retrievalTopK: 8
  },
  privacy: {
    allowPromptLogs: false,
    redactSecrets: true
  },
  promptHistory: {
    enabled: true,
    directory: ".wrapper/prompts",
    maxEntries: 20
  },
  agentBrief: {
    enabled: true,
    directory: ".wrapper/runs",
    maxEntries: 10
  },
  autonomous: {
    interactiveApproval: true,
    maxTaskTurns: 5,
    maxFilesModified: 10,
    forcedTier: "auto",
    autoValidate: true,
    autoRollbackOnFailure: false
  },
  contextManagement: {
    zeroHistoryReset: true,
    resetStrategy: "clear_history"
  }
};

export function createContextStore(workspaceRoot: string) {
  const root = join(workspaceRoot, ".wrapper");
  const currentYamlPath = join(root, "context/current.yaml");
  const handoffMarkdownPath = join(root, "context/handoff.md");
  const decisionsPath = join(root, "context/decisions.yaml");
  const policyPath = join(root, "policy.yaml");
  const promptHistoryPath = join(root, "prompts");
  const activePlanPath = join(root, "runs/active-plan.json");

  async function initialize(input: InitialContext): Promise<void> {
    const now = new Date().toISOString();
    await mkdir(join(root, "context"), { recursive: true });
    await mkdir(join(root, "specs"), { recursive: true });
    await mkdir(join(root, "runs"), { recursive: true });
    await mkdir(join(root, "index"), { recursive: true });
    await mkdir(promptHistoryPath, { recursive: true });

    const handoff: ContextHandoff = ContextHandoffSchema.parse({
      version: 1,
      updatedAt: now,
      project: {
        name: input.projectName,
        goal: input.projectGoal
      },
      activeContext: {
        summary: "Local context wrapper initialized.",
        currentFocus: "Capture rough prompts, context, and decisions for Cursor-assisted work.",
        constraints: ["Local sidecar only", "Do not log raw secrets"],
        nextSteps: ["Run prompt refinement", "Update context handoff"]
      },
      signals: {
        confidence: 0.6,
        staleAfterMinutes: 45
      }
    });

    const decisions: DecisionLog = DecisionLogSchema.parse({
      version: 1,
      decisions: []
    });

    await writeYaml(currentYamlPath, handoff);
    await writeMarkdown(handoffMarkdownPath, renderHandoffMarkdown(handoff));
    await writeYaml(decisionsPath, decisions);
    await writeYaml(policyPath, defaultPolicy);
  }

  async function readHandoff(): Promise<ContextHandoff> {
    return ContextHandoffSchema.parse(parse(await readFile(currentYamlPath, "utf8")));
  }

  async function readPolicy(): Promise<WorkspacePolicy> {
    const parsed = parse(await readFile(policyPath, "utf8")) as Partial<WorkspacePolicy> | undefined;
    return WorkspacePolicySchema.parse({
      ...defaultPolicy,
      ...parsed,
      indexing: {
        ...defaultPolicy.indexing,
        ...parsed?.indexing
      },
      privacy: {
        ...defaultPolicy.privacy,
        ...parsed?.privacy
      },
      promptHistory: {
        ...defaultPolicy.promptHistory,
        ...parsed?.promptHistory
      },
      agentBrief: {
        ...defaultPolicy.agentBrief,
        ...parsed?.agentBrief
      },
      autonomous: {
        ...defaultPolicy.autonomous,
        ...parsed?.autonomous
      },
      contextManagement: {
        ...defaultPolicy.contextManagement,
        ...parsed?.contextManagement
      }
    });
  }

  async function ensurePolicy(): Promise<WorkspacePolicy> {
    const policy = await readPolicy();
    await writeYaml(policyPath, policy);
    return policy;
  }

  async function readDecisions(): Promise<DecisionLog> {
    return DecisionLogSchema.parse(parse(await readFile(decisionsPath, "utf8")));
  }

  async function updateHandoff(activeContext: HandoffUpdate): Promise<ContextHandoff> {
    const existing = await readHandoff();
    const updated = ContextHandoffSchema.parse({
      ...existing,
      updatedAt: new Date().toISOString(),
      activeContext
    });

    await writeYaml(currentYamlPath, updated);
    await writeMarkdown(handoffMarkdownPath, renderHandoffMarkdown(updated));
    return updated;
  }

  async function addDecision(input: NewDecision): Promise<DecisionLog> {
    const existing = await readDecisions();
    const updated = DecisionLogSchema.parse({
      version: 1,
      decisions: [
        {
          id: `dec-${randomUUID()}`,
          madeAt: new Date().toISOString(),
          title: input.title,
          rationale: input.rationale,
          status: "accepted"
        },
        ...existing.decisions
      ]
    });

    await writeYaml(decisionsPath, updated);
    return updated;
  }

  async function recordPromptResult(result: PromptQuality, maxEntries?: number): Promise<string> {
    const policy = await readPolicy();
    if (!policy.promptHistory.enabled) {
      return "";
    }

    const historyDir = join(workspaceRoot, policy.promptHistory.directory);
    await mkdir(historyDir, { recursive: true });
    const filename = `${fileSafeTimestamp(result.createdAt)}-score-${result.score}.md`;
    const historyFile = join(historyDir, filename);

    await writeMarkdown(historyFile, renderPromptMarkdown(result));
    await prunePromptHistory(maxEntries ?? policy.promptHistory.maxEntries);
    return historyFile;
  }

  async function recordAgentBrief(result: AgentBrief, maxEntries?: number): Promise<string> {
    const policy = await readPolicy();
    if (!policy.agentBrief.enabled) {
      return "";
    }

    const briefDir = join(workspaceRoot, policy.agentBrief.directory);
    await mkdir(briefDir, { recursive: true });
    const filename = `${fileSafeTimestamp(result.createdAt)}-brief.md`;
    const briefFile = join(briefDir, filename);

    await writeMarkdown(briefFile, result.briefMarkdown);
    await pruneAgentBriefHistory(maxEntries ?? policy.agentBrief.maxEntries);
    return briefFile;
  }

  async function listPromptHistory(): Promise<string[]> {
    try {
      const entries = await readdir(promptHistoryPath);
      return entries
        .filter((entry) => entry.endsWith(".md"))
        .sort()
        .map((entry) => join(promptHistoryPath, entry));
    } catch {
      return [];
    }
  }

  async function listAgentBriefHistory(): Promise<string[]> {
    const policy = await readPolicy();
    const briefDir = join(workspaceRoot, policy.agentBrief.directory);
    try {
      const entries = await readdir(briefDir);
      return entries
        .filter((entry) => entry.endsWith(".md"))
        .sort()
        .map((entry) => join(briefDir, entry));
    } catch {
      return [];
    }
  }

  async function prunePromptHistory(maxEntries: number): Promise<void> {
    const files = await listPromptHistory();
    const overflow = files.length - maxEntries;
    if (overflow <= 0) {
      return;
    }

    await Promise.all(files.slice(0, overflow).map((file) => rm(file, { force: true })));
  }

  async function pruneAgentBriefHistory(maxEntries: number): Promise<void> {
    const files = await listAgentBriefHistory();
    const overflow = files.length - maxEntries;
    if (overflow <= 0) {
      return;
    }

    await Promise.all(files.slice(0, overflow).map((file) => rm(file, { force: true })));
  }

  async function readActivePlan(): Promise<ActivePlan | null> {
    try {
      const content = await readFile(activePlanPath, "utf8");
      return ActivePlanSchema.parse(JSON.parse(content));
    } catch {
      return null;
    }
  }

  async function writeActivePlan(plan: ActivePlan): Promise<void> {
    await atomicWrite(activePlanPath, JSON.stringify(plan, null, 2));
  }

  return {
    paths: {
      root,
      currentYamlPath,
      handoffMarkdownPath,
      decisionsPath,
      policyPath,
      activePlanPath,
      indexDir: join(root, "index"),
      runsDir: join(root, "runs")
    },
    initialize,
    readHandoff,
    readPolicy,
    ensurePolicy,
    readDecisions,
    updateHandoff,
    addDecision,
    recordPromptResult,
    recordAgentBrief,
    listPromptHistory,
    listAgentBriefHistory,
    readActivePlan,
    writeActivePlan
  };
}

async function writeYaml(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, stringify(value));
}

async function writeMarkdown(path: string, value: string): Promise<void> {
  await atomicWrite(path, value);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
}

function renderHandoffMarkdown(handoff: ContextHandoff): string {
  return [
    "# Context Handoff",
    "",
    `Updated: ${handoff.updatedAt}`,
    "",
    `## ${handoff.project.name}`,
    "",
    handoff.project.goal,
    "",
    "## Active Context",
    "",
    handoff.activeContext.summary,
    "",
    `Current focus: ${handoff.activeContext.currentFocus}`,
    "",
    "## Constraints",
    "",
    ...handoff.activeContext.constraints.map((constraint) => `- ${constraint}`),
    "",
    "## Next Steps",
    "",
    ...handoff.activeContext.nextSteps.map((step) => `- ${step}`),
    ""
  ].join("\n");
}

function renderPromptMarkdown(result: PromptQuality): string {
  return [
    "---",
    `createdAt: ${result.createdAt}`,
    `score: ${result.score}`,
    ...(result.scoringMethod ? [`scoringMethod: ${result.scoringMethod}`] : []),
    ...(typeof result.readyForImplementation === "boolean"
      ? [`readyForImplementation: ${result.readyForImplementation}`]
      : []),
    "---",
    "",
    "# Prompt Refinement",
    "",
    "## Original Prompt",
    "",
    result.prompt,
    "",
    "## Missing Context",
    "",
    ...(result.missingContext.length > 0 ? result.missingContext.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Recommended Questions",
    "",
    ...(result.recommendedQuestions.length > 0
      ? result.recommendedQuestions.map((question) => `- ${question}`)
      : ["- none"]),
    "",
    "## Refined Prompt",
    "",
    result.refinedPrompt,
    ""
  ].join("\n");
}

function fileSafeTimestamp(value: string): string {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}
