# Guarded File Read

The user wants to read a file with strict token and context controls.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `local_file_read` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Execution:
1. Call `local_file_read` with `mode: "auto"` unless the user explicitly requests:
   - `raw_window` for direct line-window reads,
   - `signature_map` for code structure projection,
   - `summary_blocks` for non-code block summaries.
2. Respect threshold blocking:
   - If output status is `blocked_threshold`, rerun with `signature_map` or `summary_blocks`.
3. Cache-aware behavior:
   - If output includes `fromCache: true`, report that cached projection was reused.
4. If output includes `requiresHostedWorker: true`, route to a cheap hosted worker summarizer and return the final projection.

Do not read full files directly when a projection mode is available.
