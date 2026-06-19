#!/usr/bin/env node
/**
 * Isolated lcw-auto benchmark runner.
 * Uses temp workspaces only — never touches the Wrapper repo under test.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";
import { createRuntimeGenerator } from "./runtime-generator.js";
import { setupWorkspace } from "./setup-workspace.js";

type OllamaCallMetric = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  promptEvalMs: number;
  evalMs: number;
  totalMs: number;
  promptTokPerSec: number;
  outputTokPerSec: number;
};

type BenchmarkTask = {
  id: string;
  epic: string;
  forceTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto";
  source: string;
};

/** Programming tasks used elsewhere in this repo for autonomous / framework benchmarking. */
const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: "B01-tier1-typo",
    epic: "Fix typo in button comment",
    forceTier: "tier1_local",
    source: "packages/agent-framework/src/agent-framework.test.ts (tier routing)"
  },
  {
    id: "B02-emitter",
    epic: "Build safe event emitter with transaction rollback",
    source: "packages/eval-harness/src/eval-harness.test.ts + agent-framework tests"
  },
  {
    id: "B03-framework-epic",
    epic: "Build safe event emitter with error logging and transaction rollback support",
    source: "packages/eval-harness/src/framework-judge-cli.ts"
  }
];

const ollamaModel = process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx";
const ollamaHost = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const ollamaNumCtx = Number.parseInt(process.env.WRAPPER_OLLAMA_NUM_CTX ?? "65536", 10);

const callMetrics: OllamaCallMetric[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isOllamaGenerate = url.includes("/api/generate");
  const startedAt = Date.now();
  const response = await originalFetch(input, init);

  if (isOllamaGenerate && response.ok) {
    const cloned = response.clone();
    try {
      const payload = (await cloned.json()) as {
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
        prompt_eval_duration?: number;
        eval_duration?: number;
        total_duration?: number;
      };
      const promptTokens = payload.prompt_eval_count ?? 0;
      const completionTokens = payload.eval_count ?? 0;
      const promptEvalMs = (payload.prompt_eval_duration ?? 0) / 1_000_000;
      const evalMs = (payload.eval_duration ?? 0) / 1_000_000;
      const totalMs = (payload.total_duration ?? Date.now() - startedAt) / 1_000_000;

      callMetrics.push({
        model: payload.model ?? ollamaModel,
        promptTokens,
        completionTokens,
        promptEvalMs,
        evalMs,
        totalMs,
        promptTokPerSec: promptEvalMs > 0 ? promptTokens / (promptEvalMs / 1000) : 0,
        outputTokPerSec: evalMs > 0 ? completionTokens / (evalMs / 1000) : 0
      });
    } catch {
      // Ignore metric parse failures; response still returned to caller.
    }
  }

  return response;
};

async function seedAutonomousFixture(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify(
      {
        name: "lcw-auto-benchmark-fixture",
        version: "1.0.0",
        private: true,
        type: "module"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(join(workspaceRoot, "src/index.ts"), "export const label = 'buton';\n", "utf8");
}

function summarizeMetrics(metrics: OllamaCallMetric[]) {
  const promptTokens = metrics.reduce((sum, m) => sum + m.promptTokens, 0);
  const completionTokens = metrics.reduce((sum, m) => sum + m.completionTokens, 0);
  const promptEvalMs = metrics.reduce((sum, m) => sum + m.promptEvalMs, 0);
  const evalMs = metrics.reduce((sum, m) => sum + m.evalMs, 0);
  const totalMs = metrics.reduce((sum, m) => sum + m.totalMs, 0);

  return {
    ollamaCalls: metrics.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    promptEvalMs: round(promptEvalMs),
    evalMs: round(evalMs),
    totalMs: round(totalMs),
    avgPromptTokPerSec: promptEvalMs > 0 ? round(promptTokens / (promptEvalMs / 1000)) : 0,
    avgOutputTokPerSec: evalMs > 0 ? round(completionTokens / (evalMs / 1000)) : 0
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function runTask(task: BenchmarkTask) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "lcw-auto-bench-"));
  const metricsStart = callMetrics.length;
  const startedAt = Date.now();

  try {
    await seedAutonomousFixture(workspaceRoot);
    await setupWorkspace(workspaceRoot);

    const store = createContextStore(workspaceRoot);
    const runtime = createRuntimeGenerator({ mode: "ollama" });
    const tools = createWrapperTools({ store, runtime });

    const plan = await tools.localDraftPlan({
      task: task.epic,
      forceTier: task.forceTier
    });

    const firstMilestone = plan.milestones[0];
    if (!firstMilestone) {
      throw new Error("Draft plan returned no milestones.");
    }

    const execution = await tools.localExecuteMilestone({
      taskId: plan.taskId,
      milestoneId: firstMilestone.id,
      context: [
        "Micro-spec for benchmark only:",
        "- Implement only the first milestone scope in isolated temp workspace.",
        "- Create src/emitter.ts with a SafeEmitter class and basic unit-testable API.",
        "- Do not modify files outside src/emitter.ts.",
        "- Keep output concise; this is a throughput benchmark, not production code."
      ].join("\n")
    });

    const taskMetrics = callMetrics.slice(metricsStart);
    const wallMs = Date.now() - startedAt;

    return {
      taskId: task.id,
      epic: task.epic,
      source: task.source,
      workspace: workspaceRoot,
      model: ollamaModel,
      numCtx: ollamaNumCtx,
      plan: {
        taskId: plan.taskId,
        tier: plan.tier,
        milestoneCount: plan.milestones.length,
        milestones: plan.milestones.map((m) => ({ id: m.id, title: m.title }))
      },
      execution: {
        milestoneId: firstMilestone.id,
        success: execution.success,
        status: execution.status,
        route: execution.execution?.route,
        complexityTier: execution.execution?.complexityTier,
        microTaskCount: execution.execution?.microTaskCount,
        filesModified: execution.filesModified
      },
      metrics: summarizeMetrics(taskMetrics),
      wallMs
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function main() {
  const selectedIds = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const tasks =
    selectedIds.length > 0
      ? BENCHMARK_TASKS.filter((task) => selectedIds.includes(task.id))
      : BENCHMARK_TASKS;

  if (tasks.length === 0) {
    console.error("No matching benchmark task IDs. Available:", BENCHMARK_TASKS.map((t) => t.id).join(", "));
    process.exit(1);
  }

  console.error(`LCW-Auto benchmark | model=${ollamaModel} | num_ctx=${ollamaNumCtx}`);
  console.error(`Running ${tasks.length} isolated task(s)...\n`);

  const results = [];
  for (const task of tasks) {
    console.error(`→ ${task.id}: ${task.epic}`);
    try {
      results.push(await runTask(task));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${task.id} failed: ${message}`);
      results.push({
        taskId: task.id,
        epic: task.epic,
        source: task.source,
        error: message,
        metrics: summarizeMetrics(callMetrics)
      });
    }
  }

  const allMetrics = summarizeMetrics(callMetrics);
  const report = {
    generatedAt: new Date().toISOString(),
    runtime: {
      model: ollamaModel,
      host: ollamaHost,
      numCtx: ollamaNumCtx
    },
    benchmarkCatalog: BENCHMARK_TASKS.map(({ id, epic, source }) => ({ id, epic, source })),
    runs: results,
    aggregate: allMetrics
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
