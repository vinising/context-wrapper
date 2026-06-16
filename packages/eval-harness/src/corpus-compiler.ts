import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { EvalCase, EvalCaseSchema } from "@wrapper/schemas";
import { parseTranscript, mapEpisodesToEvalCases } from "./transcript-parser.js";

export async function loadOrCreateCorpus(
  workspaceRoot: string,
  transcriptPath: string
): Promise<EvalCase[]> {
  const corpusPath = join(workspaceRoot, "eval/corpus.yaml");
  
  try {
    const existing = await readFile(corpusPath, "utf8");
    const parsed = parse(existing);
    return z.array(EvalCaseSchema).parse(parsed);
  } catch {
    // Corpus doesn't exist, seed it from transcript
    const episodes = await parseTranscript(transcriptPath);
    const cases = mapEpisodesToEvalCases(episodes);
    
    // Ensure eval directory exists
    await mkdir(dirname(corpusPath), { recursive: true });
    await writeFile(corpusPath, stringify(cases), "utf8");
    return cases;
  }
}
