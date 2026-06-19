import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { recommendModelProfile } from "@wrapper/model-router";
import {
  enforceOllamaContextWindow,
  parseOllamaNumCtx
} from "./ollama-context.js";
import { createMlxRunner, GenerateFunction, GenerateRequest } from "@wrapper/mlx-runner";
import {
  assessPromptHeuristically,
  buildAssessmentPrompt,
  buildRefinementPrompt,
  LlmAssessmentResponseSchema,
  LlmRefinementResponseSchema,
  parseModelJson,
  RefinementAssessment,
  RefinementContext,
  toAssessmentOnlyResult,
  toRefinementAssessment,
  AgentBriefContext,
  LlmAgentBriefResponse,
  LlmAgentBriefResponseSchema,
  buildAgentBriefPrompt,
  buildAgentBriefHeuristically
} from "./prompt-assessment.js";

export type RuntimeGeneratorOptions = {
  mode?: "auto" | "fallback" | "bridge" | "ollama";
};

class SingleFlightMutex {
  private locked = false;

  public acquire(): boolean {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    return true;
  }

  public release(): void {
    this.locked = false;
  }
}

const ollamaMutex = new SingleFlightMutex();

type GenerateBridgePayload = {
  modelId: string;
  system: string;
  prompt: string;
};

