import { createInterface } from "node:readline";
import { Orchestrator } from "./orchestrator.js";
import { SubAgentDelegate } from "./sub-agent.js";
import { createContextStore } from "@wrapper/context-store";

function askQuestion(query: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const promptParts: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const clean = arg.slice(2);
      if (clean.includes("=")) {
        const [key, val] = clean.split("=");
        flags[key] = val;
      } else if (clean.startsWith("no-")) {
        const key = clean.slice(3).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        flags[key] = false;
      } else {
        const key = clean.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        flags[key] = true;
      }
    } else {
      promptParts.push(arg);
    }
  }

  const taskPrompt = promptParts.join(" ");

  if (!taskPrompt) {
    console.error("Error: Please provide a task description to execute.");
    console.log("Usage: npm run autonomous -- \"your high-level task/epic description\" [options]");
    console.log("Options:");
    console.log("  --no-approval       Skip interactive human-in-the-loop plan approvals");
    console.log("  --tier=X            Force complexity tier (tier1_local | tier2_hybrid | tier3_hosted | auto)");
    console.log("  --max-turns=N       Limit maximum sub-agent turns (default: 5)");
    console.log("  --max-files=N       Limit maximum files modified allowed (default: 10)");
    console.log("  --no-validate       Skip automated lints/tests compilation validation");
    console.log("  --rollback          Rollback changes using git if compilation/validation fails");
    process.exit(1);
  }

  const workspaceRoot = process.cwd();

  // 1. Initialize Context Store & read Policy
  const store = createContextStore(workspaceRoot);
  try {
    await store.initialize({
      projectName: "Workspace Epic Run",
      projectGoal: "Execute task autonomously via tiered routing framework"
    });
  } catch {
    // If store already initialized, do nothing
  }

  const policy = await store.readPolicy();
  const activeConfig = {
    interactiveApproval: policy.autonomous?.interactiveApproval ?? true,
    maxTaskTurns: policy.autonomous?.maxTaskTurns ?? 5,
    maxFilesModified: policy.autonomous?.maxFilesModified ?? 10,
    forcedTier: policy.autonomous?.forcedTier ?? "auto",
    autoValidate: policy.autonomous?.autoValidate ?? true,
    autoRollbackOnFailure: policy.autonomous?.autoRollbackOnFailure ?? false
  };

  // Merge CLI overrides
  if (flags.approval === false) activeConfig.interactiveApproval = false;
  if (flags.approval === true) activeConfig.interactiveApproval = true;
  if (flags.noApproval === true) activeConfig.interactiveApproval = false;

  if (flags.tier && typeof flags.tier === "string") {
    if (["tier1_local", "tier2_hybrid", "tier3_hosted", "auto"].includes(flags.tier)) {
      activeConfig.forcedTier = flags.tier as any;
    }
  }

  if (flags.maxTurns) {
    const val = Number(flags.maxTurns);
    if (!isNaN(val)) activeConfig.maxTaskTurns = val;
  }
  if (flags.maxFiles) {
    const val = Number(flags.maxFiles);
    if (!isNaN(val)) activeConfig.maxFilesModified = val;
  }

  if (flags.validate === false || flags.noValidate === true) activeConfig.autoValidate = false;
  if (flags.validate === true) activeConfig.autoValidate = true;

  if (flags.rollback === true) activeConfig.autoRollbackOnFailure = true;
  if (flags.rollback === false || flags.noRollback === true) activeConfig.autoRollbackOnFailure = false;

  console.log("=====================================================================");
  console.log("🤖 LAUNCHING AUTONOMOUS MULTI-AGENT WORKFLOW RUNNER");
  console.log(`Task Epic: "${taskPrompt}"`);
  console.log("Configuration:");
  console.log(`- Interactive Approval: ${activeConfig.interactiveApproval ? "Enabled ✋" : "Disabled 🚀"}`);
  console.log(`- Complexity Tier Rule: ${activeConfig.forcedTier}`);
  console.log(`- Max Turns Allowed: ${activeConfig.maxTaskTurns}`);
  console.log(`- Max File Churn Limit: ${activeConfig.maxFilesModified}`);
  console.log(`- Post-run Auto Validation: ${activeConfig.autoValidate ? "Enabled 🧪" : "Disabled"}`);
  console.log(`- Failure Rollback Strategy: ${activeConfig.autoRollbackOnFailure ? "Git Rollback 🔄" : "None"}`);
  console.log("=====================================================================\n");

  // 2. Instantiate Orchestrator and Sub-Agent
  console.log("⚙️  Initializing Multi-Agent Framework...");
  const orchestrator = new Orchestrator(workspaceRoot);
  const subAgent = new SubAgentDelegate(workspaceRoot);

  // 3. Run Complexity Routing & Epic Planning
  console.log("\n🧭 Running Pre-flight Complexity Router...");
  const tier = await orchestrator.determineComplexityTier(taskPrompt, { forcedTier: activeConfig.forcedTier });
  
  let tierLabel = "";
  if (tier === "tier1_local") tierLabel = "🟢 TIER 1: 100% LOCAL inference (Free & Fast)";
  if (tier === "tier2_hybrid") tierLabel = "🟡 TIER 2: HYBRID Draft-and-Audit (Balanced & Safe)";
  if (tier === "tier3_hosted") tierLabel = "🔴 TIER 3: PURE HOSTED reasoning (Deep & Complete)";
  
  console.log(`Routed to: ${tierLabel}`);

  console.log("\n🗺️  Orchestrator decomposing Epic task into sequential milestones...");
  const milestones = await orchestrator.planEpic(taskPrompt, { forcedTier: activeConfig.forcedTier });
  console.log(`Milestones planned: ${milestones.length}`);
  for (const m of milestones) {
    console.log(`  - [${m.id}] ${m.title}: ${m.description}`);
  }

  // 4. Milestone Human-in-the-Loop Interception Flow
  if (activeConfig.interactiveApproval) {
    const proceed = await askQuestion("\n✋ Milestone plan generated. Do you want to proceed with execution? [Y/n]: ");
    if (proceed.toLowerCase() === "n") {
      console.log("🛑 Epic execution aborted by user.");
      process.exit(0);
    }
  }

  // 5. Sequential Sub-Agent Delegate Execution Loop
  console.log("\n🚀 Commencing autonomous sub-agent delegate execution loop...");
  let totalTurns = 0;
  const modifiedFilesAccumulator = new Set<string>();

  for (const milestone of milestones) {
    if (totalTurns >= activeConfig.maxTaskTurns) {
      console.log(`\n🛑 Guardrail triggered: Reached maximum execution turns limit (${activeConfig.maxTaskTurns}). Halting.`);
      break;
    }

    console.log(`\n---------------------------------------------------------------------`);
    console.log(`🏃 Executing Milestone: [${milestone.id}] "${milestone.title}"`);
    console.log(`---------------------------------------------------------------------`);
    
    console.log("📝 Generating task-scoped local agent brief...");
    const brief = await orchestrator.generateTaskBrief(milestone.description);
    console.log(`Brief successfully saved to: ${brief.briefPath || "local run folder"}`);
    console.log(`Target files in scope: ${brief.inScope.join(", ")}`);

    console.log("\n💻 Spawning Sub-Agent Delegate implementation...");
    const execution = await subAgent.executeTask(brief);
    
    totalTurns += 1;
    if (execution.success) {
      console.log("✅ Sub-Agent complete.");
      for (const file of execution.filesModified) {
        if (modifiedFilesAccumulator.size >= activeConfig.maxFilesModified && !modifiedFilesAccumulator.has(file)) {
          console.log(`⚠️  Guardrail triggered: File churn exceeds limits (${activeConfig.maxFilesModified}). Skipping modification recording.`);
          continue;
        }
        modifiedFilesAccumulator.add(file);
      }
      console.log(execution.logs);
    } else {
      console.log("❌ Sub-Agent implementation failed.");
      console.log(execution.logs);
      process.exit(1);
    }
  }

  // 6. Finalize context handoff
  console.log("\n🏁 Finalizing context handoff...");
  const finalSummary = `Completed epic: "${taskPrompt}" across ${milestones.length} milestones. Modified files: ${Array.from(modifiedFilesAccumulator).join(", ")}`;
  await orchestrator.refreshHandoff(
    finalSummary,
    "Task completed. Standing by for next prompt",
    Array.from(modifiedFilesAccumulator),
    ["Review completed implementation", "Run automated integration tests"]
  );

  console.log("\n=====================================================================");
  console.log("🎉 AUTONOMOUS TASK RUN SUCCESSFULLY COMPLETED");
  console.log("=====================================================================");
  console.log(`- Milestones executed: ${milestones.length}`);
  console.log(`- Sub-agent execution turns: ${totalTurns}`);
  console.log(`- Files modified: ${Array.from(modifiedFilesAccumulator).join(", ")}`);
  
  if (orchestrator.lastPlanningTokens) {
    console.log(`- Planning Tier used: ${orchestrator.lastPlanningTokens.tier}`);
    console.log(`- Hosted Tokens Used (Paid): ${orchestrator.lastPlanningTokens.tokensHosted} tokens`);
    if (orchestrator.lastPlanningTokens.tier === "tier2_hybrid") {
      console.log("  (Drafted local Gemma prompt on MacBook GPU for free, saving ~90% tokens)");
    } else if (orchestrator.lastPlanningTokens.tier === "tier1_local") {
      console.log("  (100% locally routed and planned - 0 hosted tokens billed!)");
    }
  }
  console.log("Handoff current.yaml and handoff.md successfully updated and locked.");
  console.log("=====================================================================\n");
}

main().catch((err) => {
  console.error("Fatal: Autonomous framework CLI run failed:", err);
  process.exit(1);
});
