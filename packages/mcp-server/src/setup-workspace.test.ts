import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { setupWorkspace } from "./setup-workspace.js";

describe("setupWorkspace", () => {
  it("initializes .wrapper context and runtime profile", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-setup-"));
    try {
      const result = await setupWorkspace(workspace);
      const currentYaml = await readFile(join(workspace, ".wrapper/context/current.yaml"), "utf8");
      const runtimeYaml = await readFile(join(workspace, ".wrapper/context/runtime-profile.yaml"), "utf8");
      const policyYaml = await readFile(join(workspace, ".wrapper/policy.yaml"), "utf8");

      expect(result.workspaceRoot).toBe(workspace);
      expect(currentYaml).toContain("project:");
      expect(runtimeYaml).toContain("selectedTier:");
      expect(policyYaml).toContain("promptHistory:");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
