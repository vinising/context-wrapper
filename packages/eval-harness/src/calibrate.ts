import { EvalCase, JudgeVerdict } from "@wrapper/schemas";
import { runBlindJudge } from "./judge.js";

export type CalibrationSample = {
  evalCase: EvalCase;
  candidates: {
    baseline_raw: string;
    hosted_refine: string;
    wrapper_local: string;
  };
  humanScores: {
    baseline_raw: number;
    hosted_refine: number;
    wrapper_local: number;
  };
};

// Seed 3 calibration sample cases representing different parts of our transcript history
export const calibrationSamples: CalibrationSample[] = [
  {
    evalCase: {
      id: "CAL-01",
      rawPrompt: "build it",
      intent: "implementation"
    },
    candidates: {
      baseline_raw: "build it",
      hosted_refine: "I will help you build it. Can you specify what 'it' is?",
      wrapper_local: "Refined prompt:\nGoal: Scaffold the monorepo for the wrapper\nAcceptance Criteria: builds pass"
    },
    humanScores: {
      baseline_raw: 15,
      hosted_refine: 40,
      wrapper_local: 85
    }
  },
  {
    evalCase: {
      id: "CAL-02",
      rawPrompt: "implement local prompt quality check",
      intent: "implementation"
    },
    candidates: {
      baseline_raw: "implement local prompt quality check",
      hosted_refine: "We need to add a local prompt scoring method. Where should we store it?",
      wrapper_local: "Refined prompt:\nGoal: Implement a prompt assessment scoring method in mcp-server\nConstraints: Heuristic scoring is used when no local model exists\nVerification: run vitest prompt-assessment.test.ts"
    },
    humanScores: {
      baseline_raw: 45,
      hosted_refine: 60,
      wrapper_local: 90
    }
  }
];

export async function runCalibration(workspaceRoot: string): Promise<{
  meanAbsoluteError: number;
  agreementPercentage: number;
  results: Array<{
    caseId: string;
    arm: string;
    human: number;
    judge: number;
    delta: number;
  }>;
}> {
  const results: Array<{
    caseId: string;
    arm: string;
    human: number;
    judge: number;
    delta: number;
  }> = [];

  for (const sample of calibrationSamples) {
    const blindVerdicts = await runBlindJudge(workspaceRoot, sample.evalCase, sample.candidates);
    
    for (const arm of ["baseline_raw", "hosted_refine", "wrapper_local"] as const) {
      const human = sample.humanScores[arm];
      const judge = blindVerdicts[arm].score;
      results.push({
        caseId: sample.evalCase.id,
        arm,
        human,
        judge,
        delta: Math.abs(human - judge)
      });
    }
  }

  const sumDeltas = results.reduce((acc, r) => acc + r.delta, 0);
  const mae = sumDeltas / results.length;
  
  // Agreement percentage: (1 - normalized MAE) * 100
  const agreementPercentage = Math.max(0, Math.min(100, (1 - mae / 100) * 100));

  return {
    meanAbsoluteError: mae,
    agreementPercentage,
    results
  };
}
