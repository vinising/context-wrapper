#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools, RefinePromptInput } from "./index.js";
import { createRuntimeGenerator } from "./runtime-generator.js";
import { setupWorkspace } from "./setup-workspace.js";

const workspaceRoot = process.env.WRAPPER_WORKSPACE_ROOT ?? process.cwd();
const store = createContextStore(workspaceRoot);

const setup = await setupWorkspace(workspaceRoot);
const runtime = createRuntimeGenerator();

const tools = createWrapperTools({
  store,
  runtime
});

const server = new Server(
  {
    name: "local-context-wrapper",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "refine_prompt",
      description: "Refine a rough prompt using current workspace context and return missing context questions.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          intent: { type: "string", enum: ["implementation", "debugging", "planning", "review"] }
        },
        required: ["prompt"]
      }
    },
    {
      name: "get_context_handoff",
      description: "Return the current structured context handoff for the workspace.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "update_context_handoff",
      description: "Update the current structured context handoff after meaningful progress.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          currentFocus: { type: "string" },
          constraints: { type: "array", items: { type: "string" } },
          nextSteps: { type: "array", items: { type: "string" } }
        },
        required: ["summary", "currentFocus", "constraints", "nextSteps"]
      }
    },
    {
      name: "get_runtime_profile",
      description: "Return detected local runtime profile and selected MLX model tier.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "score_prompt_quality",
      description: "Score a prompt and report missing context before implementation starts.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          intent: { type: "string", enum: ["implementation", "debugging", "planning", "review"] }
        },
        required: ["prompt"]
      }
    },
    {
      name: "index_workspace",
      description: "Build or rebuild the local semantic/lexical index of workspace files.",
      inputSchema: {
        type: "object",
        properties: {
          force: { type: "boolean" }
        }
      }
    },
    {
      name: "retrieve_context",
      description: "Retrieve relevant workspace code snippets matching a query using the local index.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          topK: { type: "number" }
        },
        required: ["query"]
      }
    },
    {
      name: "build_agent_brief",
      description: "Build a task-scoped execution brief for a Cursor agent from handoff, decisions, and retrieved context.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string" },
          intent: { type: "string", enum: ["implementation", "debugging", "planning", "review"] },
          topK: { type: "number" },
          subAgent: { type: "boolean" }
        },
        required: ["task"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};

  if (request.params.name === "refine_prompt") {
    return asText(await tools.refinePrompt(args as RefinePromptInput));
  }

  if (request.params.name === "get_context_handoff") {
    return asText(await tools.getContextHandoff());
  }

  if (request.params.name === "update_context_handoff") {
    return asText(await tools.updateContextHandoff(args as Parameters<typeof tools.updateContextHandoff>[0]));
  }

  if (request.params.name === "score_prompt_quality") {
    return asText(await tools.scorePromptQuality(args as RefinePromptInput));
  }

  if (request.params.name === "index_workspace") {
    return asText(await tools.indexWorkspace(args as { force?: boolean }));
  }

  if (request.params.name === "retrieve_context") {
    return asText(await tools.retrieveContext(args as { query: string; topK?: number }));
  }

  if (request.params.name === "build_agent_brief") {
    return asText(await tools.buildAgentBrief(args as Parameters<typeof tools.buildAgentBrief>[0]));
  }

  if (request.params.name === "get_runtime_profile") {
    return asText({
      workspaceRoot: setup.workspaceRoot,
      profile: setup.profile,
      generatorMode: runtime.mode,
      usesLlmScoring: runtime.usesLlmScoring
    });
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

await server.connect(new StdioServerTransport());

function asText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
