# Refresh Context Handoff

The user wants to update project memory. Call `update_context_handoff` after summarizing recent progress.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `update_context_handoff` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Capture:
- concise summary,
- current focus,
- important constraints,
- next steps.

Keep the handoff brief enough to fit into future agent context without crowding out task-specific details.

Confirm what was written to `.wrapper/context/current.yaml` and `handoff.md`.
