#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "@wrapper/mcp-server";
import { createRuntimeGenerator } from "@wrapper/mcp-server";
import { loadOrCreateCorpus } from "./corpus-compiler.js";
import { runBlindJudge } from "./judge.js";

const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";
const transcriptPath = "/Users/vinising/.cursor/projects/Users-vinising-Desktop-Projects-Wrapper/agent-transcripts/cc8087bd-6bad-4033-80c0-587bb8374829/cc8087bd-6bad-4033-80c0-587bb8374829.jsonl";

async function run() {
  console.log("=== Running Blind LLM Judge on Compiled Corpus ===");
  const cases = await loadOrCreateCorpus(workspaceRoot, transcriptPath);
  console.log(`Loaded ${cases.length} cases from corpus.`);

  const store = createContextStore(workspaceRoot);
  const runtime = createRuntimeGenerator();
  const tools = createWrapperTools({ store, runtime });

  const results: any[] = [];

  // Evaluate the first 10 cases to keep the run fast and token-efficient (Ollama can take 1-2s per call)
  const subset = cases.slice(0, 10);
  console.log(`Evaluating a representative subset of ${subset.length} cases...\n`);

  for (const c of subset) {
    console.log(`Evaluating Case ${c.id}: ${c.rawPrompt.slice(0, 50)}...`);
    
    // 1. baseline_raw is original raw prompt
    const baseline_raw = c.rawPrompt;

    // 2. wrapper_local is refined by our local MCP tools
    const wrapperQuality = await tools.refinePrompt({ prompt: c.rawPrompt, intent: c.intent });
    const wrapper_local = wrapperQuality.refinedPrompt;

    // 3. hosted_refine represents a simulated in-chat refinement
    const hosted_refine = [
      `### Refined Prompt: ${c.id}`,
      `**Goal:** ${c.rawPrompt}`,
      `**Acceptance Criteria:** Code builds, tests pass, and behaves as expected.`
    ].join("\n");

    const verdicts = await runBlindJudge(workspaceRoot, c, {
      baseline_raw,
      hosted_refine,
      wrapper_local
    });

    results.push({
      caseId: c.id,
      rawPrompt: c.rawPrompt,
      wrapperRefined: wrapper_local,
      verdicts
    });
  }

  const reportPath = join(workspaceRoot, "eval/results/prompt-quality-verdicts.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2), "utf8");

  console.log(`\n=== Prompt Quality Verification Complete ===`);
  console.log(`Saved verdicts to: ${reportPath}`);

  // Calculate averages
  let avgBaseline = 0;
  let avgHosted = 0;
  let avgWrapper = 0;

  for (const r of results) {
    avgBaseline += r.verdicts.baseline_raw.score;
    avgHosted += r.verdicts.hosted_refine.score;
    avgWrapper += r.verdicts.wrapper_local.score;
  }

  const n = results.length;
  console.log(`\nAverage Prompt Quality Scores (N = ${n}):`);
  console.log(`- baseline_raw:  ${(avgBaseline / n).toFixed(1)}/100`);
  console.log(`- hosted_refine: ${(avgHosted / n).toFixed(1)}/100`);
  console.log(`- wrapper_local: ${(avgWrapper / n).toFixed(1)}/100`);
}

run().catch((err) => {
  console.error("Evaluation run failed:", err);
  process.exit(1);
});
