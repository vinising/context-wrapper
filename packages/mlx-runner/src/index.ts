export type GenerateRequest = {
  system: string;
  prompt: string;
};

export type GenerateFunction = (request: GenerateRequest) => Promise<string>;

export type MlxRunnerOptions = {
  modelId: string;
  generate?: GenerateFunction;
};

export type MlxRunner = {
  modelId: string;
  generate(request: GenerateRequest): Promise<string>;
};

export function createMlxRunner(options: MlxRunnerOptions): MlxRunner {
  const generate =
    options.generate ??
    (async () => {
      throw new Error(
        `No MLX backend configured for ${options.modelId}. Provide a generate function or install the MLX sidecar.`
      );
    });

  return {
    modelId: options.modelId,
    generate
  };
}
