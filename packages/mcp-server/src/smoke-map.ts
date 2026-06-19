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

const fileToMap = process.argv[2] || "packages/mcp-server/src/signature-parser.ts";
console.log(`Mapping signatures for: ${fileToMap}...`);

try {
  const result = await (tools as any).getCodeSignatureMap({
    filePath: fileToMap
  });
  console.log("\n=== CODE SIGNATURE MAP ===");
  console.log(result);
} catch (err: any) {
  console.error(`Error: ${err.message}`);
}
