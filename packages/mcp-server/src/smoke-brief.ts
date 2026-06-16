#!/usr/bin/env node
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";
import { createRuntimeGenerator } from "./runtime-generator.js";
import { setupWorkspace } from "./setup-workspace.js";

const workspaceRoot = process.env.WRAPPER_WORKSPACE_ROOT ?? process.cwd();

await setupWorkspace(workspaceRoot);

const store = createContextStore(workspaceRoot);
const runtime = createRuntimeGenerator();
const tools = createWrapperTools({
  store,
  runtime
});

const task = process.argv.slice(2).filter(arg => !arg.startsWith("-")).join(" ").trim();
const subAgent = process.argv.includes("--sub-agent");

const result = await tools.buildAgentBrief({
  task: task || "Implement semantic index and agent brief tools",
  subAgent
});

console.log(JSON.stringify(result, null, 2));
