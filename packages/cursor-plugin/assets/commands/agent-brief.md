# Build Agent Brief

The user wants to build a task-scoped execution brief for a Cursor agent. Call the `build_agent_brief` MCP tool with their task and optional parameters.

Return:
- A clear summary of the generated brief (goal, inScope, constraints, etc.)
- The path to the generated brief under `.wrapper/runs/`
- Instructions on how to pass the brief to a new chat or sub-agent (e.g. using `@` to reference the brief file)

Do not generate a brief again unless the user asks.
