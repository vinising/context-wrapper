import { readdir, readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { minimatch } from "minimatch";
import {
  IndexChunk,
  IndexManifest,
  IndexData,
  WorkspacePolicy,
  RetrievalHit
} from "@wrapper/schemas";
import { getEmbedding, cosineSimilarity } from "./embeddings.js";

function matchesAny(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    return minimatch(relativePath, pattern, { dot: true, matchBase: true });
  });
}

async function walkDirectory(
  dir: string,
  root: string,
  policy: WorkspacePolicy,
  fileList: string[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath);

    if (matchesAny(relPath, policy.indexing.exclude)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, root, policy, fileList);
    } else if (entry.isFile()) {
      if (policy.indexing.include.length === 0 || matchesAny(relPath, policy.indexing.include)) {
        fileList.push(fullPath);
      }
    }
  }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = Buffer.alloc(512);
    const fd = await openFile(filePath);
    const { bytesRead } = await fd.read(buffer, 0, 512, 0);
    await fd.close();
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

// Helper to open file for reading (compatibility wrapper)
async function openFile(filePath: string) {
  const fs = await import("node:fs/promises");
  return fs.open(filePath, "r");
}

function chunkText(
  text: string,
  maxChunkSize: number
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = text.split(/\r?\n/);
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  let currentChunkLines: string[] = [];
  let currentChunkLength = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (currentChunkLength + line.length > maxChunkSize && currentChunkLines.length > 0) {
      chunks.push({
        text: currentChunkLines.join("\n"),
        startLine,
        endLine: i
      });
      currentChunkLines = [line];
      currentChunkLength = line.length;
      startLine = i + 1;
    } else {
      currentChunkLines.push(line);
      currentChunkLength += line.length + 1;
    }
  }

  if (currentChunkLines.length > 0) {
    chunks.push({
      text: currentChunkLines.join("\n"),
      startLine,
      endLine: lines.length
    });
  }

  return chunks;
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
}

export async function indexWorkspace(
  workspaceRoot: string,
  policy: WorkspacePolicy,
  options: { force?: boolean; ollamaHost?: string } = {}
): Promise<IndexManifest> {
  const indexDir = join(workspaceRoot, ".wrapper/index");
  const manifestPath = join(indexDir, "manifest.json");
  const chunksPath = join(indexDir, "chunks.json");

  const ollamaHost = options.ollamaHost ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const embedModel = policy.indexing.embedModel;

  const fileList: string[] = [];
  await walkDirectory(workspaceRoot, workspaceRoot, policy, fileList);

  // Safety cap
  const filesToProcess = fileList.slice(0, policy.indexing.maxFiles);

  const allChunks: IndexChunk[] = [];
  let fileCount = 0;

  for (const filePath of filesToProcess) {
    const relPath = relative(workspaceRoot, filePath);
    try {
      const fs = await import("node:fs");
      const stats = fs.statSync(filePath);
      if (stats.size > policy.indexing.maxFileBytes) {
        continue;
      }

      if (await isBinaryFile(filePath)) {
        continue;
      }

      const content = await readFile(filePath, "utf8");
      const fileHash = createHash("sha256").update(content).digest("hex");
      const textChunks = chunkText(content, policy.indexing.chunkCharSize);

      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i]!;
        const chunkId = `${fileHash.slice(0, 12)}-${i}`;
        allChunks.push({
          id: chunkId,
          path: relPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          hash: createHash("sha256").update(chunk.text).digest("hex")
        });
      }

      fileCount++;
    } catch {
      // Skip failed files
    }
  }

  // Try semantic embeddings
  let mode: "semantic" | "lexical" = "lexical";
  if (policy.indexing.enabled && allChunks.length > 0) {
    try {
      for (const chunk of allChunks) {
        chunk.embedding = await getEmbedding({
          host: ollamaHost,
          model: embedModel,
          text: chunk.text
        });
      }
      mode = "semantic";
    } catch {
      // Fall back to lexical mode
      mode = "lexical";
      for (const chunk of allChunks) {
        delete chunk.embedding;
      }
    }
  }

  const manifest: IndexManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    embedModel,
    chunkCount: allChunks.length,
    fileCount,
    mode
  };

  const indexData: IndexData = {
    version: 1,
    chunks: allChunks
  };

  await atomicWriteJson(manifestPath, manifest);
  await atomicWriteJson(chunksPath, indexData);

  return manifest;
}

export function calculateLexicalScore(chunkText: string, query: string): number {
  const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const chunkTokens = chunkText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  if (queryTokens.length === 0) return 0;

  const chunkTokenCounts = new Map<string, number>();
  for (const token of chunkTokens) {
    chunkTokenCounts.set(token, (chunkTokenCounts.get(token) || 0) + 1);
  }

  let score = 0;
  for (const token of queryTokens) {
    if (chunkTokenCounts.has(token)) {
      score += 1 + Math.log(chunkTokenCounts.get(token)!);
    }
  }

  return score;
}

export async function retrieveContext(
  workspaceRoot: string,
  query: string,
  topK: number,
  options: { ollamaHost?: string; embedModel?: string } = {}
): Promise<RetrievalHit[]> {
  const indexDir = join(workspaceRoot, ".wrapper/index");
  const manifestPath = join(indexDir, "manifest.json");
  const chunksPath = join(indexDir, "chunks.json");

  let manifest: IndexManifest;
  let indexData: IndexData;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    indexData = JSON.parse(await readFile(chunksPath, "utf8"));
  } catch {
    return [];
  }

  const ollamaHost = options.ollamaHost ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const embedModel = options.embedModel ?? manifest.embedModel;

  if (manifest.mode === "semantic") {
    try {
      const queryEmbedding = await getEmbedding({
        host: ollamaHost,
        model: embedModel,
        text: query
      });

      const hits: RetrievalHit[] = indexData.chunks
        .map((chunk) => {
          const score = chunk.embedding
            ? cosineSimilarity(queryEmbedding, chunk.embedding)
            : calculateLexicalScore(chunk.text, query);
          return {
            path: chunk.path,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            text: chunk.text,
            score
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      return hits;
    } catch {
      // Fallback to lexical retrieval on failure
    }
  }

  // Lexical retrieval
  const hits: RetrievalHit[] = indexData.chunks
    .map((chunk) => {
      const score = calculateLexicalScore(chunk.text, query);
      return {
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        score
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return hits;
}
