#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { loadOrCreateCorpus } from "./corpus-compiler.js";
import { calculateTokenSavings, estimateTokens } from "./token-estimator.js";

const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";
const transcriptPath = "/Users/vinising/.cursor/projects/Users-vinising-Desktop-Projects-Wrapper/agent-transcripts/cc8087bd-6bad-4033-80c0-587bb8374829/cc8087bd-6bad-4033-80c0-587bb8374829.jsonl";

async function run() {
  console.log("Parsing agent transcript...");
  const cases = await loadOrCreateCorpus(workspaceRoot, transcriptPath);
  console.log(`Corpus constructed with ${cases.length} cases.`);

  // Generate a report with token estimates and basic stats
  const casesReport = cases.map((c) => {
    const rawLength = c.rawPrompt.length;
    const responseLength = c.goldenOutcome ? c.goldenOutcome.length : 0;
    
    // Calculate simulated token metrics
    const estimates = calculateTokenSavings(
      c.rawPrompt, 
      `Refined: ${c.rawPrompt}\nGoal: clear\nAcceptance Criteria: verified`,
      c.goldenOutcome || ""
    );

    return {
      id: c.id,
      rawPromptSnippet: c.rawPrompt.slice(0, 100) + (c.rawPrompt.length > 100 ? "..." : ""),
      intent: c.intent,
      toolsUsedCount: c.toolsUsed?.length || 0,
      toolsUsed: c.toolsUsed || [],
      followUpTurns: c.followUpTurns || 0,
      baselineRawEstimate: estimates.baselineRawEstimate,
      wrapperEstimate: estimates.wrapperEstimate,
      savingsHosted: estimates.savingsHosted
    };
  });

  const totalBaselinePromptTokens = casesReport.reduce((acc, r) => acc + r.baselineRawEstimate.promptTokens, 0);
  const totalBaselineCompletionTokens = casesReport.reduce((acc, r) => acc + r.baselineRawEstimate.completionTokens, 0);
  const totalWrapperPromptTokens = casesReport.reduce((acc, r) => acc + r.wrapperEstimate.promptTokens, 0);
  const totalWrapperCompletionTokens = casesReport.reduce((acc, r) => acc + r.wrapperEstimate.completionTokens, 0);
  const totalSavingsHosted = casesReport.reduce((acc, r) => acc + r.savingsHosted, 0);

  const summary = {
    totalCases: cases.length,
    totalBaselineTokens: totalBaselinePromptTokens + totalBaselineCompletionTokens,
    totalBaselinePromptTokens,
    totalBaselineCompletionTokens,
    totalWrapperTokens: totalWrapperPromptTokens + totalWrapperCompletionTokens,
    totalWrapperPromptTokens,
    totalWrapperCompletionTokens,
    totalSavingsHosted,
    cases: casesReport
  };

  const reportPath = join(workspaceRoot, "eval/results/transcript-baseline-report.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`\n=== Backtest Transcript Mining Complete ===`);
  console.log(`Saved report to: ${reportPath}`);
  console.log(`Total Cases Extracted: ${cases.length}`);
  console.log(`Estimated Hosted Baseline Tokens: ${totalBaselinePromptTokens + totalBaselineCompletionTokens}`);
  console.log(`Estimated Hosted Wrapper Tokens: ${totalWrapperPromptTokens + totalWrapperCompletionTokens}`);
  console.log(`Estimated Hosted Tokens Saved: ${totalSavingsHosted} (approx. ${Math.round((totalSavingsHosted / (totalBaselinePromptTokens + totalBaselineCompletionTokens)) * 100)}% savings)`);
}

run().catch((err) => {
  console.error("Extraction failed:", err);
  process.exit(1);
});
