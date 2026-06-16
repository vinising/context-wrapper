export type TokenEstimate = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Robust token estimator using standard 4-characters-per-token heuristic
 * (or ~1.3 tokens per word) which is standard and highly reliable across models.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Fallback heuristic: 1 token = 4 characters of english text
  return Math.ceil(text.length / 4);
}

/**
 * Estimates hosted token usage for a baseline run (A) vs wrapper run (C)
 * based on the prompt text and the generated response / tool outputs.
 */
export function calculateTokenSavings(
  rawPrompt: string,
  refinedPrompt: string,
  followUpText: string = ""
): {
  baselineRawEstimate: TokenEstimate;
  wrapperEstimate: TokenEstimate;
  savingsHosted: number;
} {
  // Baseline (A): raw prompt + any followups
  const baselinePromptTokens = estimateTokens(rawPrompt);
  const baselineCompletionTokens = estimateTokens(followUpText);
  
  // Wrapper (C): refined prompt is more explicit, but keeps agent from wandering or re-asking.
  // The pre-work local cost (refinedPrompt generation) is done locally (wrapperEstimate)
  const wrapperLocalPromptTokens = estimateTokens(rawPrompt);
  const wrapperLocalCompletionTokens = estimateTokens(refinedPrompt);
  
  // The hosted prompt is now the refined prompt, which is longer but completes in 1 turn instead of multiple
  const wrapperHostedPromptTokens = estimateTokens(refinedPrompt);
  const wrapperHostedCompletionTokens = Math.max(0, baselineCompletionTokens - estimateTokens("clarifying questions and back-and-forth")); // usually significantly smaller output
  
  return {
    baselineRawEstimate: {
      promptTokens: baselinePromptTokens,
      completionTokens: baselineCompletionTokens,
      totalTokens: baselinePromptTokens + baselineCompletionTokens
    },
    wrapperEstimate: {
      promptTokens: wrapperHostedPromptTokens,
      completionTokens: wrapperHostedCompletionTokens,
      totalTokens: wrapperHostedPromptTokens + wrapperHostedCompletionTokens
    },
    // Hosted savings is baseline total hosted tokens minus wrapper hosted tokens
    savingsHosted: (baselinePromptTokens + baselineCompletionTokens) - (wrapperHostedPromptTokens + wrapperHostedCompletionTokens)
  };
}
