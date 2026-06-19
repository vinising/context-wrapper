import { describe, expect, it } from "vitest";
import {
  sanitizeHandoffFocus,
  sanitizeHandoffSteps,
  sanitizeHandoffText
} from "./sanitize-handoff.js";

describe("sanitizeHandoffText", () => {
  it("strips clean-slate boilerplate and pasted chat pollution", () => {
    const polluted = [
      "### State Locked-in",
      "- Verified compaction",
      "",
      "--- END COMPACTED SUMMARY ---",
      "",
      "Please call `get_context_handoff` to synchronize your active memory.",
      "",
      "[USER]: <timestamp>Wednesday</timestamp>",
      "<user_query>Here's the response from a new agent</user_query>"
    ].join("\n");

    expect(sanitizeHandoffText(polluted)).toBe(
      "### State Locked-in\n- Verified compaction"
    );
  });

  it("keeps legitimate multi-line summaries intact", () => {
    const summary = [
      "### State Locked-in",
      "* Fixed command asset propagation via copyAllAssets()",
      "* All 44 tests passing",
      "",
      "### Active Decisions",
      "* Dynamic directory asset walks"
    ].join("\n");

    expect(sanitizeHandoffText(summary)).toBe(summary);
  });
});

describe("sanitizeHandoffFocus", () => {
  it("returns only the first focus line", () => {
    expect(
      sanitizeHandoffFocus("- Verify slash commands\n- Extra pasted line")
    ).toBe("Verify slash commands");
  });
});

describe("sanitizeHandoffSteps", () => {
  it("filters empty steps after pollution stripping", () => {
    expect(
      sanitizeHandoffSteps([
        "- Confirm setup:cursor deploys commands",
        "Please call get_context_handoff"
      ])
    ).toEqual(["Confirm setup:cursor deploys commands"]);
  });
});

describe("isValidCompactionSummary", () => {
  it("rejects fallback echo and prompt leakage", async () => {
    const { isValidCompactionSummary, parseCompactionSummaryContract } = await import("./sanitize-handoff.js");
    expect(isValidCompactionSummary("Local fallback history summary. Context is saved to disk.")).toBe(
      false
    );
    expect(
      isValidCompactionSummary("Refined prompt:\nYou are an expert context compaction engine")
    ).toBe(false);
    expect(
      isValidCompactionSummary("**State Locked-in**:\n- Verified compaction\n\n**Current Focus**:\n- Tests")
    ).toBe(false);
    expect(
      isValidCompactionSummary("## State Locked-in Features\n- Verified compaction\n\n## Current Focus\n- Tests")
    ).toBe(false);
  });

  it("rejects compaction missing Key Files section (breaking change)", async () => {
    const { isValidCompactionSummary } = await import("./sanitize-handoff.js");
    expect(
      isValidCompactionSummary(
        "### State Locked-in\n- Verified compaction\n\n### Current Focus\n- Tests\n\n### Active Decisions\n- Keep strict headings"
      )
    ).toBe(false);
  });

  it("accepts valid 4-section compaction with Key Files", async () => {
    const { isValidCompactionSummary, parseCompactionSummaryContract } = await import("./sanitize-handoff.js");
    const valid = [
      "### State Locked-in",
      "- Verified compaction",
      "",
      "### Current Focus",
      "- Tests",
      "",
      "### Active Decisions",
      "- Keep strict headings",
      "",
      "### Key Files",
      "- packages/mcp-server/src/index.ts -- core MCP tools",
      "- packages/context-store/src/sanitize-handoff.ts -- contract parser"
    ].join("\n");

    expect(isValidCompactionSummary(valid)).toBe(true);
    expect(parseCompactionSummaryContract(valid)).toEqual({
      stateLockedIn: "- Verified compaction",
      currentFocus: "- Tests",
      activeDecisions: "- Keep strict headings",
      keyFiles: "- packages/mcp-server/src/index.ts -- core MCP tools\n- packages/context-store/src/sanitize-handoff.ts -- contract parser"
    });
  });
});
