# Refine Prompt

The user wants local prompt refinement. Call the `refine_prompt` MCP tool with their rough request.

Return:
- refined prompt,
- missing context,
- recommended clarifying questions,
- acceptance criteria or verification hints,
- `historyPath` (saved under `.wrapper/prompts/`),
- whether the prompt is ready for implementation.

If the score is low, ask the recommended questions before coding.

Do not refine again unless the user asks.
