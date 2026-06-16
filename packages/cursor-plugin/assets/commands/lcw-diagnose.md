# Diagnostic Report

The user wants to run diagnostics and check the health of the Local Context Wrapper setup. Call the `diagnose_setup` MCP tool.

Return:
- A clear diagnostic checklist (MCP server connectivity, Ollama status, Python virtual environment, required models like gemma4:e4b and nomic-embed-text)
- Status of each check (PASS / FAIL / WARN)
- Recommendations/remediation actions for any failed checks
- An invitation to automatically repair any missing Ollama models if desired
