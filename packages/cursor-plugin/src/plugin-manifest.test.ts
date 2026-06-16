import { describe, expect, it } from "vitest";
import { createPluginManifest, wrapperRules, wrapperCommands } from "./index.js";

describe("Cursor plugin package", () => {
  it("declares local sidecar assets without claiming unsupported prompt rewriting", () => {
    const manifest = createPluginManifest();

    expect(manifest.name).toBe("local-context-wrapper");
    expect(manifest.mcpServers[0]?.command).toBe("node");
    expect(wrapperRules).toContain("Do not automatically refine every user message");
    expect(wrapperCommands.refinePrompt).toContain("refine_prompt");
    expect(manifest.capabilities).not.toContain("rewriteBuiltInChatPrompt");
  });
});
