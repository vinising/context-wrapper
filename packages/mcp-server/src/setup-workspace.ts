import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { createContextStore } from "@wrapper/context-store";
import { recommendModelProfile } from "@wrapper/model-router";

export type SetupWorkspaceResult = {
  workspaceRoot: string;
  profile: ReturnType<typeof recommendModelProfile>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function exploreProject(resolvedRoot: string): Promise<{
  projectName: string;
  projectGoal: string;
  summary: string;
  currentFocus: string;
  constraints: string[];
  nextSteps: string[];
}> {
  let projectName = basename(resolvedRoot) || "Workspace";
  let projectGoal = "Maintain local context handoff and prompt refinement for Cursor.";
  let projectType = "generic";
  const indicators: string[] = [];
  const constraints: string[] = ["Local sidecar only", "Do not log raw secrets"];
  const nextSteps: string[] = ["Run prompt refinement", "Update context handoff"];

  // 1. Try to read package.json
  const pkgJsonPath = join(resolvedRoot, "package.json");
  if (await fileExists(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
      if (pkg.name) projectName = pkg.name;
      if (pkg.description) projectGoal = pkg.description;
      projectType = "Node.js";
      indicators.push("package.json (Node.js)");
    } catch {
      // ignore JSON parse errors
    }
  }

  // 2. Try to read Cargo.toml
  const cargoPath = join(resolvedRoot, "Cargo.toml");
  if (await fileExists(cargoPath)) {
    projectType = "Rust";
    indicators.push("Cargo.toml (Rust)");
  }

  // 3. Try to read pyproject.toml / requirements.txt
  if (await fileExists(join(resolvedRoot, "pyproject.toml")) || await fileExists(join(resolvedRoot, "requirements.txt"))) {
    projectType = "Python";
    indicators.push("Python configuration");
  }

  // 4. Try to read go.mod
  if (await fileExists(join(resolvedRoot, "go.mod"))) {
    projectType = "Go";
    indicators.push("go.mod (Go)");
  }

  // 5. Check directories
  if (await dirExists(join(resolvedRoot, "src"))) indicators.push("src/ directory");
  if (await dirExists(join(resolvedRoot, "tests")) || await dirExists(join(resolvedRoot, "test"))) indicators.push("tests/ directory");

  // 6. Try to read README.md for a better projectGoal
  let readmeContent = "";
  const readmeNames = ["README.md", "readme.md", "README.MD"];
  for (const name of readmeNames) {
    const readmePath = join(resolvedRoot, name);
    if (await fileExists(readmePath)) {
      try {
        readmeContent = await readFile(readmePath, "utf8");
        break;
      } catch {
        // ignore
      }
    }
  }

  if (readmeContent) {
    const lines = readmeContent.split("\n");
    let goalDraft = "";
    for (const line of lines) {
      const clean = line.trim();
      if (!clean) continue;
      if (clean.startsWith("#") || clean.startsWith("!") || clean.startsWith("[") || clean.startsWith("<")) {
        continue;
      }
      goalDraft = clean;
      break;
    }
    if (goalDraft && goalDraft.length > 20) {
      projectGoal = goalDraft;
    }
  }

  const summary = `Local context wrapper initialized for this ${projectType} workspace. Automatically detected starting indicators: ${indicators.join(", ") || "none"}.`;
  const currentFocus = `Aligning local context wrapper with ${projectName} codebase conventions.`;

  return {
    projectName,
    projectGoal,
    summary,
    currentFocus,
    constraints,
    nextSteps
  };
}

export async function setupWorkspace(workspaceRoot: string): Promise<SetupWorkspaceResult> {
  const resolvedRoot = resolve(workspaceRoot);
  const store = createContextStore(resolvedRoot);

  try {
    await store.readHandoff();
  } catch {
    const exploration = await exploreProject(resolvedRoot);
    await store.initialize({
      projectName: exploration.projectName,
      projectGoal: exploration.projectGoal
    });
    await store.updateHandoff({
      summary: exploration.summary,
      currentFocus: exploration.currentFocus,
      constraints: exploration.constraints,
      nextSteps: exploration.nextSteps
    });
  }
  await store.ensurePolicy();

  const profile = recommendModelProfile();
  const runtimeProfilePath = join(resolvedRoot, ".wrapper/context/runtime-profile.yaml");
  await writeFile(runtimeProfilePath, stringify(profile), { encoding: "utf8", mode: 0o600 });

  return { workspaceRoot: resolvedRoot, profile };
}
