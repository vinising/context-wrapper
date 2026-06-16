import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTranscript, mapEpisodesToEvalCases } from "./transcript-parser.js";
import { loadOrCreateCorpus } from "./corpus-compiler.js";
import { estimateTokens, calculateTokenSavings } from "./token-estimator.js";

describe("eval-harness scaffold", () => {
  const mockJsonl = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<timestamp>Monday, Jun 15, 2026, 7:39 PM</timestamp>\n<user_query>\nThis is the wrapper project...\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "Got it." },
          { type: "tool_use", name: "ReadFile", input: { path: "package.json" } }
        ]
      }
    })
  ].join("\n");

  it("parses transcript and maps episodes to EvalCases", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "eval-harness-test-"));
    const transcriptPath = join(tmpDir, "transcript.jsonl");
    await writeFile(transcriptPath, mockJsonl, "utf8");

    try {
      const episodes = await parseTranscript(transcriptPath);
      expect(episodes.length).toBe(1);
      expect(episodes[0]!.rawPrompt).toBe("This is the wrapper project...");
      expect(episodes[0]!.toolsUsed).toContain("ReadFile");
      expect(episodes[0]!.followUpTurns).toBe(1);

      const cases = mapEpisodesToEvalCases(episodes);
      expect(cases.length).toBe(1);
      expect(cases[0]!.id).toBe("T01");
      expect(cases[0]!.intent).toBe("implementation");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("calculates accurate token savings", () => {
    const savings = calculateTokenSavings("build app", "Build standard Apple Silicon app with proper error boundaries", "Okay I will build it.");
    expect(savings.baselineRawEstimate.promptTokens).toBeGreaterThan(0);
    expect(savings.wrapperEstimate.promptTokens).toBeGreaterThan(savings.baselineRawEstimate.promptTokens);
  });

  it("loads rubrics properly", async () => {
    const { loadPromptRubric, loadOutcomeRubric } = await import("./rubric-loader.js");
    const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";
    const promptRubric = await loadPromptRubric(workspaceRoot);
    const outcomeRubric = await loadOutcomeRubric(workspaceRoot);

    expect(promptRubric.version).toBe(1);
    expect(promptRubric.dimensions.goal_clarity).toBeDefined();
    expect(outcomeRubric.dimensions.requirement_coverage).toBeDefined();
  });

  it("runs blind judge and calibration samples", async () => {
    const { runCalibration } = await import("./calibrate.js");
    const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";
    const report = await runCalibration(workspaceRoot);

    expect(report.results.length).toBe(6); // 2 samples * 3 arms
    expect(report.agreementPercentage).toBeGreaterThan(0);
    expect(report.meanAbsoluteError).toBeGreaterThanOrEqual(0);
  });

  it("creates sandbox and analyzes churn correctly", async () => {
    const { createSandbox } = await import("./sandbox.js");
    const { takeDirectorySnapshot, analyzeChurn } = await import("./churn-analyzer.js");
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const sb = await createSandbox("empty-node-project");
    try {
      const snapBefore = await takeDirectorySnapshot(sb.path);
      expect(snapBefore["package.json"]).toBeDefined();

      // Modify a file and create a file
      await writeFile(join(sb.path, "package.json"), "{}", "utf8");
      await writeFile(join(sb.path, "src/new-file.ts"), "const x = 1;", "utf8");

      const snapAfter = await takeDirectorySnapshot(sb.path);
      const metrics = analyzeChurn(snapBefore, snapAfter);

      expect(metrics.filesTouched).toContain("package.json");
      expect(metrics.filesTouched).toContain("src/new-file.ts");
      expect(metrics.filesTouched.length).toBe(2);
    } finally {
      await sb.cleanup();
    }
  });

  it("runs sandboxed replays for each arm", async () => {
    const { runReplayCase } = await import("./replay.js");
    const evalCase = {
      id: "T99",
      rawPrompt: "make index file",
      intent: "implementation" as const,
      fixture: "empty-node-project"
    };

    const runA = await runReplayCase("/Users/vinising/Desktop/Projects/Wrapper", evalCase, "baseline_raw");
    const runC = await runReplayCase("/Users/vinising/Desktop/Projects/Wrapper", evalCase, "wrapper_local");

    expect(runA.success).toBe(true);
    expect(runC.success).toBe(true);
    expect(runA.turnCount).toBeGreaterThan(runC.turnCount!);
    expect(runA.linesAdded).toBeGreaterThan(0);
  });

  it("runs autonomous multi-agent framework benchmarks", async () => {
    const { runFrameworkBenchmark } = await import("./framework-benchmark.js");
    const result = await runFrameworkBenchmark("Build safe event emitter with transaction rollback");

    expect(result.epic).toContain("event emitter");
    expect(result.baselineHosted.sameFileRewrites).toBeGreaterThan(result.wrapperLocal.sameFileRewrites);
    expect(result.wrapperLocal.turns).toBeGreaterThan(0);
  });

  it("judges autonomous framework outcomes accurately", async () => {
    const { runFrameworkBenchmark } = await import("./framework-benchmark.js");
    const { judgeFrameworkOutcome } = await import("./framework-judge.js");
    
    const result = await runFrameworkBenchmark("Build safe event emitter with transaction rollback");
    const verdict = await judgeFrameworkOutcome("/Users/vinising/Desktop/Projects/Wrapper", result);

    expect(verdict.winner).toBe("wrapperLocal");
    expect(verdict.wrapperLocal.codeQualityScore).toBeGreaterThan(verdict.baselineHosted.codeQualityScore);
  });
});
