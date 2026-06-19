/**
 * Hybrid Static AST / Regex Parser for extracting code signatures.
 * Supports TypeScript, JavaScript, Python, and other major structures.
 * Strips method/function implementation bodies completely to achieve 90%+ compaction.
 */

export interface ParsedSignature {
  type: "class" | "method" | "function" | "global-desc";
  name: string;
  signature: string;
  line: number;
}

export function parseSignatures(content: string, filePath: string): ParsedSignature[] {
  const lines = content.split(/\r?\n/);
  const results: ParsedSignature[] = [];

  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".tsx") || lowerPath.endsWith(".js") || lowerPath.endsWith(".jsx")) {
    parseJsTsSignatures(lines, results);
  } else if (lowerPath.endsWith(".py")) {
    parsePythonSignatures(lines, results);
  } else {
    // Basic fallback for other text-based languages
    parseFallbackSignatures(lines, results);
  }

  return results;
}

function parseJsTsSignatures(lines: string[], results: ParsedSignature[]) {
  // Regexes for classes, methods, functions, and interfaces
  const classRegex = /^\s*(export\s+)?(class|interface)\s+([A-Za-z0-9_<>]+)/;
  // Methods/Functions inside or outside class definitions
  const methodRegex = /^\s*(public|private|protected|async|static|get|set)?\s*(async)?\s*([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(:\s*[^{;]+)?/;
  const functionRegex = /^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(:\s*[^{;]+)?/;
  const arrowFunctionRegex = /^\s*(export\s+)?(const|let)\s+([A-Za-z0-9_]+)\s*=\s*(async)?\s*\(([^)]*)\)\s*(:\s*[^=]+)?\s*=>/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      continue;
    }

    // Match class/interface
    const classMatch = lines[i]!.match(classRegex);
    if (classMatch) {
      results.push({
        type: "class",
        name: classMatch[3]!,
        signature: classMatch[0]!.trim(),
        line: i + 1
      });
      continue;
    }

    // Match function
    const funcMatch = lines[i]!.match(functionRegex);
    if (funcMatch) {
      results.push({
        type: "function",
        name: funcMatch[3]!,
        signature: `${funcMatch[2] || ""}function ${funcMatch[3]}(${funcMatch[4] || ""})${funcMatch[5] || ""}`.trim(),
        line: i + 1
      });
      continue;
    }

    // Match arrow function
    const arrowMatch = lines[i]!.match(arrowFunctionRegex);
    if (arrowMatch) {
      results.push({
        type: "function",
        name: arrowMatch[3]!,
        signature: `${arrowMatch[2]} ${arrowMatch[3]} = (${arrowMatch[5] || ""})${arrowMatch[6] || ""} => ...`.trim(),
        line: i + 1
      });
      continue;
    }

    // Match method
    const methodMatch = lines[i]!.match(methodRegex);
    if (methodMatch) {
      // Exclude keywords that are not custom methods
      const name = methodMatch[3]!;
      if (["if", "for", "while", "switch", "catch", "return", "import", "export", "constructor"].includes(name)) {
        continue;
      }
      results.push({
        type: "method",
        name,
        signature: `${methodMatch[1] || ""} ${methodMatch[2] || ""} ${name}(${methodMatch[4] || ""})${methodMatch[5] || ""}`.replace(/\s+/g, " ").trim(),
        line: i + 1
      });
    }
  }
}

function parsePythonSignatures(lines: string[], results: ParsedSignature[]) {
  const classRegex = /^\s*class\s+([A-Za-z0-9_]+)(\(([^)]+)\))?:/;
  const defRegex = /^\s*def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(->\s*[^:]+)?\s*:/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const classMatch = lines[i]!.match(classRegex);
    if (classMatch) {
      results.push({
        type: "class",
        name: classMatch[1]!,
        signature: classMatch[0]!.trim().replace(/:$/, ""),
        line: i + 1
      });
      continue;
    }

    const defMatch = lines[i]!.match(defRegex);
    if (defMatch) {
      const isMethod = lines[i]!.startsWith(" ") || lines[i]!.startsWith("\t");
      results.push({
        type: isMethod ? "method" : "function",
        name: defMatch[1]!,
        signature: `def ${defMatch[1]}(${defMatch[2] || ""})${defMatch[3] || ""}`,
        line: i + 1
      });
    }
  }
}

function parseFallbackSignatures(lines: string[], results: ParsedSignature[]) {
  // Generic pattern for functions / methods across languages (C, C++, Java, etc.)
  const genericFuncRegex = /^\s*(public|private|protected|static|virtual)?\s*([A-Za-z0-9_<>]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*[{;]?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*")) {
      continue;
    }

    const match = lines[i]!.match(genericFuncRegex);
    if (match) {
      const name = match[3]!;
      if (["if", "for", "while", "switch", "catch", "return", "using", "namespace", "import", "package"].includes(name)) {
        continue;
      }
      results.push({
        type: "function",
        name,
        signature: `${match[1] || ""} ${match[2] || ""} ${name}(${match[4] || ""})`.replace(/\s+/g, " ").trim(),
        line: i + 1
      });
    }
  }
}
