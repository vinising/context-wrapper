# Design Document: Granular MCP-Driven Hybrid Delegation Framework (Director-Producer Model)

**Date:** 2026-06-17  
**Status:** Approved  
**Topic:** Hybrid Delegation Framework  
**File Path:** `docs/superpowers/specs/2026-06-17-granular-mcp-hybrid-delegation-design.md`

## 1. Executive Summary & Purpose

The purpose of this design is to transition the Local Context Wrapper (LCW) autonomous runner (`lcw-auto`) from a monolithic, blind local execution flow to a granular, cooperative **Director-Producer Model**. 

Currently, `/lcw-auto` runs a single terminal-blocking task that bypasses Cursor's native, human-in-the-loop chat interface and planning capabilities. This prevents the hosted model (high reasoning, e.g., Claude 3.5 Sonnet / Gemini Pro) from checking code edits, resolving complex security constraints, or letting the user tweak plans before they run.

This design introduces a hybrid architecture:
1.  **The Hosted Agent (Claude/Gemini) is the Director:** It owns global reasoning, verifies code logic, handles complex user-facing edge cases, and manages the execution loop in Cursor Chat.
2.  **The Local Sidecar (LCW) is the Producer:** It uses local LLMs and indexes to perform semantic exploration, draft initial files/directories, and execute repetitive or boilerplate steps on-device, saving massive hosted tokens and utilizing native Apple Silicon acceleration.

---

## 2. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Cursor IDE (Client)                           │
│  Plan Mode: User inputs "/lcw-auto <task>"                            │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │
                   │ (1) Calls local_draft_plan()
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Local MCP Server & LLM                          │
│  - Runs semantic index retrieval on task                               │
│  - Generates initial task milestones & file boundaries                 │
│  - Writes pristine draft to `.wrapper/runs/active-plan.json`           │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │
                   │ (2) Returns Draft Plan JSON
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Hosted Agent (Claude)                          │
│  - Evaluates local plan draft with high-level reasoning                │
│  - Inserts security assertions, checks architecture, mitigates risk    │
│  - Formats and displays pristine interactive checklist to user         │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │
                   │ (3) User approves / modifies plan ➔ Initiates "Build"
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Milestone Execution Loop (Hybrid)                     │
│                                                                        │
│   Is Milestone Complex/Architectural?                                  │
│   ├── YES ➔ Hosted Agent writes code directly in chat interface        │
│   └── NO  ➔ Hosted Agent calls local_execute_milestone()               │
│             - Local sub-agent implements file updates locally          │
│             - Automatically runs local lints and tests                 │
│             - Saves result & logs to active-plan.json in real-time     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tool Specifications

We replace the monolithic `delegate_task_to_local` tool with two highly focused, granular MCP tools.

### 3.1 `local_draft_plan`
*   **Purpose:** Leverages local LLMs and semantic indexes to construct an on-device contextual draft of the tasks and files that need to be touched.
*   **Input Schema (JSON):**
    ```json
    {
      "type": "object",
      "properties": {
        "task": {
          "type": "string",
          "description": "The high-level user goal (e.g. 'Implement JWT storage in database')"
        },
        "forceTier": {
          "type": "string",
          "enum": ["tier1_local", "tier2_hybrid", "tier3_hosted", "auto"],
          "description": "Optional forced complexity tier override"
        }
      },
      "required": ["task"]
    }
    ```
*   **On-Device Operations:**
    1.  Uses local semantic search to retrieve code blocks relevant to the prompt.
    2.  Instantiates the local `Orchestrator` to split the task into distinct milestones.
    3.  Associates specific file scopes (`inScope` / `outOfScope`) with each milestone.
    4.  Saves the initial plan state to `.wrapper/runs/active-plan.json` with status `draft`.
    5.  Returns the structured plan payload.
*   **Output Structure (JSON):**
    ```json
    {
      "taskId": "string (random UUID)",
      "tier": "tier1_local | tier2_hybrid | tier3_hosted",
      "taskDescription": "string",
      "milestones": [
        {
          "id": "M01",
          "title": "string",
          "description": "string",
          "inScope": ["string (file paths)"],
          "outOfScope": ["string (file paths)"]
        }
      ]
    }
    ```

