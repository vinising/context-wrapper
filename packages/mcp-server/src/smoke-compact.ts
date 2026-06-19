#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";
import { setupWorkspace } from "./setup-workspace.js";

const workspaceRoot = process.env.WRAPPER_WORKSPACE_ROOT ?? process.cwd();
const smokeWorkspace = await mkdtemp(join(tmpdir(), "wrapper-smoke-compact-"));

await setupWorkspace(smokeWorkspace);

const store = createContextStore(smokeWorkspace);
await store.initialize({
  projectName: "SmokeCompact",
  projectGoal: "Verify compaction without mutating the developer workspace handoff."
});

const tools = createWrapperTools({
  store,
  runtime: {
    assessAndRefine: async () => {
      throw new Error("not used");
    },
    assessOnly: async () => {
      throw new Error("not used");
    },
    buildAgentBrief: async () => {
      throw new Error("not used");
    },
    generate: async ({ prompt }) => {
      if (prompt.includes("bloated chat conversation history")) {
        return [
          "### State Locked-in",
          "- Verified compaction smoke path",
          "",
          "### Current Focus",
          "- Static signature parsing",
          "",
          "### Active Decisions",
          "- Smoke script uses isolated temp workspace",
          "",
          "### Key Files",
          "- packages/mcp-server/src/index.ts -- core MCP tool implementations",
          "- packages/context-store/src/sanitize-handoff.ts -- contract parser"
        ].join("\n");
      }
      return "fallback";
    }
  }
});

console.log(`Compacting mock conversation in isolated workspace: ${smokeWorkspace}`);
const result = await (tools as any).localCompactConversation({
  history: [
    { role: "user", content: "Let's align local context wrapper tools." },
    {
      role: "assistant",
      content: "I've implemented the body-stripping static AST parser in signature-parser.ts."
    }
  ],
  focus: "Static signature parsing"
});

console.log("\n=== COMPACTED SUMMARY ===");
console.log(result.summary);
console.log("\n=== CLEAN-SLATE PROMPT ===");
console.log(result.cleanSlatePrompt);

const handoff = await store.readHandoff();
console.log("\n=== ISOLATED HANDOFF FOCUS ===");
console.log(handoff.activeContext.currentFocus);
console.log(`\nDeveloper workspace (${workspaceRoot}) handoff was not modified.`);
