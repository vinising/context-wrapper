import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

export type RubricDetails = {
  version: number;
  dimensions: Record<string, { description: string; range: [number, number] }>;
  judge_prompt_template: string;
};

export async function loadPromptRubric(workspaceRoot: string): Promise<RubricDetails> {
  const path = join(workspaceRoot, "eval/rubrics/prompt-quality.yaml");
  const raw = await readFile(path, "utf8");
  return parse(raw) as RubricDetails;
}

export async function loadOutcomeRubric(workspaceRoot: string): Promise<RubricDetails> {
  const path = join(workspaceRoot, "eval/rubrics/outcome-quality.yaml");
  const raw = await readFile(path, "utf8");
  return parse(raw) as RubricDetails;
}
