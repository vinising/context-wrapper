# Get Code Signature Map

The user wants to explore a file's structure and understand its business logic without reading full implementation bodies.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `get_code_signature_map` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Call the `get_code_signature_map` MCP tool, passing the relative path of the file to map.

Once the tool returns, display the Python-indented class and function signature map, explaining that it strips out method implementation bodies for a 90%+ context reduction while retaining brief on-device LLM-generated business descriptions.

**Graceful Fallback Routing:** If the tool output contains `[OLLAMA_BUSY_FALLBACK]`, this indicates that the local Ollama service is busy or offline. In this case, do NOT fail or run debugging loops. Instead, act as the fallback engine: read the file (using the Retrieve-First policy if large), extract the class and function signatures yourself, write brief 5-10 word business descriptions for each, and display the Python-indented signature map directly to the user.
