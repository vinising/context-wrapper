#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadOrCreateCorpus } from "./corpus-compiler.js";
import { runReplayCase } from "./replay.js";

const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";
const transcriptPath = "/Users/vinising/.cursor/projects/Users-vinising-Desktop-Projects-Wrapper/agent-transcripts/cc8087bd-6bad-4033-80c0-587bb8374829/cc8087bd-6bad-4033-80c0-587bb8374829.jsonl";

async function run() {
  console.log("=== Starting Sandboxed Replay Backtest ===");
  const cases = await loadOrCreateCorpus(workspaceRoot, transcriptPath);
  console.log(`Loaded ${cases.length} cases from corpus.`);

  const subset = cases.slice(0, 10);
  console.log(`Executing 3-way sandboxed comparison on representative subset of ${subset.length} cases...\n`);

  const allRuns: any[] = [];

  for (const c of subset) {
    console.log(`Running Case ${c.id}: "${c.rawPrompt.slice(0, 45)}..."`);
    
    // Run Arm A (baseline_raw)
    const runA = await runReplayCase(workspaceRoot, c, "baseline_raw");
    
    // Run Arm B (hosted_refine)
    const runB = await runReplayCase(workspaceRoot, c, "hosted_refine");
    
    // Run Arm C (wrapper_local)
    const runC = await runReplayCase(workspaceRoot, c, "wrapper_local");

    allRuns.push({
      caseId: c.id,
      baseline_raw: runA,
      hosted_refine: runB,
      wrapper_local: runC
    });
    
    // Print quick summary for case
    console.log(
      `  - baseline_raw:  ${runA.turnCount} turns, touched: ${runA.filesTouched?.length} files, hosted tokens: ${runA.tokensHosted}`
    );
    console.log(
      `  - hosted_refine: ${runB.turnCount} turns, touched: ${runB.filesTouched?.length} files, hosted tokens: ${runB.tokensHosted}`
    );
    console.log(
      `  - wrapper_local: ${runC.turnCount} turns, touched: ${runC.filesTouched?.length} files, hosted tokens: ${runC.tokensHosted}`
    );
    console.log();
  }

  const runsDir = join(workspaceRoot, "eval/results/runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(join(runsDir, "comparison-runs.json"), JSON.stringify(allRuns, null, 2), "utf8");

  console.log(`=== Replay Backtest Suite Complete ===`);
  console.log(`Saved sandboxed run results to: ${join(runsDir, "comparison-runs.json")}`);
}

run().catch((err) => {
  console.error("Replay backtest failed:", err);
  process.exit(1);
});