### 3.2 `local_execute_milestone`
*   **Purpose:** Instructs the on-device subagent to execute a *single, specific milestone*, running local lints, builds, and test verification before returning logs.
*   **Input Schema (JSON):**
    ```json
    {
      "type": "object",
      "properties": {
        "taskId": {
          "type": "string",
          "description": "The active task ID generated during planning"
        },
        "milestoneId": {
          "type": "string",
          "description": "The specific milestone identifier (e.g., 'M01')"
        },
        "context": {
          "type": "string",
          "description": "Optional extra user instruction or context modifications made in chat"
        }
      },
      "required": ["taskId", "milestoneId"]
    }
    ```
*   **On-Device Operations:**
    1.  Loads the active plan file `.wrapper/runs/active-plan.json`.
    2.  Extracts the target milestone and generates an on-demand, focused `AgentBrief`.
    3.  Launches `SubAgentDelegate` to execute local code modifications inside the `inScope` boundaries.
    4.  Triggers workspace-specific automated checks (linting, compiling, running tests).
    5.  Appends execution success, modified files, and compilation stdout to `active-plan.json`.
    6.  Returns the milestone execution report.
*   **Output Structure (JSON):**
    ```json
    {
      "success": "boolean",
      "filesModified": ["string (file paths)"],
      "logs": "string (lint/test suite output)",
      "status": "completed | failed"
    }
    ```

---

## 4. Shared State Sync (`active-plan.json`)

To preserve bidirectional progress transparency, the MCP server updates a single active state file `.wrapper/runs/active-plan.json` at every step.

```json
{
  "version": 1,
  "taskId": "a8f3b2c",
  "taskDescription": "Implement database session storage",
  "tier": "tier2_hybrid",
  "status": "in_progress",
  "milestones": [
    {
      "id": "M01",
      "title": "Database Schema Creation",
      "description": "Create PostgreSQL table schema for session storage",
      "status": "completed",
      "assignedTo": "local-subagent",
      "inScope": ["prisma/schema.prisma"],
      "outOfScope": ["src/middleware.ts"],
      "result": {
        "success": true,
        "filesModified": ["prisma/schema.prisma"],
        "logs": "Prisma migration generated successfully."
      }
    },
    {
      "id": "M02",
      "title": "Auth Middleware Hook",
      "description": "Check session in database and attach user context",
      "status": "pending",
      "assignedTo": "hosted-agent",
      "inScope": ["src/middleware.ts"],
      "outOfScope": []
    }
  ],
  "createdAt": "2026-06-17T13:30:00.000Z",
  "updatedAt": "2026-06-17T13:35:00.000Z"
}
```

---

## 5. Security & Isolation Controls

1.  **Boundary Enforcement:** `local_execute_milestone` restricts file writes to the files defined in `inScope`. If the subagent attempts to write to files flagged as `outOfScope`, the execution is halted and reports a violation error.
2.  **No Direct Network Infiltration:** Local on-device agents do not have outbound internet access. They rely entirely on pre-indexed local files, keeping proprietary code secure and preventing remote exploit vectors during autonomous execution.
3.  **Handoff Isolation:** Upon task failure, the local framework does not automatically attempt recursive corrections unless verified by the hosted agent, preventing compounding linter errors.

---

## 6. Implementation Checklist & Verification

*   [x] Register `local_draft_plan` tool metadata and execution hooks in MCP server.
*   [x] Register `local_execute_milestone` tool metadata and execution hooks in MCP server.
*   [x] Integrate local semantic indexing (`retrieveContext`) into the plan-drafting workflow.
*   [x] Wire step-by-step milestone routing to `SubAgentDelegate` execution.
*   [x] Implement real-time atomic read/writes to `active-plan.json` for live-state updates.
*   [x] Complete unit testing asserting isolated milestone execution.
*   [x] Verify zero TypeScript compiler or linting regressions.
