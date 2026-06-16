#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../");

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || ["help", "-h", "--help"].includes(command)) {
    printHelp();
    process.exit(0);
  }

  const targetPath = path.resolve(process.cwd());

  switch (command) {
    case "setup": {
      const specifiedPath = args[1] ? path.resolve(args[1]) : targetPath;
      runScript("packages/mcp-server/src/setup-cli.ts", [specifiedPath]);
      break;
    }
    case "diagnose": {
      const specifiedPath = args[1] ? path.resolve(args[1]) : targetPath;
      runScript("packages/mcp-server/src/diagnose-cli.ts", [specifiedPath]);
      break;
    }
    case "auto": {
      const taskPromptArgs = args.slice(1);
      if (taskPromptArgs.length === 0) {
        console.error("❌ Error: Please provide an autonomous task description.");
        console.log('Usage: lcw auto "task description" [options]');
        process.exit(1);
      }
      // Pass task prompt and any flag options directly
      runScript("packages/agent-framework/src/cli.ts", taskPromptArgs);
      break;
    }
    case "index": {
      const specifiedPath = args[1] ? path.resolve(args[1]) : targetPath;
      runScript("packages/mcp-server/src/smoke-index.ts", [specifiedPath]);
      break;
    }
    case "brief": {
      const briefTaskArgs = args.slice(1);
      if (briefTaskArgs.length === 0) {
        console.error("❌ Error: Please provide a brief task description.");
        console.log('Usage: lcw brief "task description"');
        process.exit(1);
      }
      runScript("packages/mcp-server/src/smoke-brief.ts", briefTaskArgs);
      break;
    }
    default: {
      console.error(`❌ Error: Unknown command '${command}'`);
      printHelp();
      process.exit(1);
    }
  }
}

function runScript(relativeScriptPath: string, args: string[]) {
  const scriptPath = path.join(repoRoot, relativeScriptPath);
  
  // Resolve tsx execution from the monorepo root
  const result = spawnSync(
    "npx",
    ["tsx", scriptPath, ...args],
    {
      stdio: "inherit",
      cwd: process.cwd(), // Execute in the user's active folder context
      env: {
        ...process.env,
        WRAPPER_WORKSPACE_ROOT: process.cwd()
      }
    }
  );

  process.exit(result.status ?? 0);
}

function printHelp() {
  console.log(`
======================================================================
⚙️  LOCAL CONTEXT WRAPPER (LCW) GLOBAL CLI
======================================================================
Usage: lcw <command> [arguments]

Commands:
  setup [path]            Explore, seed context, register MCP, and bootstrap models
                          (Defaults to current folder if [path] is omitted)

  diagnose [path]         Check health and connections (Ollama, models, environments)
                          (Defaults to current folder if [path] is omitted)

  auto "task" [options]   Launch tiered multi-agent framework on a task autonomously
                          Options:
                            --no-approval     Skip human-in-the-loop approvals
                            --tier=X          Force tier (tier1_local | tier2_hybrid | tier3_hosted)
                            --max-turns=N     Override execution loop iteration limit (default: 5)
                            --max-files=N     Override file churn threshold (default: 10)
                            --no-validate     Skip post-run compilations and lints checks
                            --rollback        Auto rollback via git on failure

  index [path]            Force build/rebuild of codebase semantic/lexical search index
                          (Defaults to current folder if [path] is omitted)

  brief "task"            Create a task-scoped briefing document locally under .wrapper/runs/

Examples:
  $ lcw setup
  $ lcw diagnose
  $ lcw auto "Refactor Settings UI toggle" --no-approval
======================================================================
`);
}

main();
