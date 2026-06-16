import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type FileSnapshot = Record<string, string>;

export async function takeDirectorySnapshot(dirPath: string): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = {};
  
  async function walk(currentDir: string) {
    let entries: string[] = [];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const entryStat = await stat(fullPath);
      
      if (entryStat.isDirectory()) {
        if (entry === "node_modules" || entry === ".git" || entry === ".wrapper") {
          continue;
        }
        await walk(fullPath);
      } else if (entryStat.isFile()) {
        // Only snapshot source/config files
        if (/\.(ts|js|json|md|yaml|yml|sh|txt)$/.test(entry)) {
          const content = await readFile(fullPath, "utf8");
          const relPath = relative(dirPath, fullPath);
          snapshot[relPath] = content;
        }
      }
    }
  }
  
  await walk(dirPath);
  return snapshot;
}

export type ChurnMetrics = {
  filesTouched: string[];
  linesAdded: number;
  linesDeleted: number;
  sameFileRewrites: number;
  revertRatio: number;
};

export function analyzeChurn(before: FileSnapshot, after: FileSnapshot): ChurnMetrics {
  const filesTouched: string[] = [];
  let linesAdded = 0;
  let linesDeleted = 0;
  let sameFileRewrites = 0;
  
  const allFiles = new Set([...Object.keys(before), ...Object.keys(after)]);
  
  for (const file of allFiles) {
    const contentBefore = before[file];
    const contentAfter = after[file];
    
    if (contentBefore === undefined && contentAfter !== undefined) {
      // New file created
      filesTouched.push(file);
      const lines = contentAfter.split("\n");
      linesAdded += lines.length;
    } else if (contentBefore !== undefined && contentAfter === undefined) {
      // File deleted
      filesTouched.push(file);
      const lines = contentBefore.split("\n");
      linesDeleted += lines.length;
    } else if (contentBefore !== undefined && contentAfter !== undefined && contentBefore !== contentAfter) {
      // File modified
      filesTouched.push(file);
      
      const beforeLines = contentBefore.split("\n");
      const afterLines = contentAfter.split("\n");
      
      // Simple line diff estimation
      let added = 0;
      let deleted = 0;
      
      const beforeSet = new Set(beforeLines);
      const afterSet = new Set(afterLines);
      
      for (const line of afterLines) {
        if (!beforeSet.has(line)) {
          added++;
        }
      }
      
      for (const line of beforeLines) {
        if (!afterSet.has(line)) {
          deleted++;
        }
      }
      
      linesAdded += added;
      linesDeleted += deleted;
      
      // If a file is touched and has edits, increment rewrites
      sameFileRewrites += 1;
    }
  }
  
  // Revert ratio estimation: ratio of deleted lines that match similar quantities of added lines
  const totalEdits = linesAdded + linesDeleted;
  const revertRatio = totalEdits > 0 ? Math.min(linesAdded, linesDeleted) / Math.max(linesAdded, linesDeleted) : 0;
  
  return {
    filesTouched,
    linesAdded,
    linesDeleted,
    sameFileRewrites,
    revertRatio
  };
}
