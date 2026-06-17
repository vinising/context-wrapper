# Autonomous Epic Run

The user wants to execute an engineering task autonomously using the local-context-wrapper framework.

To execute this task in a clean, interactive, hybrid workflow:

1. **Draft the Plan (Plan Mode):**
   Call the `local_draft_plan` MCP tool with the user's task description to scan the workspace and generate draft milestones on-device.
2. **Present and Enhance Plan:**
   Display the draft plan to the user in the Cursor Chat. Use your superior reasoning to audit the milestones, add security/architectural guidelines, and ask the user for approval.
3. **Execute Milestones (Agent/Build Mode):**
   Once approved, iterate through the milestones:
   *   For boilerplate, routine, or setup tasks, call `local_execute_milestone` with detailed `context` (micro-specs) to implement on-device.
   *   For highly critical or complex logical changes, write the code directly inside Cursor Chat.
4. **Confirm and Refresh Handoff:**
   Once the milestones are complete, read `.wrapper/context/handoff.md` to refresh your active state and propose next verification steps.

   **CRITICAL (Zero-History Reset):** Once all milestones have completed successfully, check the workspace policy `contextManagement` parameters. If `contextManagement.zeroHistoryReset` is enabled (which is true by default), you MUST append this exact user-friendly prompt at the very end of your final response:
   `🌟 Your context handoff is complete and successfully synchronized to disk. Would you like me to clear our chat context to keep our history lightweight and ultra-responsive?`
