export type WrapperPluginManifest = {
  name: string;
  version: string;
  displayName: string;
  capabilities: string[];
  mcpServers: Array<{
    name: string;
    command: string;
    args: string[];
  }>;
  rules: string[];
  commands: Record<string, string>;
  hooks: Record<string, string>;
};

export const wrapperRules = [
  "Do not automatically refine every user message.",
  "Call refine_prompt only when the user runs /lcw-refine, asks to refine, or uses smoke:refine.",
  "Call build_agent_brief only when the user runs /lcw-brief or asks to build a task brief.",
  "Call index_workspace only when the user runs /lcw-index or asks to index the workspace.",
  "Call local_compact_conversation only when the user runs /lcw-compact or asks to compact conversation.",
  "Call get_code_signature_map only when the user runs /lcw-map or asks to map codebase file signatures.",
  "Call local_refresh_docs only when the user runs /lcw-docs or asks for docs hygiene refresh.",
  "Call local_git_hygiene only when the user runs /lcw-git or asks for git hygiene checkpoint.",
  "Call local_file_read only when the user runs /lcw-fileread or asks for guarded threshold-aware file reads/projections.",
  "Enforce the MANDATORY Retrieve-First policy: call the retrieve_context tool before reading large files or running broad command-line searches (like find, grep, rg).",
  "RETRIEVE-FIRST + MAP COMBO: After calling retrieve_context, if you need to understand the structural design or overall logic of any resulting file path, do not read the full file. Instead, call the get_code_signature_map tool on that file to get a highly compressed signature tree with on-device LLM-annotated purposes, cutting raw token size by 90%+.",
  "Prefer a refined prompt that includes goal, constraints, acceptance criteria, relevant context, and verification steps.",
  "When context is incomplete, ask targeted clarifying questions instead of treating a vague prompt as complete.",
  "Do not claim Cursor built-in chat prompts can be transparently rewritten; use supported MCP, rules, commands, skills, and hooks surfaces."
].join("\n");

export const wrapperCommands = {
  refinePrompt:
    "Call the local MCP tool `refine_prompt` with the rough user request, then present the refined prompt and clarifying questions.",
  refreshHandoff:
    "Call `update_context_handoff` after meaningful progress so future chats receive current goals, constraints, and next steps.",
  scorePrompt:
    "Call `score_prompt_quality` and explain what context is missing before implementation starts.",
  compactConversation:
    "Call local_compact_conversation to compress conversation logs and generate a clean-slate prompt for manual history reset.",
  getCodeSignatureMap:
    "Call get_code_signature_map to produce a high-density, Python-indented tree of classes/functions for exploration.",
  refreshDocs:
    "Call local_refresh_docs to refresh README/technical reference/onboarding based on touched files or full scope.",
  gitHygiene:
    "Call local_git_hygiene to summarize diffs and perform safe plan-scoped commits; push always requires explicit approval.",
  fileRead:
    "Call local_file_read to enforce raw read thresholds, projection-first reads, and cache-backed summarized file outputs."
};

export const wrapperHooks = {
  beforeSubmitPrompt:
    "Score the prompt with the local sidecar. If it lacks goal, constraints, or success criteria, warn the user and suggest `/refinePrompt`.",
  sessionStart: "On session start, load `.wrapper/context/handoff.md` and use the compacted memory block (State Locked-in, Current Focus, Active Decisions) to pre-prime your context window. If the handoff is stale or missing, recommend running `/lcw-handoff` or `/lcw-auto` to establish a base context."
};

export function createPluginManifest(): WrapperPluginManifest {
  return {
    name: "local-context-wrapper",
    version: "0.1.0",
    displayName: "Local Context Wrapper",
    capabilities: ["localMcpSidecar", "contextHandoff", "promptQualityGate", "promptRefinement"],
    mcpServers: [
      {
        name: "local-context-wrapper",
        command: "node",
        args: ["packages/mcp-server/dist/cli.js"]
      }
    ],
    rules: [wrapperRules],
    commands: wrapperCommands,
    hooks: wrapperHooks
  };
}
