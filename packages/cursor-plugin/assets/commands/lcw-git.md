# Git Hygiene Checkpoint

The user wants a safe git hygiene pass (diff summary + optional commit) under local-context-wrapper.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `local_git_hygiene` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Execution:
1. Call `local_git_hygiene` in `plan_scoped` mode by default.
2. Present:
   - changed files detected,
   - files selected for staging,
   - diff summary and commit status.
3. If the user explicitly asks, rerun with `commit: true`.
4. Never push automatically. Push requires explicit user approval every time.

If no plan-scoped files are detected, report this clearly and ask the user whether to switch to `all_tracked`.
