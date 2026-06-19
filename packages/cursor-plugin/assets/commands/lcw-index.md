# Index Workspace

The user wants to build or rebuild the local semantic and lexical index of workspace files. Call the `index_workspace` MCP tool.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `index_workspace` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Return:
- A summary of the indexing results (builtAt, mode, chunkCount, fileCount, etc.)
- Confirmation that the index was written to `.wrapper/index/`

Do not index again unless the user asks.
