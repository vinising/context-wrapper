import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { createContextStore } from "@wrapper/context-store";
import { createWrapperTools } from "./index.js";

describe("wrapper MCP tools", () => {
  it("refines rough prompts with context and recommended questions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 35,
            missingContext: ["goal", "success criteria", "constraints", "detail"],
            recommendedQuestions: ["What outcome should the working model optimize for?"],
            refinedPrompt: `Refined: ${prompt}\nAcceptance criteria: clear and testable.`,
            scoringMethod: "heuristic" as const,
            readyForImplementation: false
          }),
          assessOnly: async ({ prompt }) => ({
            score: 35,
            missingContext: ["goal"],
            recommendedQuestions: ["What outcome should the working model optimize for?"],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: false
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "heuristic" as const
          })
        }
      });

      const result = await tools.refinePrompt({
        prompt: "build it",
        intent: "implementation"
      });

      expect(result.refinedPrompt).toContain("Acceptance criteria");
      expect(result.historyPath).toContain(".wrapper/prompts/");
      expect(result.recommendedQuestions.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(80);
      expect(Array.isArray(result.targetFiles)).toBe(true);
      if ((result.targetFiles?.length ?? 0) > 0) {
        expect(result.targetFiles?.[0]?.startLine).toBeGreaterThan(0);
        expect(result.targetFiles?.[0]?.endLine).toBeGreaterThan(0);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("updates and returns the context handoff", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      await tools.updateContextHandoff({
        summary: "User chose Cursor-native sidecar",
        currentFocus: "MCP tool prototype",
        constraints: ["No unsupported prompt rewriting"],
        nextSteps: ["Package Cursor plugin"]
      });

      expect((await tools.getContextHandoff()).activeContext.currentFocus).toBe("MCP tool prototype");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("orchestrates step-by-step hybrid execution with localDraftPlan and localExecuteMilestone", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      // 1. Run tools.localDraftPlan with mock input task: "Implement SafeEmitter", forceTier: "tier1_local"
      const plan = await tools.localDraftPlan({
        task: "Implement SafeEmitter",
        forceTier: "tier1_local"
      });

      // Assert that the returned plan status is pending or in_progress initially and has pending milestones
      expect(["pending", "in_progress"]).toContain(plan.status);
      expect(plan.milestones.length).toBeGreaterThan(0);
      expect(plan.milestones[0].status).toBe("pending");

      // Verify that reading the active plan from the store returns the drafted plan correctly
      const savedPlan = await store.readActivePlan();
      expect(savedPlan).not.toBeNull();
      expect(savedPlan?.taskId).toBe(plan.taskId);
      expect(savedPlan?.taskDescription).toBe("Implement SafeEmitter");

      // Call tools.localExecuteMilestone for the first milestone, passing correct taskId, milestoneId, and an optional context string
      const firstMilestone = plan.milestones[0];
      const result = await tools.localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: firstMilestone.id,
        context: "Optional context string"
      });

      // Assert that the execution succeeds and returns a success status of completed for that specific milestone
      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.logs).toContain("Validation skipped");
      expect(result.execution?.executionSource).toBe("local_subagent");
      expect(["direct_local", "decomposed_local"]).toContain(result.execution?.route);
      expect((result.execution?.microTaskCount ?? 0)).toBeGreaterThan(0);

      // Verify that reading the active plan shows that the milestone's status was set to completed and that the overall plan is updated accordingly
      const updatedPlan = await store.readActivePlan();
      expect(updatedPlan).not.toBeNull();
      const updatedMilestone = updatedPlan?.milestones.find((m) => m.id === firstMilestone.id);
      expect(updatedMilestone?.status).toBe("completed");
      expect(updatedPlan?.status).toBe("in_progress");

      // Verify that the context handoff was updated with the summary of the completed task
      const handoff = await store.readHandoff();
      expect(handoff.activeContext.summary).toContain("Successfully completed sub-task: Scaffold and Setup");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("fails milestone execution when policy validation command fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      await setValidationCommand(store.paths.policyPath, ["node", "-e", "process.exit(1)"]);

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      const plan = await tools.localDraftPlan({
        task: "Implement SafeEmitter",
        forceTier: "tier1_local"
      });
      const firstMilestone = plan.milestones[0];
      const result = await tools.localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: firstMilestone.id
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.logs).toContain("Using policy override from autonomous.validationCommand");
      expect(result.logs).toContain("Validation output:");

      const updatedPlan = await store.readActivePlan();
      const updatedMilestone = updatedPlan?.milestones.find((m) => m.id === firstMilestone.id);
      expect(updatedMilestone?.status).toBe("failed");
      expect(updatedMilestone?.result?.validation?.attempted).toBe(true);
      expect(updatedMilestone?.result?.validation?.success).toBe(false);
      expect(updatedMilestone?.result?.validation?.source).toBe("policy");
      expect(updatedMilestone?.result?.execution?.executionSource).toBe("local_subagent");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("records explicit hosted opt-outs with provenance metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      const plan = await tools.localDraftPlan({
        task: "Add security-sensitive auth workflow",
        forceTier: "tier2_hybrid"
      });
      const firstMilestone = plan.milestones[0];

      const result = await tools.localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: firstMilestone.id,
        executionMode: "hosted_opt_out",
        optOutReason: "User approved manual hosted implementation for sensitive auth changes."
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.filesModified).toEqual([]);
      expect(result.execution?.route).toBe("hosted_opt_out");
      expect(result.execution?.executionSource).toBe("hosted_manual");
      expect(result.execution?.optOutReason).toContain("User approved");
      expect(result.validation?.attempted).toBe(false);
      expect(result.validation?.skippedReason).toContain("explicitly opted out");

      const updatedPlan = await store.readActivePlan();
      const updatedMilestone = updatedPlan?.milestones.find((m) => m.id === firstMilestone.id);
      expect(updatedMilestone?.status).toBe("completed");
      expect(updatedMilestone?.result?.execution?.route).toBe("hosted_opt_out");
      expect(updatedMilestone?.result?.execution?.executionSource).toBe("hosted_manual");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("compacts conversations and extracts codebase signatures", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "WrapperTest",
        projectGoal: "Verify context compaction"
      });

      // Write a dummy file to parse its signatures
      const { writeFile } = await import("node:fs/promises");
      const dummyFilePath = "dummy.ts";
      const dummyFullContent = `
export class TestComponent {
  private id: string;
  constructor(id: string) {
    this.id = id;
  }
  public async render(element: HTMLElement): Promise<void> {
    console.log("rendering", this.id);
  }
}
export function helperFunction(arg: string): boolean {
  return arg.length > 0;
}
`;
      await writeFile(join(workspace, dummyFilePath), dummyFullContent, "utf8");

      let compactCalls = 0;
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async () => { throw new Error("not used"); },
          assessOnly: async () => { throw new Error("not used"); },
          buildAgentBrief: async () => { throw new Error("not used"); },
          generate: async ({ prompt }) => {
            if (prompt.includes("bloated chat conversation history")) {
              compactCalls += 1;
              if (compactCalls > 1) {
                return "fallback";
              }
              return "### State Locked-in\n- Verified compaction\n\n### Current Focus\n- Task unit tests\n\n### Active Decisions\n- Used lightweight static regex parsing\n\n### Key Files\n- packages/mcp-server/src/index.ts -- core MCP tool implementations";
            }
            if (prompt.includes("Rewrite the following compaction output")) {
              return "fallback";
            }
            if (prompt.includes("extracted raw code signatures")) {
              return JSON.stringify({
                fileSummary: "A clean component for rendering tests.",
                signatures: {
                  TestComponent: "Main test rendering class",
                  render: "Renders the component into an element",
                  helperFunction: "Validates inputs"
                }
              });
            }
            return "fallback";
          }
        }
      });

      // 1. Test localCompactConversation
      const compactResult = await tools.localCompactConversation({
        history: [
          { role: "user", content: "Can we write tests?" },
          { role: "assistant", content: "Yes, I will implement unit tests for tools." }
        ],
        focus: "Verify tool integration"
      });

      expect(compactResult.status).toBe("synced");
      expect(compactResult.handoffSynced).toBe(true);
      expect(compactResult.summary).toContain("### State Locked-in");
      expect(compactResult.summary).toContain("### Current Focus");
      expect(compactResult.summary).toContain("compaction");
      expect(compactResult.cleanSlatePrompt).toContain("--- CONTEXT HANDOFF (read-only memory, not a task list) ---");
      expect(compactResult.cleanSlatePrompt).toContain("## Key Files (do NOT search for these, paths are exact)");
      expect(compactResult.cleanSlatePrompt).toContain("## Behavioral Contract (MANDATORY)");
      expect(compactResult.cleanSlatePrompt).toContain("STOP. Wait for the user");
      expect(compactResult.cleanSlatePrompt).not.toContain("Call `get_context_handoff` to read the synchronized state");

      // Verify that on-disk handoff was automatically updated to prevent stale data in the new chat session!
      const handoff = await store.readHandoff();
      expect(handoff.activeContext.summary).toContain("Verified compaction");
      expect(handoff.activeContext.summary).toContain("Used lightweight static regex parsing");
      expect(handoff.activeContext.currentFocus).toBe("Task unit tests");
      expect(handoff.activeContext.nextSteps).toEqual(["Task unit tests"]);
      expect(handoff.signals.confidence).toBe(0.95);

      const invalidCompact = await tools.localCompactConversation({
        history: [{ role: "user", content: "offline" }],
        focus: "Should not overwrite"
      });

      expect(invalidCompact.status).toBe("failed_validation");
      expect(invalidCompact.handoffSynced).toBe(false);
      expect(invalidCompact.summary).toBe("fallback");
      expect(invalidCompact.failureReason).toContain("strict markdown contract validation");
      expect(invalidCompact.cleanSlatePrompt).toContain("--- CONTEXT HANDOFF (read-only memory, not a task list) ---");
      expect(invalidCompact.cleanSlatePrompt).toContain("Behavioral Contract (MANDATORY)");
      const preserved = await store.readHandoff();
      expect(preserved.activeContext.summary).toContain("Verified compaction");
      expect(preserved.activeContext.currentFocus).toBe("Task unit tests");

      // 2. Test getCodeSignatureMap for file
      const signatureMap = await tools.getCodeSignatureMap({
        filePath: dummyFilePath
      });

      expect(signatureMap).toContain("dummy.ts (Global: A clean component for rendering tests.)");
      expect(signatureMap).toContain("class TestComponent");
      expect(signatureMap).toContain("method async render(element: HTMLElement): Promise<void> --> Renders the component into an element");
      expect(signatureMap).toContain("function helperFunction(arg: string): boolean --> Validates inputs");

      // 3. Test getCodeSignatureMap for directory recursively
      const dirSignatureMap = await tools.getCodeSignatureMap({
        filePath: "" // Walk workspace root
      });
      expect(dirSignatureMap).toContain("dummy.ts (Global: A clean component for rendering tests.)");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("refreshes documentation with smart_touched scope", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      await mkdir(join(workspace, "docs"), { recursive: true });
      await writeFile(join(workspace, "README.md"), "# Root Docs\n", "utf8");
      await writeFile(join(workspace, "docs/technical-reference.md"), "# Technical\n", "utf8");
      await writeFile(join(workspace, "docs/onboarding.md"), "# Onboarding\n", "utf8");

      const now = new Date().toISOString();
      await store.writeActivePlan({
        version: 1,
        taskId: "task-docs-1",
        taskDescription: "Integrate hygiene workflows",
        tier: "tier2_hybrid",
        status: "in_progress",
        milestones: [
          {
            id: "M01",
            title: "Implement hygiene engine",
            description: "Wire docs and git hygiene",
            status: "completed",
            assignedTo: "sub-agent",
            result: {
              success: true,
              filesModified: [
                "packages/mcp-server/src/index.ts",
                ".cursor/rules/local-context-wrapper.mdc"
              ],
              logs: "done"
            }
          }
        ],
        createdAt: now,
        updatedAt: now
      });

      const result = await tools.localRefreshDocs({
        taskId: "task-docs-1",
        scope: "smart_touched",
        apply: true
      });

      expect(result.applied).toBe(true);
      expect(result.updatedFiles).toContain("README.md");
      expect(result.updatedFiles).toContain("docs/technical-reference.md");
      expect(result.updatedFiles).toContain("docs/onboarding.md");

      const readme = await readFile(join(workspace, "README.md"), "utf8");
      const technical = await readFile(join(workspace, "docs/technical-reference.md"), "utf8");
      const onboarding = await readFile(join(workspace, "docs/onboarding.md"), "utf8");

      expect(readme).toContain("Automation Hygiene Update");
      expect(technical).toContain("task-docs-1");
      expect(onboarding).toContain("Completed milestones");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("creates a plan-scoped hygiene commit with explicit push hold", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      await runGitCommand(workspace, ["init"]);
      await runGitCommand(workspace, ["config", "user.name", "Wrapper Test"]);
      await runGitCommand(workspace, ["config", "user.email", "wrapper-test@example.com"]);

      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src/hygiene.ts"), "export const hygiene = false;\n", "utf8");
      await runGitCommand(workspace, ["add", "src/hygiene.ts"]);
      await runGitCommand(workspace, ["commit", "-m", "test: seed hygiene file"]);
      await writeFile(join(workspace, "src/hygiene.ts"), "export const hygiene = true;\n", "utf8");

      const now = new Date().toISOString();
      await store.writeActivePlan({
        version: 1,
        taskId: "task-git-1",
        taskDescription: "Checkpoint hygiene updates",
        tier: "tier2_hybrid",
        status: "in_progress",
        milestones: [
          {
            id: "M01",
            title: "Add hygiene internals",
            description: "Wire policy and orchestration",
            status: "completed",
            assignedTo: "sub-agent",
            result: {
              success: true,
              filesModified: ["src/hygiene.ts"],
              logs: "done"
            }
          }
        ],
        createdAt: now,
        updatedAt: now
      });

      const result = await tools.localGitHygiene({
        taskId: "task-git-1",
        mode: "plan_scoped",
        commit: true,
        commitMessage: "test: hygiene checkpoint"
      });

      expect(result.stagedFiles).toEqual(["src/hygiene.ts"]);
      expect(result.committed).toBe(true);
      expect(result.commitHash).toMatch(/^[a-f0-9]{40}$/);
      expect(result.pushRequiresApproval).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("emits hygiene threshold prompt during long-running plans", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Improve spec-driven development prompts"
      });
      await setHygieneThresholds(store.paths.policyPath, {
        milestones: 1,
        changedLines: 9999,
        autoDocUpdate: false,
        autoCommitOnPlanComplete: false
      });

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "llm" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["src/index.ts"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["npm test"],
            verificationSteps: ["Run test"],
            firstStep: "Review code",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "llm" as const
          })
        }
      });

      const plan = await tools.localDraftPlan({
        task: "Implement SafeEmitter with staged rollout",
        forceTier: "tier1_local",
        milestones: [
          {
            id: "M01",
            title: "Core implementation",
            description: "Build core implementation details"
          },
          {
            id: "M02",
            title: "Follow-up verification",
            description: "Finalize remaining work"
          }
        ]
      });

      const result = await tools.localExecuteMilestone({
        taskId: plan.taskId,
        milestoneId: "M01"
      });

      expect(result.success).toBe(true);
      expect(result.logs).toContain("[HYGIENE_PROMPT]");
      expect(result.logs).toContain("/lcw-docs");
      expect(result.logs).toContain("/lcw-git");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("blocks raw window reads above configured threshold", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Control token-heavy file reads"
      });
      await setContextManagementPolicy(store.paths.policyPath, {
        directorRawReadMaxLines: 10
      });

      await mkdir(join(workspace, "docs"), { recursive: true });
      await writeFile(
        join(workspace, "docs/notes.md"),
        Array.from({ length: 30 }, (_, idx) => `line ${idx + 1}`).join("\n"),
        "utf8"
      );

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["docs/notes.md"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["n/a"],
            verificationSteps: ["n/a"],
            firstStep: "n/a",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "heuristic" as const
          }),
          usesLlmScoring: false
        }
      });

      const blocked = await tools.localFileRead({
        filePath: "docs/notes.md",
        mode: "raw_window",
        limit: 20
      });

      expect(blocked.status).toBe("blocked_threshold");
      expect(blocked.thresholdLines).toBe(10);
      expect(blocked.requiresProjection).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("reuses cached projection output for repeated summary reads", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Cache projections for repeated reads"
      });

      await mkdir(join(workspace, "docs"), { recursive: true });
      await writeFile(
        join(workspace, "docs/design.md"),
        Array.from({ length: 120 }, (_, idx) => `## Section ${idx + 1}\nDetails ${idx + 1}`).join("\n"),
        "utf8"
      );

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["docs/design.md"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["n/a"],
            verificationSteps: ["n/a"],
            firstStep: "n/a",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "heuristic" as const
          }),
          usesLlmScoring: false
        }
      });

      const firstRead = await tools.localFileRead({
        filePath: "docs/design.md",
        mode: "summary_blocks"
      });
      const secondRead = await tools.localFileRead({
        filePath: "docs/design.md",
        mode: "summary_blocks"
      });

      expect(firstRead.fromCache).toBe(false);
      expect(secondRead.fromCache).toBe(true);
      expect(secondRead.projection).toContain("Lines");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("flags cheap hosted worker fallback when ollama is unavailable", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wrapper-mcp-"));
    try {
      const store = createContextStore(workspace);
      await store.initialize({
        projectName: "Wrapper",
        projectGoal: "Route projection fallback safely"
      });

      await mkdir(join(workspace, "docs"), { recursive: true });
      await writeFile(
        join(workspace, "docs/story.md"),
        Array.from({ length: 80 }, (_, idx) => `Paragraph ${idx + 1}`).join("\n"),
        "utf8"
      );

      const tools = createWrapperTools({
        store,
        runtime: {
          assessAndRefine: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          assessOnly: async ({ prompt }) => ({
            score: 80,
            missingContext: [],
            recommendedQuestions: [],
            refinedPrompt: prompt,
            scoringMethod: "heuristic" as const,
            readyForImplementation: true
          }),
          buildAgentBrief: async ({ task }) => ({
            goal: task,
            inScope: ["docs/story.md"],
            outOfScope: [],
            constraints: [],
            acceptanceCriteria: ["n/a"],
            verificationSteps: ["n/a"],
            firstStep: "n/a",
            briefMarkdown: "# Brief\n...",
            scoringMethod: "heuristic" as const
          }),
          usesLlmScoring: false
        }
      });

      const result = await tools.localFileRead({
        filePath: "docs/story.md",
        mode: "summary_blocks"
      });

      expect(result.requiresHostedWorker).toBe(true);
      expect(result.status).toBe("requires_hosted_worker");
      expect(result.hostedWorkerReason).toContain("Ollama unavailable");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

async function setValidationCommand(policyPath: string, command: string[]): Promise<void> {
  const raw = await readFile(policyPath, "utf8");
  const parsed = parse(raw) as Record<string, any>;
  const autonomous = {
    ...(parsed.autonomous || {}),
    validationCommand: command,
    autoValidate: true
  };
  parsed.autonomous = autonomous;
  await writeFile(policyPath, stringify(parsed), "utf8");
}

async function setHygieneThresholds(
  policyPath: string,
  input: {
    milestones: number;
    changedLines: number;
    autoDocUpdate: boolean;
    autoCommitOnPlanComplete: boolean;
  }
): Promise<void> {
  const raw = await readFile(policyPath, "utf8");
  const parsed = parse(raw) as Record<string, any>;
  parsed.hygiene = {
    ...(parsed.hygiene || {}),
    enabled: true,
    autoDocUpdate: input.autoDocUpdate,
    autoCommitOnPlanComplete: input.autoCommitOnPlanComplete,
    promptThresholds: {
      ...(parsed.hygiene?.promptThresholds || {}),
      milestones: input.milestones,
      changedLines: input.changedLines
    }
  };
  await writeFile(policyPath, stringify(parsed), "utf8");
}

async function setContextManagementPolicy(
  policyPath: string,
  input: {
    directorRawReadMaxLines?: number;
  }
): Promise<void> {
  const raw = await readFile(policyPath, "utf8");
  const parsed = parse(raw) as Record<string, any>;
  parsed.contextManagement = {
    ...(parsed.contextManagement || {}),
    ...(typeof input.directorRawReadMaxLines === "number"
      ? { directorRawReadMaxLines: input.directorRawReadMaxLines }
      : {})
  };
  await writeFile(policyPath, stringify(parsed), "utf8");
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.toString();
}
