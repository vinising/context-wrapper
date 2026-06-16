# Hook Guidance

Cursor does not currently support transparent mutation of built-in chat prompts through public extension APIs.

Use hooks as guardrails:

- `sessionStart`: load or remind about `.wrapper/context/handoff.md`.
- `beforeSubmitPrompt`: score prompt quality and warn when critical context is missing.
- `postToolUse`: refresh handoff after meaningful implementation progress.

Hooks should not log raw prompts when workspace policy disables prompt logs, and must redact secrets before writing anything under `.wrapper/runs/`.
