# Autonomous Epic Run

The user wants to execute an engineering task autonomously using the local-context-wrapper framework.

To execute this, instruct the developer that you are going to launch the framework's autonomous runner. Run the following shell command directly inside a terminal session:

```bash
npm run autonomous -- "USER_TASK_DESCRIPTION"
```

Once the terminal command completes:
1. Print the results (milestones executed, files modified, and routing tier).
2. Read the updated `.wrapper/context/handoff.md` to refresh your active state.
3. Compare the token consumption and highlight the token savings (including MacBook-free local GPU metrics).
4. Propose next verification steps.