export function createRuntimeGenerator(options: RuntimeGeneratorOptions = {}) {
  const recommendedProfile = recommendModelProfile();
  const modelId = process.env.WRAPPER_MODEL_ID_OVERRIDE || recommendedProfile.modelId;
  const profile = { ...recommendedProfile, modelId };
  const mode = options.mode ?? "auto";
  const bridgeCommand = process.env.WRAPPER_MLX_COMMAND_JSON ?? autoBridgeCommand();
  const ollamaModel = process.env.WRAPPER_OLLAMA_MODEL ?? "gemma4:12b-mlx";
  const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const ollamaNumCtx = parseOllamaNumCtx(process.env.WRAPPER_OLLAMA_NUM_CTX);
  const fallback = createFallbackGenerator(profile.modelId);
  const shouldUseOllama = mode === "ollama" || (mode === "auto" && process.env.WRAPPER_RUNTIME === "ollama");

  let lastTokens = { promptTokens: 0, completionTokens: 0 };
  const updateTokens = (p: number, c: number) => {
    lastTokens = { promptTokens: p, completionTokens: c };
  };
  const updateEstimatedTokens = (sys: string, prompt: string, responseText: string) => {
    lastTokens = {
      promptTokens: Math.ceil((sys.length + prompt.length) / 4),
      completionTokens: Math.ceil(responseText.length / 4)
    };
  };

  async function verifyOllamaRuntime(): Promise<{ running: boolean; hasModel: boolean; error?: string }> {
    try {
      const response = await fetch(`${ollamaHost.replace(/\/$/, "")}/api/tags`);
      if (!response.ok) {
        return { running: false, hasModel: false, error: `HTTP ${response.status}` };
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const hasModel = models.some(
        (m) => m.name === ollamaModel || m.name.startsWith(ollamaModel + ":")
      );
      return { running: true, hasModel };
    } catch (err: any) {
      return { running: false, hasModel: false, error: err?.message || String(err) };
    }
  }

  const generate: GenerateFunction = async (request) => {
    if (shouldUseOllama) {
      if (!ollamaMutex.acquire()) {
        return [
          "[OLLAMA_BUSY_FALLBACK] Ollama is currently busy executing another task. Please perform this operation (e.g. compaction or mapping) using your hosted agent (Claude) directly in the chat."
        ].join("\n");
      }

      try {
        return await generateWithOllama({
          host: ollamaHost,
          model: ollamaModel,
          request,
          numCtx: ollamaNumCtx,
          onTokens: updateTokens
        });
      } catch (error) {
        const diagnostics = await verifyOllamaRuntime();
        let diagnosticMsg = "";
        if (!diagnostics.running) {
          diagnosticMsg = [
            `⚠️ OLLAMA OFFLINE WARNING: Local Context Wrapper is configured to use Ollama, but the service appears to be offline at ${ollamaHost}.`,
            "To resolve this, please open your terminal and run:",
            "  ollama serve",
            "Or launch the Ollama desktop application on your MacBook."
          ].join("\n");
        } else if (!diagnostics.hasModel) {
          diagnosticMsg = [
            `⚠️ MISSING MODEL WARNING: Ollama is running, but the configured local model "${ollamaModel}" was not found.`,
            "To download and install it, please run this command in your terminal:",
            `  ollama pull ${ollamaModel}`
          ].join("\n");
        } else {
          diagnosticMsg = `Ollama error: ${stringifyError(error)}`;
        }

        const fallbackOutput = await fallback(request);
        updateEstimatedTokens(request.system, request.prompt, fallbackOutput);
        return [fallbackOutput, "", diagnosticMsg].join("\n");
      } finally {
        ollamaMutex.release();
      }
    }

    if (mode === "bridge" && bridgeCommand) {
      try {
        const bridge = createBridgeGenerator(profile.modelId, bridgeCommand);
        const output = await bridge(request);
        updateEstimatedTokens(request.system, request.prompt, output);
        return output;
      } catch (error) {
        const fallbackOutput = await fallback(request);
        updateEstimatedTokens(request.system, request.prompt, fallbackOutput);
        return [fallbackOutput, "", `Bridge error: ${stringifyError(error)}`].join("\n");
      }
    }

    const output = await fallback(request);
    updateEstimatedTokens(request.system, request.prompt, output);
    return output;
  };

  const runner = createMlxRunner({
    modelId: profile.modelId,
    generate
  });

  const usesLlmScoring = shouldUseOllama || (mode === "bridge" && Boolean(bridgeCommand));

  async function generateStructuredLlm(request: GenerateRequest): Promise<string> {
    if (shouldUseOllama) {
      if (!ollamaMutex.acquire()) {
        throw new Error("[OLLAMA_BUSY_FALLBACK] Ollama is currently busy executing another task.");
      }

      try {
        return await generateWithOllama({
          host: ollamaHost,
          model: ollamaModel,
          request,
          json: true,
          numCtx: ollamaNumCtx,
          onTokens: updateTokens
        });
      } finally {
        ollamaMutex.release();
      }
    }

    if (mode === "bridge" && bridgeCommand) {
      const bridge = createBridgeGenerator(profile.modelId, bridgeCommand);
      const output = await bridge(request);
      updateEstimatedTokens(request.system, request.prompt, output);
      return output;
    }

    throw new Error("No LLM backend configured for structured assessment.");
  }

  async function assessAndRefine(context: RefinementContext): Promise<RefinementAssessment> {
    if (usesLlmScoring) {
      try {
        const response = await generateStructuredLlm({
          system: "You assess and refine Cursor agent prompts. Respond with JSON only.",
          prompt: buildRefinementPrompt(context)
        });
        return toRefinementAssessment(parseModelJson(response, LlmRefinementResponseSchema));
      } catch (error) {
        const heuristic = assessPromptHeuristically(context);
        const refinedPrompt = await generate({
          system: [
            "You refine rough Cursor prompts for spec-driven development.",
            "Preserve user intent, add missing context, acceptance criteria, and verification guidance.",
            "Never invent secrets or unsupported integration capabilities."
          ].join(" "),
          prompt: [
            `Project: ${context.handoff.project.name}`,
            `Goal: ${context.handoff.project.goal}`,
            `Current focus: ${context.handoff.activeContext.currentFocus}`,
            `User prompt: ${context.prompt}`,
            `Missing context: ${heuristic.missingContext.join(", ") || "none"}`
          ].join("\n")
        });

        return {
          ...heuristic,
          refinedPrompt,
          scoringMethod: "heuristic"
        };
      }
    }

    const heuristic = assessPromptHeuristically(context);
    const refinedPrompt = await generate({
      system: [
        "You refine rough Cursor prompts for spec-driven development.",
        "Preserve user intent, add missing context, acceptance criteria, and verification guidance.",
        "Never invent secrets or unsupported integration capabilities."
      ].join(" "),
      prompt: [
        `Project: ${context.handoff.project.name}`,
        `Goal: ${context.handoff.project.goal}`,
        `Current focus: ${context.handoff.activeContext.currentFocus}`,
        `User prompt: ${context.prompt}`,
        `Missing context: ${heuristic.missingContext.join(", ") || "none"}`
      ].join("\n")
    });

    return {
      ...heuristic,
      refinedPrompt
    };
  }

  async function assessOnly(context: RefinementContext): Promise<RefinementAssessment> {
    if (usesLlmScoring) {
      try {
        const response = await generateStructuredLlm({
          system: "You assess Cursor agent prompt quality. Respond with JSON only.",
          prompt: buildAssessmentPrompt(context)
        });
        return toAssessmentOnlyResult(
          parseModelJson(response, LlmAssessmentResponseSchema),
          context.prompt
        );
      } catch {
        return assessPromptHeuristically(context);
      }
    }

    return assessPromptHeuristically(context);
  }

  async function buildAgentBrief(context: AgentBriefContext): Promise<LlmAgentBriefResponse & { scoringMethod: "llm" | "heuristic" }> {
    if (usesLlmScoring) {
      try {
        const response = await generateStructuredLlm({
          system: "You generate task-scoped execution briefs for coding agents. Respond with JSON only.",
          prompt: buildAgentBriefPrompt(context)
        });
        const parsed = parseModelJson(response, LlmAgentBriefResponseSchema);
        return {
          ...parsed,
          scoringMethod: "llm"
        };
      } catch {
        return {
          ...buildAgentBriefHeuristically(context),
          scoringMethod: "heuristic"
        };
      }
    }

    return {
      ...buildAgentBriefHeuristically(context),
      scoringMethod: "heuristic"
    };
  }

  return {
    profile,
    mode: shouldUseOllama ? "ollama" : mode,
    usesLlmScoring,
    generate: runner.generate,
    assessAndRefine,
    assessOnly,
    buildAgentBrief,
    getLastTokens: () => lastTokens
  };
}

function createBridgeGenerator(modelId: string, commandJson: string): GenerateFunction {
  const command = parseCommand(commandJson);
  const executable = command[0];
  const args = command.slice(1);

  return async (request: GenerateRequest) => {
    const payload: GenerateBridgePayload = {
      modelId,
      system: request.system,
      prompt: request.prompt
    };

    return executeBridge(executable, args, payload);
  };
}

function parseCommand(commandJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(commandJson);
  } catch {
    throw new Error(
      "WRAPPER_MLX_COMMAND_JSON must be a JSON string array, e.g. [\"python3\",\"scripts/mlx_generate.py\"]."
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string")) {
    throw new Error("WRAPPER_MLX_COMMAND_JSON must be a non-empty string array.");
  }

  return parsed;
}

async function executeBridge(executable: string, args: string[], payload: GenerateBridgePayload): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("MLX bridge command timed out after 60s."));
    }, 60000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`MLX bridge command failed with code ${code}. ${stderr.trim()}`));
        return;
      }

      const output = stdout.trim();
      if (!output) {
        reject(new Error("MLX bridge command returned empty output."));
        return;
      }

      resolve(output);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function createFallbackGenerator(modelId: string): GenerateFunction {
  return async ({ prompt }) => {
    return [
      "Refined prompt:",
      prompt,
      "",
      `Model recommendation: ${modelId}`,
      "Fallback mode active: set WRAPPER_MLX_COMMAND_JSON to bridge local MLX inference output."
    ].join("\n");
  };
}

