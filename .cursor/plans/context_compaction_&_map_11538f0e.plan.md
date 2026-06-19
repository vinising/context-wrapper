---
name: Context Compaction & Map
overview: Implement high-density, Python-indented codebase signature mapping and guided conversation compaction using local LLMs to eliminate Cursor context bloat.
todos:
  - id: task-1-zod-schemas
    content: "Task 1: Add new Zod input schemas to packages/schemas/src/index.ts"
    status: completed
  - id: task-2-signature-parser
    content: "Task 2: Implement static signature AST/Regex parsing in packages/mcp-server/src/signature-parser.ts"
    status: completed
  - id: task-3-register-mcp
    content: "Task 3: Register local_compact_conversation and get_code_signature_map in packages/mcp-server/src/cli.ts"
    status: completed
  - id: task-4-handlers-impl
    content: "Task 4: Implement core tool handlers and LLM formatting loops in packages/mcp-server/src/index.ts"
    status: completed
  - id: task-5-write-tests
    content: "Task 5: Write unit and integration tests in packages/mcp-server/src/mcp-tools.test.ts"
    status: completed
  - id: task-6-slash-commands
    content: "Task 6: Create slash command files lcw-compact.md and lcw-map.md in Cursor settings and package assets"
    status: completed
isProject: false
---

# Context Compaction and Codebase Signature Mapping Plan

This plan introduces two features to optimize Cursor's context window:
1.  **Codebase Signature Mapping (`get_code_signature_map` MCP Tool & `/lcw-map` slash command):** Generates a Python-indented summary tree of a file's global scope, classes, functions, and methods with brief local LLM-generated descriptions instead of loading full source files.
2.  **Guided Conversation Compaction (`compact_conversation` MCP Tool & `/lcw-compact` slash command):** Summarizes the active chat history using the local LLM, focusing on key architectural decisions (supporting user-specified focus areas) and providing a copyable clean-slate prompt for Cursor `Cmd + L` reset.

---

## 1. Architecture and Visual Concept

```mermaid
flowchart TB
  subgraph cursorSection [Cursor Chat Session]
    userMsg["User Prompt /lcw-compact"]
    cursorChat["Cursor Chat History (Bloated context)"]
  end

  subgraph mcpSection [Local MCP Server]
    compactTool["compact_conversation Tool"]
    localLLM["Local LLM (Ollama/MLX)"]
    signatureTool["get_code_signature_map Tool"]
  end

  subgraph outputSection [High-Density Output]
    compactionResult["Compressed Conversation Summary"]
    signatureResult["Indented Signatures & Summaries Map"]
    cmdLPrompt["Cmd + L Sweep Prompt"]
  end

  userMsg -->|"Trigger slash command"| compactTool
  cursorChat -->|"Pass bloated history"| compactTool
  compactTool -->|"Summarize history with focus query"| localLLM
  localLLM -->|"Write dense Markdown"| compactionResult

  signatureTool -->|"Static AST/Regex parser"| localLLM
  localLLM -->|"Format with custom indentation"| signatureResult

  compactionResult --> cmdLPrompt
  signatureResult --> cmdLPrompt
```

---

## 2. File Mapping

We will modify or create the following files:
*   `packages/schemas/src/index.ts` (Modify: Add input schemas for `local_compact_conversation` and `get_code_signature_map`)
*   `packages/mcp-server/src/signature-parser.ts` (Create: Hybrid static-and-LLM code signature parser supporting TypeScript, JavaScript, Python, etc.)
*   `packages/mcp-server/src/cli.ts` (Modify: Register the two new MCP tool schemas and their CallTool handlers)
*   `packages/mcp-server/src/index.ts` (Modify: Implement `localCompactConversation` and `getCodeSignatureMap` tool logic)
*   `packages/mcp-server/src/mcp-tools.test.ts` (Modify: Add unit tests for signature parsing and history compaction)
*   `.cursor/commands/lcw-compact.md` (Create: Slash command template for `/lcw-compact`)
*   `.cursor/commands/lcw-map.md` (Create: Slash command template for `/lcw-map`)
*   `packages/cursor-plugin/assets/commands/lcw-compact.md` (Create: Asset template)
*   `packages/cursor-plugin/assets/commands/lcw-map.md` (Create: Asset template)

---

## 3. High-Density Layout Contract (Python-Indented Style)

For signature mapping, the local LLM will format the parsed output using this token-efficient structure:

```text
packages/mcp-server/src/index.ts (Global: Core MCP server tool execution handlers and initialization)
  class WrapperTools (Collection of all exposed local workspace assistant tools)
    method refinePrompt(prompt: string, intent: string) --> Refines user prompt using Ollama
    method getContextHandoff() --> Reads active context-store handoff files
  function createWrapperTools(options: { store: ContextStore }) --> Instantiates tools collection
```

---

## 4. Implementation Steps (Bite-Sized Todos)

For the upcoming execution phase, we organize the work into these sequential tasks:
