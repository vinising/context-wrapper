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
  "Call refine_prompt only when the user runs /refine-prompt, asks to refine, or uses smoke:refine.",
  "Call build_agent_brief only when the user runs /agent-brief or asks to build a task brief.",
  "Call index_workspace only when the user runs /index-workspace or asks to index the workspace.",
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
    "Call `score_prompt_quality` and explain what context is missing before implementation starts."
};

export const wrapperHooks = {
  beforeSubmitPrompt:
    "Score the prompt with the local sidecar. If it lacks goal, constraints, or success criteria, warn the user and suggest `/refinePrompt`.",
  sessionStart: "Load `.wrapper/context/handoff.md` when available and remind the user if the handoff is stale."
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
