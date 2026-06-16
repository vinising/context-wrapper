#!/usr/bin/env node
import { cp, mkdir, writeFile } from "node:fs/promises";
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
          WRAPPER_OLLAMA_MODEL: process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:e4b",
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

  await copyAsset("rules/local-context-wrapper.mdc", targetRoot);
  await copyAsset("commands/lcw-refine.md", targetRoot);
  await copyAsset("commands/lcw-handoff.md", targetRoot);
  await copyAsset("commands/lcw-brief.md", targetRoot);
  await copyAsset("commands/lcw-index.md", targetRoot);
  await copyAsset("commands/lcw-auto.md", targetRoot);
  await copyAsset("commands/lcw-diagnose.md", targetRoot);

  console.log(JSON.stringify({ ok: true, targetRoot, wrapperRepoRoot, runMcpScript }, null, 2));
}

await main();
