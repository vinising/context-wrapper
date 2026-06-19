#!/usr/bin/env node
import { execSync, spawn, spawnSync } from "node:child_process";
import { cp, mkdir, stat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupWorkspace } from "./setup-workspace.js";

const wrapperRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const assetsRoot = path.join(wrapperRepoRoot, "packages/cursor-plugin/assets");

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function copyAsset(relativePath: string, targetRoot: string): Promise<void> {
  const source = path.join(assetsRoot, relativePath);
  const destination = path.join(targetRoot, ".cursor", relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function copyAllAssets(targetRoot: string): Promise<string[]> {
  const copied: string[] = [];

  // Dynamically copy all rules (.mdc)
  const rulesSrc = path.join(assetsRoot, "rules");
  try {
    const files = await readdir(rulesSrc);
    for (const file of files) {
      if (file.endsWith(".mdc")) {
        await copyAsset(path.join("rules", file), targetRoot);
        copied.push(`rules/${file}`);
      }
    }
  } catch (err) {
    // Ignore if directory missing
  }

  // Dynamically copy all commands (.md)
  const commandsSrc = path.join(assetsRoot, "commands");
  try {
    const files = await readdir(commandsSrc);
    for (const file of files) {
      if (file.endsWith(".md")) {
        await copyAsset(path.join("commands", file), targetRoot);
        copied.push(`commands/${file}`);
      }
    }
  } catch (err) {
    // Ignore if directory missing
  }

  return copied;
}

function checkOllamaRunning(): boolean {
  try {
    const res = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:11434/api/tags"], { encoding: "utf8" });
    return res.stdout.trim() === "200";
  } catch {
    return false;
  }
}

function isCommandAvailable(cmd: string): boolean {
  try {
    spawnSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function runOllamaPull(model: string): Promise<void> {
  console.log(`\n⬇️  Pulling Ollama model: ${model}...`);
  return new Promise((resolve) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Successfully pulled ${model}`);
      } else {
        console.log(`⚠️  Ollama pull for ${model} exited with code ${code}`);
      }
      resolve();
    });
  });
}

async function main() {
  const targetRoot = path.resolve(process.argv[2] ?? process.cwd());
  console.log(`\n======================================================`);
  console.log(`🚀 LOCAL CONTEXT WRAPPER: End-to-End Autonomous Setup`);
  console.log(`======================================================`);
  console.log(`Workspace Path: ${targetRoot}`);

  // 1. Run Workspace Setup (includes automated project exploration!)
  console.log("\n🧭 1. Running Project Exploration and Workspace Seeding...");
  const workspaceResult = await setupWorkspace(targetRoot);
  console.log(`✅ Workspace context initialized successfully!`);
  console.log(`   Project Name: ${workspaceResult.workspaceRoot ? path.basename(workspaceResult.workspaceRoot) : "Detected Workspace"}`);
  console.log(`   Machine Profile Tier: ${workspaceResult.profile.selectedTier}`);
  console.log(`   Recommended Local Model: ${workspaceResult.profile.modelId}`);

  // 2. Setup Cursor Integration (mcp.json, slash commands, rules)
  console.log("\n💻 2. Installing Cursor Integration & Slash Commands...");
  const runMcpScript = path.join(wrapperRepoRoot, "scripts/run-mcp.sh");
  const mcpConfig = {
    mcpServers: {
      "local-context-wrapper": {
        command: "bash",
        args: [runMcpScript],
        env: {
          WRAPPER_WORKSPACE_ROOT: targetRoot,
          WRAPPER_RUNTIME: process.env.WRAPPER_RUNTIME ?? "ollama",
          WRAPPER_OLLAMA_MODEL: process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx",
          WRAPPER_OLLAMA_NUM_CTX: process.env.WRAPPER_OLLAMA_NUM_CTX ?? "65536",
          WRAPPER_OLLAMA_EMBED_MODEL: process.env.WRAPPER_OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
          OLLAMA_HOST: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"
        }
      }
    }
  };

  await mkdir(path.join(targetRoot, ".cursor"), { recursive: true });
  await writeFile(
    path.join(targetRoot, ".cursor/mcp.json"),
    `${JSON.stringify(mcpConfig, null, 2)}\n`,
    { mode: 0o600 }
  );

  const copied = await copyAllAssets(targetRoot);
  console.log(`✅ Cursor registration complete! (.cursor/mcp.json created, ${copied.length} slash commands and rules dynamically copied)`);

  // 3. System Checks & Auto-Installers
  console.log("\n⚙️  3. Verifying Local Model Runtimes...");

  // Check Ollama
  if (!isCommandAvailable("ollama")) {
    console.log("❌ Ollama CLI is not installed.");
    if (process.platform === "darwin" && isCommandAvailable("brew")) {
      console.log("🍺 Homebrew detected. Installing Ollama via brew...");
      spawnSync("brew", ["install", "ollama"], { stdio: "inherit" });
    } else {
      console.log("👉 Please download and install Ollama from https://ollama.com");
    }
  }

  if (isCommandAvailable("ollama")) {
    // Check if running
    let running = checkOllamaRunning();
    if (!running) {
      console.log("🔄 Ollama is installed but not running. Launching background service...");
      const ollamaService = spawn("ollama", ["serve"], {
        detached: true,
        stdio: "ignore"
      });
      ollamaService.unref();

      // Poll up to 5 times
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        running = checkOllamaRunning();
        if (running) break;
      }
    }

    if (running) {
      console.log("🟢 Ollama local background service is running.");
      // Pull required models
      await runOllamaPull("gemma4:12b-mlx");
      await runOllamaPull("nomic-embed-text");
    } else {
      console.log("⚠️  Could not start Ollama service automatically. Please start the Ollama application manually.");
    }
  }

  // Check Python environment (Conditional virtual environment bootstrapping)
  const venvDir = path.join(targetRoot, ".venv");
  const altVenvDir = path.join(targetRoot, "venv");
  const hasVenv = (await dirExists(venvDir)) || (await dirExists(altVenvDir)) || !!process.env.VIRTUAL_ENV;

  if (hasVenv) {
    console.log("🟢 Existing Python virtual environment detected. Skipping MLX environment bootstrapping.");
  } else {
    console.log("📦 No Python virtual environment found. Bootstrapping MLX virtual environment...");
    if (isCommandAvailable("python3")) {
      console.log("🐍 Creating local python virtual environment (.venv)...");
      const venvRes = spawnSync("python3", ["-m", "venv", ".venv"], { stdio: "inherit", cwd: targetRoot });
      if (venvRes.status === 0) {
        console.log("✅ Virtual environment created. Installing MLX dependencies...");
        const pipPath = path.join(targetRoot, ".venv/bin/pip");
        const reqsPath = path.join(wrapperRepoRoot, "scripts/requirements-mlx.txt");
        if (await fileExists(pipPath) && await fileExists(reqsPath)) {
          spawnSync(pipPath, ["install", "--upgrade", "pip"], { stdio: "inherit" });
          spawnSync(pipPath, ["install", "-r", reqsPath], { stdio: "inherit" });
          console.log("✅ MLX dependencies successfully installed.");
        } else {
          console.log("⚠️  Could not find pip or requirements-mlx.txt. Skipping dependency installation.");
        }
      } else {
        console.log("❌ Failed to create virtual environment.");
      }
    } else {
      console.log("⚠️  python3 command is not available. Please install Python 3 to support local MLX execution.");
    }
  }

  console.log(`\n======================================================`);
  console.log(`🎉 SETUP COMPLETE!`);
  console.log(`======================================================`);
  console.log(`👉 Please reload your Cursor window to connect the MCP sidecar.`);
  console.log(`👉 You can now use the new prefix /lcw- in Cursor chat!`);
  console.log(`👉 Run '/lcw-diagnose' inside Cursor to verify setup at any time.`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("❌ Setup failed with error:", err);
  process.exit(1);
});
