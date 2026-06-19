# Refine Prompt

The user wants local prompt refinement. Call the `refine_prompt` MCP tool with their rough request.

Safety gate (mandatory):
1. Confirm `local-context-wrapper` MCP is enabled in this Cursor session and `refine_prompt` is available.
2. If unavailable, stop immediately and return setup/reconnect guidance (`.cursor/mcp.json`, `npm run setup:cursor -- <workspace-path>`, Cursor reload).
3. Do not run broad debugging loops before this gate passes.

Return:
- refined prompt,
- missing context,
- recommended clarifying questions,
- acceptance criteria or verification hints,
- `historyPath` (saved under `.wrapper/prompts/`),
- whether the prompt is ready for implementation.

If the score is low, ask the recommended questions before coding.

Do not refine again unless the user asks.
