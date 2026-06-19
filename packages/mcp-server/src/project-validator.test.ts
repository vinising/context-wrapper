import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createContextStore } from "@wrapper/context-store";
import { resolveValidationCommand, runValidationCommand } from "./project-validator.js";

describe("project validator", () => {
  it("prefers policy validation command overrides", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-validator-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Validator",
        projectGoal: "Test command resolution"
      });
      const policy = await store.readPolicy();
      policy.autonomous.validationCommand = ["node", "-e", "process.exit(0)"];

      const resolution = await resolveValidationCommand(workspace, policy);
      expect(resolution).not.toBeNull();
      expect(resolution?.source).toBe("policy");
      expect(resolution?.command).toEqual(["node", "-e", "process.exit(0)"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("detects node test commands from package metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-validator-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Validator",
        projectGoal: "Test command resolution"
      });
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          name: "sample-node-project",
          scripts: {
            test: "vitest run"
          }
        })
      );
      await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
      const policy = await store.readPolicy();

      const resolution = await resolveValidationCommand(workspace, policy);
      expect(resolution).not.toBeNull();
      expect(resolution?.source).toBe("detected");
      expect(resolution?.command).toEqual(["pnpm", "test"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("returns null when no validation command can be detected", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-validator-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Validator",
        projectGoal: "Test command resolution"
      });
      const policy = await store.readPolicy();

      const resolution = await resolveValidationCommand(workspace, policy);
      expect(resolution).toBeNull();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("executes validation commands and reports pass/fail status", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-validator-"));
    try {
      const passing = await runValidationCommand(
        workspace,
        {
          source: "policy",
          command: ["node", "-e", "process.exit(0)"],
          reason: "Explicit policy override"
        },
        10000
      );
      expect(passing.success).toBe(true);
      expect(passing.exitCode).toBe(0);

      const failing = await runValidationCommand(
        workspace,
        {
          source: "policy",
          command: ["node", "-e", "process.exit(1)"],
          reason: "Explicit policy override"
        },
        10000
      );
      expect(failing.success).toBe(false);
      expect(failing.exitCode).toBe(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
