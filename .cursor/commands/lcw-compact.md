# Compact Conversation History

The user wants to compress the active chat history to mitigate token bloat in Cursor.

Safety gate (mandatory, in this order):
1. Confirm the `local-context-wrapper` MCP server is enabled in the current Cursor session and that the `local_compact_conversation` tool is available.
2. If the MCP server/tool is unavailable, stop immediately and return a concise remediation checklist:
   - Verify `.cursor/mcp.json` contains `local-context-wrapper`
   - Re-run `npm run setup:cursor -- <workspace-path>` if needed
   - Reload Cursor window so MCP reconnects
   - Re-try with a lightweight tool call such as `get_context_handoff`
3. Do not run unrelated debugging loops, repo-wide tests, or repeated tool probes when this availability check fails.

Only after the gate passes:
4. Call `local_compact_conversation` with the array of past chat messages from the current conversation (which you can infer from the conversation context) and optionally a specific focal topic.
5. If compaction fails after MCP connectivity is confirmed, then diagnose runtime/model issues (Ollama/model checks) as a secondary step.

Once the tool returns:
1. The tool returns a `cleanSlatePrompt` in a structured, self-contained format containing:
   - **Project** -- name and goal
   - **State (verified)** -- what has been completed and verified
   - **Architecture Decisions** -- rationale for technical choices
   - **Key Files** -- exact file paths with brief descriptions (eliminates search overhead for the new agent)
   - **Pending Topics** -- discussion subjects awaiting user direction (NOT a task queue)
   - **Behavioral Contract** -- mandatory STOP-AND-WAIT instructions for the receiving agent
2. Present the "Clean-Slate Prompt" to the user, advising them that they can copy this prompt, click the "New Chat" (or Cmd + L) button, and paste it to resume the session with zero token bloat and full context.
3. The new agent does NOT need to call `get_context_handoff` -- all context is embedded directly in the prompt. The behavioral contract instructs it to greet and wait for user instructions.
4. Do NOT call `update_context_handoff` after compaction -- the tool already writes `.wrapper/context/current.yaml` and `handoff.md` on disk.
5. **Graceful Fallback Routing:** If the tool output contains `[OLLAMA_BUSY_FALLBACK]`, this indicates that the local Ollama service is busy or offline. In this case, do NOT fail or run debugging loops. Instead, act as the fallback engine: perform the compaction yourself using your hosted context and reasoning, structure it into the same delimited format (Project, State, Key Files, Pending Topics, Behavioral Contract), present it directly to the user, and write the updated handoff to disk by calling `update_context_handoff`.
