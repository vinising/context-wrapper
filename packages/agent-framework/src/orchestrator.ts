import { Agent } from "./agent.js";
import { PromptQuality, AgentBrief } from "@wrapper/schemas";

export type Milestone = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  status: "pending" | "in_progress" | "completed";
};

export class Orchestrator extends Agent {
  private milestones: Milestone[] = [];
  public lastPlanningTokens: {
    tier: "tier1_local" | "tier2_hybrid" | "tier3_hosted";
    tokensHostedInput: number;
    tokensHostedOutput: number;
    tokensHosted: number;
  } | null = null;

  constructor(workspaceRoot: string) {
    super({
      name: "Orchestrator",
      role: "Engineering Manager and Planner",
      systemInstructions: [
        "Decompose complex epic requests into sequential engineering milestones.",
        "Your responses for milestones must be a valid JSON array matching this shape:",
        "[",
        "  {",
        "    \"id\": \"M01\",",
        "    \"title\": \"Milestone Title\",",
        "    \"description\": \"Milestone Description\",",
        "    \"assignedTo\": \"sub-agent\",",
        "    \"status\": \"pending\"",
        "  }",
        "]",
        "Return ONLY the raw JSON block without markdown blocks or explanation."
      ].join("\n"),
      workspaceRoot
    });
  }