async function generateWithOllama(options: {
  host: string;
  model: string;
  request: GenerateRequest;
  json?: boolean;
  numCtx: number;
  onTokens?: (promptTokens: number, completionTokens: number) => void;
}): Promise<string> {
  await enforceOllamaContextWindow({
    host: options.host,
    model: options.model,
    numCtx: options.numCtx
  });

  const response = await fetch(`${options.host.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      prompt: [
        `System instructions: ${options.request.system}`,
        "",
        `User request: ${options.request.prompt}`,
        "",
        options.json
          ? "Return only valid JSON."
          : (options.request.system.toLowerCase().includes("prompt engineer") || options.request.system.toLowerCase().includes("refine"))
            ? "Return only the refined prompt text."
            : "Respond strictly as requested by the system instructions and user prompt format."
      ].join("\n"),
      stream: false,
      options: {
        num_ctx: options.numCtx
      },
      ...(options.json ? { format: "json" } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { response?: string; error?: string; prompt_eval_count?: number; eval_count?: number };
  if (payload.error) {
    throw new Error(payload.error);
  }

  const text = payload.response?.trim();
  if (!text) {
    throw new Error("Ollama returned empty response text.");
  }

  if (options.onTokens && typeof payload.prompt_eval_count === "number" && typeof payload.eval_count === "number") {
    options.onTokens(payload.prompt_eval_count, payload.eval_count);
  }

  return text;
}

function autoBridgeCommand(): string | undefined {
  const scriptPath = resolve(process.cwd(), "scripts/mlx_generate.py");
  if (!existsSync(scriptPath)) {
    return undefined;
  }

  return JSON.stringify(["python3", scriptPath]);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
