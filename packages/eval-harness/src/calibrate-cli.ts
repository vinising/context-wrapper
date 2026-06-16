#!/usr/bin/env tsx
import { runCalibration } from "./calibrate.js";

const workspaceRoot = "/Users/vinising/Desktop/Projects/Wrapper";

async function run() {
  console.log("=== Running LLM Judge vs Human Calibration ===");
  console.log("Evaluating blind samples across all three arms...\n");
  
  const report = await runCalibration(workspaceRoot);
  
  console.log("Case ID | Arm            | Human Score | Judge Score | Delta");
  console.log("------------------------------------------------------------");
  for (const r of report.results) {
    console.log(
      `${r.caseId.padEnd(7)} | ${r.arm.padEnd(14)} | ${String(r.human).padEnd(11)} | ${String(r.judge).padEnd(11)} | ${r.delta}`
    );
  }
  
  console.log("\n------------------------------------------------------------");
  console.log(`Mean Absolute Error (MAE): ${report.meanAbsoluteError.toFixed(2)}`);
  console.log(`Judge-to-Human Agreement Rate: ${report.agreementPercentage.toFixed(1)}%`);
  console.log("------------------------------------------------------------\n");
}

run().catch((err) => {
  console.error("Calibration failed:", err);
  process.exit(1);
});
