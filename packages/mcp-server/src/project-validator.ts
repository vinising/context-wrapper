import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { WorkspacePolicy, ValidationRun } from "@wrapper/schemas";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_CHARS = 20000;

export type ValidationCommandResolution = {
  command: string[];
  source: "policy" | "detected";
  reason: string;
};

export async function resolveValidationCommand(
  workspaceRoot: string,
  policy: WorkspacePolicy
): Promise<ValidationCommandResolution | null> {
  const policyCommand = policy.autonomous.validationCommand ?? [];
  if (policyCommand.length > 0) {
    return {
      command: policyCommand,
      source: "policy",
      reason: "Using policy override from autonomous.validationCommand."
    };
  }

  const packageJson = await readPackageJson(workspaceRoot);
  const testScript = packageJson?.scripts?.test;
  if (typeof testScript === "string" && hasRunnableTestScript(testScript)) {
    return {
      command: [detectNodeTestRunner(workspaceRoot), "test"],
      source: "detected",
      reason: "Detected Node.js project with a runnable test script."
    };
  }

  if (await fileExists(`${workspaceRoot}/pyproject.toml`) || await fileExists(`${workspaceRoot}/pytest.ini`)) {
    return {
      command: ["python", "-m", "pytest"],
      source: "detected",
      reason: "Detected Python project settings."
    };
  }

  if (await fileExists(`${workspaceRoot}/go.mod`)) {
    return {
      command: ["go", "test", "./..."],
      source: "detected",
      reason: "Detected Go project."
    };
  }

  if (await fileExists(`${workspaceRoot}/Cargo.toml`)) {
    return {
      command: ["cargo", "test"],
      source: "detected",
      reason: "Detected Rust project."
    };
  }

  return null;
}

export async function runValidationCommand(
  workspaceRoot: string,
  resolution: ValidationCommandResolution,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ValidationRun> {
  const command = resolution.command;
  const executable = command[0];
  if (!executable) {
    return {
      attempted: true,
      success: false,
      source: resolution.source,
      output: "Validation command is empty."
    };
  }

  const args = command.slice(1);
  const startedAt = Date.now();

  return await new Promise<ValidationRun>((resolve) => {
    let output = "";
    let timedOut = false;
    const append = (chunk: string) => {
      if (output.length >= MAX_OUTPUT_CHARS) {
        return;
      }
      output += chunk.slice(0, MAX_OUTPUT_CHARS - output.length);
    };

    const child = spawn(executable, args, {
      cwd: workspaceRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      append(chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      append(chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        attempted: true,
        success: false,
        source: resolution.source,
        command,
        durationMs: Date.now() - startedAt,
        output: `Failed to start validation command: ${error.message}`
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const exitCode = typeof code === "number" ? code : undefined;
      const success = !timedOut && exitCode === 0;
      const timeoutNote = timedOut ? `\nValidation command timed out after ${timeoutMs}ms.` : "";

      resolve({
        attempted: true,
        success,
        source: resolution.source,
        command,
        exitCode,
        durationMs: Date.now() - startedAt,
        output: `${resolution.reason}\n${output.trim()}${timeoutNote}`.trim()
      });
    });
  });
}

function hasRunnableTestScript(script: string): boolean {
  const normalized = script.toLowerCase();
  return !(normalized.includes("no test specified") && normalized.includes("exit 1"));
}

function detectNodeTestRunner(workspaceRoot: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(`${workspaceRoot}/pnpm-lock.yaml`)) {
    return "pnpm";
  }
  if (existsSync(`${workspaceRoot}/yarn.lock`)) {
    return "yarn";
  }
  if (existsSync(`${workspaceRoot}/bun.lock`) || existsSync(`${workspaceRoot}/bun.lockb`)) {
    return "bun";
  }
  return "npm";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(workspaceRoot: string): Promise<{ scripts?: Record<string, string> } | null> {
  try {
    const raw = await readFile(`${workspaceRoot}/package.json`, "utf8");
    return JSON.parse(raw) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}
