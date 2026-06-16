#!/usr/bin/env node
import { setupWorkspace } from "./setup-workspace.js";

const workspaceRoot = process.argv[2] ?? process.env.WRAPPER_WORKSPACE_ROOT ?? process.cwd();
const result = await setupWorkspace(workspaceRoot);

console.log(
  JSON.stringify(
    {
      workspaceRoot: result.workspaceRoot,
      selectedTier: result.profile.selectedTier,
      modelId: result.profile.modelId,
      reason: result.profile.reason
    },
    null,
    2
  )
);