  public async determineComplexityTier(
    epic: string,
    options: { forcedTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto" } = {}
  ): Promise<"tier1_local" | "tier2_hybrid" | "tier3_hosted"> {
    // Check override forcedTier first
    if (options.forcedTier && options.forcedTier !== "auto") {
      return options.forcedTier;
    }

    // Check policy forcedTier next
    try {
      const policy = await this.store.readPolicy();
      if (policy.autonomous?.forcedTier && policy.autonomous.forcedTier !== "auto") {
        return policy.autonomous.forcedTier;
      }
    } catch {
      // Ignore policy read errors during routing
    }

    const epicLower = epic.toLowerCase();

    // Heuristics Layer
    // High complexity keywords -> Tier 3
    if (
      epicLower.includes("db migration") ||
      epicLower.includes("database schema") ||
      epicLower.includes("auth integration") ||
      epicLower.includes("oauth") ||
      epicLower.includes("security audit") ||
      epicLower.includes("cryptography overhaul") ||
      epicLower.includes("greenfield") ||
      epicLower.includes("microservice architecture")
    ) {
      return "tier3_hosted";
    }

    // Low complexity keywords -> Tier 1
    if (
      (epicLower.includes("typo") ||
       epicLower.includes("button color") ||
       epicLower.includes("simple comment") ||
       epicLower.includes("minor fix") ||
       epicLower.includes("add doc comment")) &&
      !epicLower.includes("safe transaction") &&
      !epicLower.includes("rollback")
    ) {
      return "tier1_local";
    }

    // Local LLM Classifier Layer
    try {
      const classificationPrompt = [
        `You are an expert software engineering complexity router.`,
        `Classify the following Epic engineering task into exactly one of three categories:`,
        `1. "tier1_local": extremely simple task (e.g. single-file minor update, fixing comments, CSS tweaks, typo fixes).`,
        `2. "tier2_hybrid": medium complexity task (e.g. implementing standard data structures, simple business logic, event emitter, utility packages).`,
        `3. "tier3_hosted": high complexity task (e.g. deep architectural shifts, multi-service designs, database schemas, oauth integrations, security layers).`,
        ``,
        `Task to classify: "${epic}"`,
        ``,
        `Respond with ONLY the category string: "tier1_local", "tier2_hybrid", or "tier3_hosted". No other words, no markdown blocks, no formatting.`
      ].join("\n");

      const responseText = await this.runtime.generate({
        system: "You are a precise classifier. Respond only with 'tier1_local', 'tier2_hybrid', or 'tier3_hosted'.",
        prompt: classificationPrompt
      });

      const cleanResponse = responseText.toLowerCase().trim();
      if (cleanResponse.includes("tier1_local")) return "tier1_local";
      if (cleanResponse.includes("tier3_hosted")) return "tier3_hosted";
      if (cleanResponse.includes("tier2_hybrid")) return "tier2_hybrid";
    } catch {
      // Fallback if local LLM fails
    }

    // Default fallback to Tier 2 (hybrid) for typical engineering tasks
    return "tier2_hybrid";
  }

  public async planEpic(
    epic: string,
    options: {
      bypassRouting?: boolean;
      forcedTier?: "tier1_local" | "tier2_hybrid" | "tier3_hosted" | "auto";
    } = {}
  ): Promise<Milestone[]> {
    // 1. Determine tier
    const tier = options.bypassRouting
      ? "tier1_local"
      : await this.determineComplexityTier(epic, { forcedTier: options.forcedTier });
    
    // Track paid token estimates based on tier
    let tokensHostedInput = 0;
    let tokensHostedOutput = 0;

    if (tier === "tier3_hosted") {
      // Tier 3: Pure Hosted Planning
      const planSystem = [
        "You are an Elite Principal Architect.",
        "Plan a complex milestone roadmap for a Tier 3 Epic.",
        "Produce a valid JSON array matching our milestone structure.",
        "Return ONLY the raw JSON array."
      ].join("\n");

      const planPrompt = `Architect a roadmap for this Tier 3 high-complexity task: ${epic}`;
      
      const result = await this.runtime.generate({
        system: planSystem,
        prompt: planPrompt
      });

      tokensHostedInput = 12000; // reads technical architecture, layout, schemas
      tokensHostedOutput = 1500; 

      this.parseMilestonesResult(result);
    } else if (tier === "tier2_hybrid") {
      // Tier 2: Hybrid Draft-and-Audit
      // Step A: Draft locally (0 hosted tokens)
      const draftResult = await this.runtime.generate({
        system: this.systemInstructions,
        prompt: `Draft a preliminary roadmap for: ${epic}`
      });

      // Step B: Send the compact draft to a hosted model to audit and refine
      const auditSystem = [
        "You are a Senior Principal Architect. Review and refine this draft milestone roadmap.",
        "Verify correctness, ensure no edge cases or security concerns are neglected.",
        "Return ONLY the refined valid JSON array."
      ].join("\n");

      const auditPrompt = `Audit and refine this draft roadmap:\n${draftResult}\n\nFor original epic: ${epic}`;

      const refinedResult = await this.runtime.generate({
        system: auditSystem,
        prompt: auditPrompt
      });

      tokensHostedInput = 1500; // Only inputs the compact draft + small prompt
      tokensHostedOutput = 800; // Returns refined milestones

      this.parseMilestonesResult(refinedResult);
    } else {
      // Tier 1: 100% Local Planning
      const result = await this.runtime.generate({
        system: this.systemInstructions,
        prompt: `Decompose this simple local task: ${epic}`
      });

      tokensHostedInput = 0;
      tokensHostedOutput = 0;

      this.parseMilestonesResult(result);
    }

    // Keep track of the metrics
    this.lastPlanningTokens = {
      tier,
      tokensHostedInput,
      tokensHostedOutput,
      tokensHosted: tokensHostedInput + tokensHostedOutput
    };

    return this.milestones;
  }

  private parseMilestonesResult(result: string): void {
    try {
      const start = result.indexOf("[");
      const end = result.lastIndexOf("]");
      if (start >= 0 && end >= 0) {
        const jsonText = result.slice(start, end + 1);
        this.milestones = JSON.parse(jsonText) as Milestone[];
      } else {
        throw new Error("No JSON array bounds found.");
      }
    } catch {
      // Fallback heuristic planning if JSON fails
      this.milestones = [
        {
          id: "M01",
          title: "Scaffold and Setup",
          description: "Initial setup and package configuration",
          assignedTo: "sub-agent",
          status: "pending"
        },
        {
          id: "M02",
          title: "Core Implementation",
          description: "Build the core logic under precise local briefs",
          assignedTo: "sub-agent",
          status: "pending"
        },
        {
          id: "M03",
          title: "Validation and Testing",
          description: "Verify correctness using our local test harness",
          assignedTo: "sub-agent",
          status: "pending"
        }
      ];
    }
  }

  public async refineTaskPrompt(taskPrompt: string): Promise<PromptQuality> {
    return await this.tools.refinePrompt({
      prompt: taskPrompt,
      intent: "implementation"
    });
  }

  public async generateTaskBrief(taskPrompt: string): Promise<AgentBrief> {
    return await this.tools.buildAgentBrief({
      task: taskPrompt,
      intent: "implementation"
    });
  }

  public async refreshHandoff(
    summary: string,
    currentFocus: string,
    constraints: string[],
    nextSteps: string[]
  ): Promise<any> {
    return await this.tools.updateContextHandoff({
      summary,
      currentFocus,
      constraints,
      nextSteps
    });
  }

  public getMilestones(): Milestone[] {
    return this.milestones;
  }
}
