#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { recommendModelProfile } from "@wrapper/model-router";

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function checkOllamaRunning(): boolean {
  try {
    const res = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:11434/api/tags"], { encoding: "utf8" });
    return res.stdout.trim() === "200";
  } catch {
    return false;
  }
}

async function main() {
  const targetRoot = path.resolve(process.argv[2] ?? process.cwd());
  const profile = recommendModelProfile();
  const requiredOllamaModel = process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx";

  console.log(`\n======================================================`);
  console.log(`🔍 LOCAL CONTEXT WRAPPER: Diagnostic Report`);
  console.log(`======================================================`);
  console.log(`Target Workspace: ${targetRoot}`);
  console.log(`Detected Platform: ${profile.detected.platform} (${profile.detected.arch})`);
  console.log(`System Memory: ${profile.detected.memoryGb} GB`);
  console.log(`Recommended Tier: ${profile.selectedTier.toUpperCase()}`);
  console.log(`Recommended Model: ${profile.modelId}`);
  console.log(`======================================================\n`);

  let allPassed = true;
  const recommendations: string[] = [];

  // Check 1: Workspace Folder .wrapper/
  const wrapperDir = path.join(targetRoot, ".wrapper");
  if (await dirExists(wrapperDir)) {
    console.log("📂 [PASS] Workspace Directory: .wrapper/ folder exists and is initialized.");
  } else {
    console.log("📂 [FAIL] Workspace Directory: .wrapper/ folder is NOT initialized!");
    allPassed = false;
    recommendations.push("Initial project config is missing. Run `lcw setup` inside this folder to initialize context memory.");
  }

  // Check 2: Cursor configuration
  const mcpJson = path.join(targetRoot, ".cursor/mcp.json");
  let hasMcp = false;
  try {
    const s = await stat(mcpJson);
    hasMcp = s.isFile();
  } catch {}

  if (hasMcp) {
    console.log("💻 [PASS] Cursor Integration: .cursor/mcp.json is registered.");
  } else {
    console.log("💻 [WARN] Cursor Integration: .cursor/mcp.json was not found.");
    recommendations.push("Register MCP sidecar by running `lcw setup` to copy slash commands and MDC rules.");
  }

  // Check 3: Ollama Connection
  const ollamaRunning = checkOllamaRunning();
  if (ollamaRunning) {
    console.log("🟢 [PASS] Ollama Service: Ollama background server is running and responsive.");
    
    // Check models
    try {
      const res = spawnSync("curl", ["-s", "http://127.0.0.1:11434/api/tags"], { encoding: "utf8" });
      const data = JSON.parse(res.stdout) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);

      const modelInstalled = models.some(
        (name) => name === requiredOllamaModel || name.startsWith(`${requiredOllamaModel}:`)
      );
      if (modelInstalled) {
        console.log(`🤖 [PASS] Ollama Model: Found required model installed: ${models.find((m) => m === requiredOllamaModel || m.startsWith(`${requiredOllamaModel}:`)) || requiredOllamaModel}`);
      } else {
        console.log(`🤖 [FAIL] Ollama Model: Required model ${requiredOllamaModel} is missing!`);
        allPassed = false;
        recommendations.push(`Pull the required model by running \`ollama pull ${requiredOllamaModel}\`.`);
      }

      const embedInstalled = models.some((name) => name.startsWith("nomic-embed-text"));
      if (embedInstalled) {
        console.log("🏷️  [PASS] Ollama Embed: Found nomic-embed-text embedding model.");
      } else {
        console.log("🏷️  [FAIL] Ollama Embed: Required nomic-embed-text model is missing!");
        allPassed = false;
        recommendations.push("Pull the embedding model by running `ollama pull nomic-embed-text`.");
      }
    } catch {
      console.log("🤖 [FAIL] Ollama Models: Could not list local models from Ollama API.");
      allPassed = false;
    }
  } else {
    console.log("🟢 [FAIL] Ollama Service: Offline! Could not connect to http://127.0.0.1:11434.");
    allPassed = false;
    recommendations.push("Ensure Ollama is started. Run `ollama serve` in a terminal or launch the Ollama desktop app.");
  }

  // Check 4: Python environment
  let hasVenv = false;
  const venvNames = [".venv", "venv"];
  for (const name of venvNames) {
    if (await dirExists(path.join(targetRoot, name))) {
      hasVenv = true;
      break;
    }
  }

  if (hasVenv || !!process.env.VIRTUAL_ENV) {
    console.log("🐍 [PASS] Python Virtual Environment: Active local virtual environment detected.");
  } else {
    if (profile.selectedTier === "fallback") {
      console.log("🐍 [PASS] Python Virtual Environment: Optional (Ollama fallback mode matches this machine's profile).");
    } else {
      console.log("🐍 [WARN] Python Virtual Environment: Local virtual environment (.venv) was not found.");
      recommendations.push("To execute native MLX acceleration locally on Apple Silicon, bootstrap the environment with `lcw setup`.");
    }
  }

  console.log(`\n======================================================`);
  if (allPassed) {
    console.log(`🎉 ALL CHECKS PASSED! Setup is fully healthy and ready.`);
  } else {
    console.log(`⚠️  DIAGNOSTICS DETECTED CONCERNS! Please see recommendations.`);
  }
  console.log(`======================================================`);

  if (recommendations.length > 0) {
    console.log("\nRemediation Checklist:");
    recommendations.forEach((rec, idx) => {
      console.log(`  ${idx + 1}. ${rec}`);
    });
    console.log("");
  }
}

main().catch((err) => {
  console.error("Diagnostic error:", err);
  process.exit(1);
});
