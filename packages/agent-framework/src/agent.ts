import { createRuntimeGenerator, createWrapperTools } from "@wrapper/mcp-server";
import { createContextStore } from "@wrapper/context-store";

export type AgentOptions = {
  name: string;
  role: string;
  systemInstructions: string;
  workspaceRoot: string;
};

export class Agent {
  public name: string;
  public role: string;
  public systemInstructions: string;
  public workspaceRoot: string;
  public tools: ReturnType<typeof createWrapperTools>;
  public store: ReturnType<typeof createContextStore>;
  protected runtime: ReturnType<typeof createRuntimeGenerator>;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.role = options.role;
    this.systemInstructions = options.systemInstructions;
    this.workspaceRoot = options.workspaceRoot;
    
    this.runtime = createRuntimeGenerator();
    const store = createContextStore(this.workspaceRoot);
    this.store = store;
    this.tools = createWrapperTools({
      store,
      runtime: this.runtime
    });
  }

  public async run(prompt: string): Promise<string> {
    const fullSystem = [
      `You are ${this.name}, a specialized AI agent acting as: ${this.role}.`,
      this.systemInstructions
    ].join("\n");

    return await this.runtime.generate({
      system: fullSystem,
      prompt
    });
  }
}
