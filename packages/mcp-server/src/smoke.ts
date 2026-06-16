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

const result = await tools.refinePrompt({
  prompt: process.argv.slice(2).join(" ").trim() || "Build local sidecar context support",
  intent: "implementation"
});

console.log(JSON.stringify(result, null, 2));
