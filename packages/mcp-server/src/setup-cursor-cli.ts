#!/usr/bin/env node
import { cp, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapperRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const assetsRoot = path.join(wrapperRepoRoot, "packages/cursor-plugin/assets");

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

async function main(): Promise<void> {
  const targetRoot = path.resolve(process.argv[2] ?? process.cwd());
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

  console.log(JSON.stringify({ ok: true, targetRoot, wrapperRepoRoot, runMcpScript, copied }, null, 2));
}

await main();
