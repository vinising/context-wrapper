# Refresh Project Docs

The user wants to refresh documentation hygiene using the local-context-wrapper flow.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `local_refresh_docs` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Execution:
1. Call `local_refresh_docs` with:
   - `scope: "smart_touched"` by default
   - `scope: "full"` only when the user explicitly requests full docs refresh
2. Present:
   - touched files used for targeting,
   - doc targets selected,
   - updated/skipped doc files,
   - concise summary of what changed.
3. If gaps remain, propose focused follow-up edits (not broad rewrites).

Do not run `git push` as part of this command.
