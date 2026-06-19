# Autonomous Epic Run

The user wants to execute an engineering task autonomously using the local-context-wrapper framework.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and both `local_draft_plan` and `local_execute_milestone` are available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

**CRITICAL (Dual-Intent Queries):** If the user's query contains conceptual questions, explanations, or requests for alternatives alongside the `/lcw-auto` command, you **MUST** answer those questions first and discuss the alternatives in your response text before calling `local_draft_plan` or presenting the plan. Do not let the automation pipeline swallow the user's conversational intent.

To execute this task in a clean, interactive, hybrid workflow:

1. **Refine Prompt First (Mandatory):**
   Call the `refine_prompt` MCP tool with the user's raw task description. This uses Ollama to read the current local context handoff and return:
   - `refinedPrompt`: optimized task spec for planning/execution
   - `targetFiles`: file anchors with line ranges and concise reasons (derived from retrieval)

   Use `refinedPrompt` and `targetFiles` as the primary grounding context for all subsequent steps.
2. **Draft the Plan (Plan Mode):**
   Using your superior reasoning as a hosted agent, design a precise, high-quality milestone roadmap based on the `refinedPrompt`.
   - Identify how validation should run for this workspace (policy override in `.wrapper/policy.yaml` if present, otherwise detect project defaults).
   - Ensure milestones include concrete verification expectations (command(s), target scope, and pass/fail signal).
   - Prefer files from `targetFiles` before any additional exploration. Do not broad-search if anchors already cover the task scope.
   - Call the `local_draft_plan` MCP tool, passing the `task` (the `refinedPrompt`) and the `milestones` array you designed. This bypasses slow on-device planning and registers your plan directly.
3. **Present and Ask for Approval:**
   Display the refined prompt and the milestone plan to the user in the Cursor Chat, and ask for their approval before proceeding.
4. **Pre-Load Context Once (Mandatory):**
   After approval and before milestone execution:
   - Build a unified file manifest from `targetFiles` + milestone file references.
   - Use `local_file_read` as the default read path for this stage. Only use raw windows when the requested window is within policy threshold.
   - Read `.wrapper/policy.yaml` and use `contextManagement.directorRawReadMaxLines` as the maximum direct raw-read window (default: 50 lines).
   - Do **not** perform raw full-file reads above this limit. For larger files, call `get_code_signature_map` first and read only targeted windows capped by the configured threshold.
   - For non-code docs or broad narrative files, generate compact projections using a cheap hosted worker only when needed; if Ollama is unavailable and `contextManagement.useCheapHostedWorkerWhenOllamaUnavailable` is true, prefer the cheap hosted worker path before any broad read.
   - Read each target artifact once, extract only the minimal snippets needed for implementation, and cache them in your working context.
   - Use these snippets to write milestone micro-specs in `local_execute_milestone.context` so execution does not trigger repeated discovery reads.
5. **Execute Milestones (Agent/Build Mode):**
   Once approved, iterate through the milestones:
   *   Every milestone MUST pass through `local_execute_milestone` to enforce routing/provenance. Do not bypass this checkpoint.
   *   Decompose the milestone into concrete micro-tasks yourself, and provide them as a bulleted list inside the `context` parameter (micro-specs). Reuse pre-loaded snippets and anchors to avoid re-reading.
   *   In each milestone context, explicitly include validation intent: which test command to run (or auto-detect), what should be verified, and what constitutes failure.
   *   Hosted/manual coding is allowed only when the user explicitly opts out. In that case call `local_execute_milestone` with `executionMode: "hosted_opt_out"` and `optOutReason` before proceeding, so the deviation is recorded.
6. **Context Reuse Contract (Mandatory):**
   If the user asks for plan corrections, refinements, or reordered milestones:
   - Reuse existing `targetFiles`, signatures, and pre-loaded snippets.
   - Do not restart broad discovery for unchanged scope.
   - Only run new retrieval/mapping for newly introduced files, modules, or objectives.
7. **Confirm and Refresh Handoff:**
   Once the milestones are complete, read `.wrapper/context/handoff.md` to refresh your active state and propose next verification steps.

8. **Automation Hygiene (Mandatory at Plan Completion):**
   After the plan reaches `completed` status:
   - Run `local_refresh_docs` with `scope: "smart_touched"` to refresh relevant docs (`README`/technical reference/onboarding as needed by touched files).
   - Run `local_git_hygiene` in `plan_scoped` mode to produce a safe summary and auto-commit plan-owned + refreshed doc files.
   - Do **NOT** push automatically. Push is always a separate, explicit user approval step.

9. **Long-Run Hygiene Prompting (Mandatory):**
   During long sessions, if completed milestones >= 5 OR changed lines >= 200, proactively recommend an interim hygiene pass:
   - `/lcw-docs` for documentation refresh
   - `/lcw-git` for checkpoint commit prep

   **CRITICAL (Zero-History Reset):** Once all milestones have completed successfully, check the workspace policy `contextManagement` parameters. If `contextManagement.zeroHistoryReset` is enabled (which is true by default), you MUST append this exact user-friendly prompt at the very end of your final response:
   `🌟 Your context handoff is complete and successfully synchronized to disk. Would you like me to clear our chat context to keep our history lightweight and ultra-responsive?`
