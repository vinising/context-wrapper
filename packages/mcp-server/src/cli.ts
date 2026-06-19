#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools, RefinePromptInput } from "./index.js";
import { createRuntimeGenerator } from "./runtime-generator.js";
import { enforceOllamaContextWindow, parseOllamaNumCtx } from "./ollama-context.js";
import { setupWorkspace } from "./setup-workspace.js";

const workspaceRoot = process.env.WRAPPER_WORKSPACE_ROOT ?? process.cwd();
const store = createContextStore(workspaceRoot);

const setup = await setupWorkspace(workspaceRoot);

if (process.env.WRAPPER_RUNTIME === "ollama") {
  const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const ollamaModel = process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx";
  const ollamaNumCtx = parseOllamaNumCtx(process.env.WRAPPER_OLLAMA_NUM_CTX);
  const enforcement = await enforceOllamaContextWindow({
    host: ollamaHost,
    model: ollamaModel,
    numCtx: ollamaNumCtx
  });
  if (enforcement.unloaded) {
    console.error(
      `[lcw] Unloaded oversized Ollama model (${Math.round((enforcement.previousVram ?? 0) / 1e9)}GB) to enforce num_ctx=${ollamaNumCtx}.`
    );
  }
}

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
    },
    {
      name: "diagnose_setup",
      description: "Verify the health and readiness of the Local Context Wrapper MCP installation and runtimes.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "local_draft_plan",
      description: "Generate an initial, context-grounded task milestone draft using the local semantic index and local LLM. (Use in Plan Mode)",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "The high-level engineering task description." },
          forceTier: { type: "string", enum: ["tier1_local", "tier2_hybrid", "tier3_hosted", "auto"], description: "Force a complexity tier." },
          milestones: {
            type: "array",
            description: "Optional pre-defined milestones drafted by the hosted agent to bypass on-device planning.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Milestone ID, e.g. M01" },
                title: { type: "string", description: "Milestone title" },
                description: { type: "string", description: "Detailed description of the milestone scope" },
                assignedTo: { type: "string", description: "Assigned role, e.g. sub-agent" },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "failed"] }
              },
              required: ["id", "title", "description"]
            }
          }
        },
        required: ["task"]
      }
    },
    {
      name: "local_execute_milestone",
      description: "Execute a single milestone through the execution contract router (direct local, decomposed local, or explicit hosted opt-out with reason). (Use in Agent Mode)",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The active task ID from the draft plan." },
          milestoneId: { type: "string", description: "The milestone ID to execute (e.g., M01)." },
          context: { type: "string", description: "Highly detailed micro-specifications, exact parameters, or logic boundaries generated by the hosted agent to guide implementation." },
          executionMode: { type: "string", enum: ["auto", "hosted_opt_out"], description: "Execution mode. Use hosted_opt_out only when the user explicitly requests hosted/manual implementation." },
          optOutReason: { type: "string", description: "Required when executionMode=hosted_opt_out. Captures user-approved reason for bypassing local execution." }
        },
        required: ["taskId", "milestoneId"]
      }
    },
    {
      name: "local_file_read",
      description: "Guarded file-read utility with raw-window threshold enforcement, projection modes, and cache-backed summaries.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative file path inside workspace." },
          mode: { type: "string", enum: ["auto", "raw_window", "signature_map", "summary_blocks"], description: "Read mode." },
          offset: { type: "number", description: "1-indexed starting line for raw_window mode." },
          limit: { type: "number", description: "Maximum lines to return in raw_window mode." },
          focus: { type: "string", description: "Optional focus hint for projection summaries." },
          forceRefresh: { type: "boolean", description: "Skip cache and recompute projection." }
        },
        required: ["filePath"]
      }
    },
    {
      name: "local_refresh_docs",
      description: "Refresh project documentation from active plan context using smart touched-file scope or full scope.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Optional active task ID to scope refresh." },
          scope: { type: "string", enum: ["smart_touched", "full"], description: "Documentation refresh scope." },
          apply: { type: "boolean", description: "If false, returns plan only without editing docs." },
          includeDocs: { type: "array", items: { type: "string" }, description: "Optional extra docs to include." }
        }
      }
    },
    {
      name: "local_git_hygiene",
      description: "Prepare or perform safe git hygiene commit using plan-scoped or full tracked diff strategy.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Optional active task ID for plan-scoped mode." },
          mode: { type: "string", enum: ["plan_scoped", "all_tracked"], description: "File selection mode for staging." },
          includeFiles: { type: "array", items: { type: "string" }, description: "Explicit additional files to include." },
          commit: { type: "boolean", description: "When true, creates a commit after staging." },
          commitMessage: { type: "string", description: "Optional custom commit title." }
        }
      }
    },
    {
      name: "local_compact_conversation",
      description: "Summarize and compact a long chat conversation history using the local LLM. (Use for context compression)",
      inputSchema: {
        type: "object",
        properties: {
          history: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant"] },
                content: { type: "string" }
              },
              required: ["role", "content"]
            },
            description: "The array of past chat messages to compress."
          },
          focus: { type: "string", description: "Optional specific topic, architectural choices, or API designs to prioritize." }
        },
        required: ["history"]
      }
    },
    {
      name: "get_code_signature_map",
      description: "Extract a high-density, Python-indented class and function signature map of a file with brief method summaries using local LLM. (Use to explore code)",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The relative path of the file to map." }
        },
        required: ["filePath"]
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

  if (request.params.name === "diagnose_setup") {
    return asText(await tools.diagnoseSetup());
  }

  if (request.params.name === "local_draft_plan") {
    return asText(await (tools as any).localDraftPlan(args as {
      task: string;
      forceTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto";
      milestones?: Array<{
        id: string;
        title: string;
        description: string;
        assignedTo?: string;
        status?: "pending" | "in_progress" | "completed" | "failed";
      }>;
    }));
  }

  if (request.params.name === "local_execute_milestone") {
    return asText(await (tools as any).localExecuteMilestone(args as {
      taskId: string;
      milestoneId: string;
      context?: string;
      executionMode?: "auto" | "hosted_opt_out";
      optOutReason?: string;
    }));
  }

  if (request.params.name === "local_compact_conversation") {
    return asText(await (tools as any).localCompactConversation(args as { history: Array<{ role: "user" | "assistant"; content: string }>; focus?: string }));
  }

  if (request.params.name === "local_file_read") {
    return asText(await (tools as any).localFileRead(args as {
      filePath: string;
      mode?: "auto" | "raw_window" | "signature_map" | "summary_blocks";
      offset?: number;
      limit?: number;
      focus?: string;
      forceRefresh?: boolean;
    }));
  }

  if (request.params.name === "local_refresh_docs") {
    return asText(await (tools as any).localRefreshDocs(args as {
      taskId?: string;
      scope?: "smart_touched" | "full";
      apply?: boolean;
      includeDocs?: string[];
    }));
  }

  if (request.params.name === "local_git_hygiene") {
    return asText(await (tools as any).localGitHygiene(args as {
      taskId?: string;
      mode?: "plan_scoped" | "all_tracked";
      includeFiles?: string[];
      commit?: boolean;
      commitMessage?: string;
    }));
  }

  if (request.params.name === "get_code_signature_map") {
    return asText(await (tools as any).getCodeSignatureMap(args as { filePath: string }));
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
