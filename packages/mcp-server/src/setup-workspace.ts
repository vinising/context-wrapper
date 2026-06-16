import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { createContextStore } from "@wrapper/context-store";
import { recommendModelProfile } from "@wrapper/model-router";

export type SetupWorkspaceResult = {
  workspaceRoot: string;
  profile: ReturnType<typeof recommendModelProfile>;
};

export async function setupWorkspace(workspaceRoot: string): Promise<SetupWorkspaceResult> {
  const resolvedRoot = resolve(workspaceRoot);
  const store = createContextStore(resolvedRoot);

  try {
    await store.readHandoff();
  } catch {
    await store.initialize({
      projectName: basename(resolvedRoot) || "Workspace",
      projectGoal: "Maintain local context handoff and prompt refinement for Cursor."
    });
  }
  await store.ensurePolicy();

  const profile = recommendModelProfile();
  const runtimeProfilePath = join(resolvedRoot, ".wrapper/context/runtime-profile.yaml");
  await writeFile(runtimeProfilePath, stringify(profile), { encoding: "utf8", mode: 0o600 });

  return { workspaceRoot: resolvedRoot, profile };
}
