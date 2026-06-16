import { createRuntimeGenerator } from "@wrapper/mcp-server";
import { EvalCase, JudgeVerdict, JudgeVerdictSchema } from "@wrapper/schemas";
import { loadPromptRubric, loadOutcomeRubric } from "./rubric-loader.js";

export type BlindCandidates = {
  baseline_raw: string;
  hosted_refine: string;
  wrapper_local: string;
};

export type BlindVerdicts = {
  baseline_raw: JudgeVerdict;
  hosted_refine: JudgeVerdict;
  wrapper_local: JudgeVerdict;
};

// Shuffle helper for blind review
function shuffle<T>(array: T[]): { shuffled: T[]; indices: number[] } {
  const arr = [...array];
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return { shuffled: arr, indices };
}

export async function runBlindJudge(
  workspaceRoot: string,
  evalCase: EvalCase,
  candidates: BlindCandidates
): Promise<BlindVerdicts> {
  const rubric = await loadPromptRubric(workspaceRoot);
  const runtime = createRuntimeGenerator();
  
  const entries = [
    { arm: "baseline_raw" as const, text: candidates.baseline_raw },
    { arm: "hosted_refine" as const, text: candidates.hosted_refine },
    { arm: "wrapper_local" as const, text: candidates.wrapper_local }
  ];
  
  const { shuffled, indices } = shuffle(entries);
  const verdicts: Record<string, JudgeVerdict> = {};
  
  for (let i = 0; i < shuffled.length; i++) {
    const candidate = shuffled[i]!;
    
    // Construct prompt substituting template variables
    const promptText = rubric.judge_prompt_template
      .replace("{projectGoal}", evalCase.goldenOutcome || "Optimize prompts")
      .replace("{currentFocus}", evalCase.intent)
      .replace("{candidatePrompt}", candidate.text);
      
    let parsedVerdict: JudgeVerdict;
    try {
      const response = await runtime.generate({
        system: "You evaluate prompt quality strictly adhering to the JSON schema. Output JSON ONLY.",
        prompt: promptText
      });
      
      // Attempt to clean JSON formatting from response
      const jsonStart = response.indexOf("{");
      const jsonEnd = response.lastIndexOf("}");
      const cleanJson = jsonStart >= 0 && jsonEnd >= 0 ? response.slice(jsonStart, jsonEnd + 1) : response;
      
      parsedVerdict = JudgeVerdictSchema.parse(JSON.parse(cleanJson));
    } catch (err) {
      // Fallback heuristic verdict if Ollama is offline or fails
      const wordCount = candidate.text.split(/\s+/).length;
      const hasGoal = /goal|why|purpose/i.test(candidate.text) ? 4 : 2;
      const hasCriteria = /criteria|test|acceptance/i.test(candidate.text) ? 4 : 1;
      const score = Math.min(100, Math.max(20, wordCount * 2 + hasGoal * 10 + hasCriteria * 10));
      
      parsedVerdict = {
        score,
        goal_clarity: hasGoal,
        scope_bounds: wordCount > 20 ? 4 : 2,
        acceptance_criteria: hasCriteria,
        constraints: wordCount > 30 ? 4 : 2,
        verification_steps: wordCount > 40 ? 4 : 1,
        context_grounding: 3,
        reason: `Heuristic scoring fallback due to: ${err instanceof Error ? err.message : "inference failure"}`
      };
    }
    
    verdicts[candidate.arm] = parsedVerdict;
  }
  
  return verdicts as BlindVerdicts;
}
