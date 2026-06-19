# Build Agent Brief

The user wants to build a task-scoped execution brief for a Cursor agent. Call the `build_agent_brief` MCP tool with their task and optional parameters.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `build_agent_brief` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Return:
- A clear summary of the generated brief (goal, inScope, constraints, etc.)
- The path to the generated brief under `.wrapper/runs/`
- Instructions on how to pass the brief to a new chat or sub-agent (e.g. using `@` to reference the brief file)

Do not generate a brief again unless the user asks.
