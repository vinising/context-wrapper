# Diagnostic Report

The user wants to run diagnostics and check the health of the Local Context Wrapper setup. Call the `diagnose_setup` MCP tool.

Before deep runtime checks, verify the MCP connection itself:
- Confirm `local-context-wrapper` is enabled and reachable in this Cursor session.
- If the MCP server is unavailable, stop and provide setup/reconnect remediation first (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload), then retry diagnostics.

Return:
- A clear diagnostic checklist (MCP server connectivity, Ollama status, Python virtual environment, required models like gemma4:12b-mlx and nomic-embed-text)
- Status of each check (PASS / FAIL / WARN)
- Recommendations/remediation actions for any failed checks
- An invitation to automatically repair any missing Ollama models if desired
