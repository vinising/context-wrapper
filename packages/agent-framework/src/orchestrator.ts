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

  public async planEpic(epic: string): Promise<Milestone[]> {
    const result = await this.run(`Decompose this Epic task: ${epic}`);
    
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
          description: `Initial setup for Epic: ${epic.slice(0, 30)}`,
          assignedTo: "sub-agent",
          status: "pending"
        },
        {
          id: "M02",
          title: "Core Implementation",
          description: "Build the core business logic of the feature",
          assignedTo: "sub-agent",
          status: "pending"
        },
        {
          id: "M03",
          title: "Validation and Testing",
          description: "Verify correct behavior with unit tests",
          assignedTo: "sub-agent",
          status: "pending"
        }
      ];
    }

    return this.milestones;
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
