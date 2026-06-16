import { Orchestrator } from "./orchestrator.js";
import { SubAgentDelegate } from "./sub-agent.js";
import { createContextStore } from "@wrapper/context-store";

async function main() {
  const taskPrompt = process.argv.slice(2).join(" ");
  if (!taskPrompt) {
    console.error("Error: Please provide a task description to execute.");
    console.log("Usage: npm run autonomous -- \"your high-level task/epic description\"");
    process.exit(1);
  }

  const workspaceRoot = process.cwd();
  console.log("=====================================================================");
  console.log("🤖 LAUNCHING AUTONOMOUS MULTI-AGENT WORKFLOW RUNNER");
  console.log(`Task Epic: "${taskPrompt}"`);
  console.log("=====================================================================\n");

  // 1. Initialize Context Store
  const store = createContextStore(workspaceRoot);
  try {
    await store.initialize({
      projectName: "Workspace Epic Run",
      projectGoal: "Execute task autonomously via tiered routing framework"
    });
  } catch {
    // If store already initialized, do nothing
  }

  // 2. Instantiate Orchestrator and Sub-Agent
  console.log("⚙️  Initializing Multi-Agent Framework...");
  const orchestrator = new Orchestrator(workspaceRoot);
  const subAgent = new SubAgentDelegate(workspaceRoot);

  // 3. Run Complexity Routing & Epic Planning
  console.log("\n🧭 Running Pre-flight Complexity Router...");
  const tier = await orchestrator.determineComplexityTier(taskPrompt);
  
  let tierLabel = "";
  if (tier === "tier1_local") tierLabel = "🟢 TIER 1: 100% LOCAL infrence (Free & Fast)";
  if (tier === "tier2_hybrid") tierLabel = "🟡 TIER 2: HYBRID Draft-and-Audit (Balanced & Safe)";
  if (tier === "tier3_hosted") tierLabel = "🔴 TIER 3: PURE HOSTED reasoning (Deep & Complete)";
  
  console.log(`Routed to: ${tierLabel}`);

  console.log("\n🗺️  Orchestrator decomposing Epic task into sequential milestones...");
  const milestones = await orchestrator.planEpic(taskPrompt);
  console.log(`Milestones planned: ${milestones.length}`);
  for (const m of milestones) {
    console.log(`  - [${m.id}] ${m.title}: ${m.description}`);
  }

  // 4. Sequential Sub-Agent Delegate Execution Loop
  console.log("\n🚀 Commencing autonomous sub-agent delegate execution loop...");
  let totalTurns = 0;
  const modifiedFilesAccumulator = new Set<string>();

  for (const milestone of milestones) {
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
      console.log("✅ Sub-Agent complete. Compilation/Verification passed.");
      for (const file of execution.filesModified) {
        modifiedFilesAccumulator.add(file);
      }
      console.log(execution.logs);
    } else {
      console.log("❌ Sub-Agent implementation failed.");
      console.log(execution.logs);
      process.exit(1);
    }
  }

  // 5. Finalize context handoff
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
