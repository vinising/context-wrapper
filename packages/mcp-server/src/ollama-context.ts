export const DEFAULT_OLLAMA_NUM_CTX = 65536;

export type LoadedOllamaModel = {
  name: string;
  sizeVram: number;
  contextLength: number;
};

export function parseOllamaNumCtx(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_OLLAMA_NUM_CTX;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OLLAMA_NUM_CTX;
  }
  return parsed;
}

/**
 * Heuristic VRAM ceiling for 12B-class models: weights plus KV cache at num_ctx.
 * Used to detect when Ollama loaded a model at an oversized default context (e.g. 262144).
 */
export function estimateMaxVramBytes(numCtx: number): number {
  const weightsBytes = 7.2e9;
  const kvBytesPerToken = 52_000;
  return weightsBytes + numCtx * kvBytesPerToken;
}

function normalizeHost(host: string): string {
  return host.replace(/\/$/, "");
}

function modelMatches(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target}:`);
}

export async function getLoadedOllamaModel(
  host: string,
  model: string
): Promise<LoadedOllamaModel | null> {
  try {
    const response = await fetch(`${normalizeHost(host)}/api/ps`);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; size_vram?: number; context_length?: number }>;
    };
    const match = (payload.models ?? []).find((entry) => entry.name && modelMatches(entry.name, model));
    if (!match?.name) {
      return null;
    }
    return {
      name: match.name,
      sizeVram: match.size_vram ?? 0,
      contextLength: match.context_length ?? 0
    };
  } catch {
    return null;
  }
}

export async function unloadOllamaModel(host: string, model: string): Promise<void> {
  await fetch(`${normalizeHost(host)}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: " ",
      stream: false,
      keep_alive: 0
    })
  });
}

export type EnforceOllamaContextResult = {
  unloaded: boolean;
  previousVram?: number;
  previousContextLength?: number;
  configuredNumCtx: number;
  maxAllowedVram: number;
};

/**
 * If the model is loaded with more VRAM than our configured num_ctx allows, unload it
 * so the next request reloads with the enforced context window.
 */
export async function enforceOllamaContextWindow(options: {
  host: string;
  model: string;
  numCtx: number;
}): Promise<EnforceOllamaContextResult> {
  const maxAllowedVram = estimateMaxVramBytes(options.numCtx) * 1.12;
  const loaded = await getLoadedOllamaModel(options.host, options.model);

  if (!loaded) {
    return {
      unloaded: false,
      configuredNumCtx: options.numCtx,
      maxAllowedVram
    };
  }

  const oversizedVram = loaded.sizeVram > maxAllowedVram;

  if (!oversizedVram) {
    return {
      unloaded: false,
      previousVram: loaded.sizeVram,
      previousContextLength: loaded.contextLength,
      configuredNumCtx: options.numCtx,
      maxAllowedVram
    };
  }

  await unloadOllamaModel(options.host, options.model);

  return {
    unloaded: true,
    previousVram: loaded.sizeVram,
    previousContextLength: loaded.contextLength,
    configuredNumCtx: options.numCtx,
    maxAllowedVram
  };
}
