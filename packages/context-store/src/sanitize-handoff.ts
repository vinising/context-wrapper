const POLLUTION_MARKERS = [
  /---\s*COMPACTED[\s\S]*/i,
  /---\s*END COMPACTED[\s\S]*/i,
  /Please call [`'"]?get_context_handoff[`'"]?[\s\S]*/i,
  /\n?\[USER\]:[\s\S]*/i,
  /\n?\[ASSISTANT\]:[\s\S]*/i,
  /<user_query>[\s\S]*/i,
  /Memory is synchronized and verification is complete[\s\S]*/i
];

export function sanitizeHandoffText(text: string): string {
  let result = text.trim();
  for (const pattern of POLLUTION_MARKERS) {
    result = result.replace(pattern, "").trim();
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeHandoffFocus(text: string): string {
  const cleaned = sanitizeHandoffText(text);
  const firstLine = cleaned.split(/\r?\n/).find((line) => line.trim().length > 0) ?? cleaned;
  return firstLine.replace(/^[-*]\s*/, "").trim();
}

export function sanitizeHandoffSteps(steps: string[]): string[] {
  return steps
    .map((step) => sanitizeHandoffFocus(step))
    .filter((step) => step.length > 0);
}

const INVALID_COMPACTION_MARKERS = [
  /Refined prompt:/i,
  /bloated chat conversation history/i,
  /Model recommendation:/i,
  /Fallback mode active/i,
  /You are an expert context compaction engine/i
];

export type CompactionContractSections = {
  stateLockedIn: string;
  currentFocus: string;
  activeDecisions: string;
  keyFiles: string;
};

const REQUIRED_COMPACTION_HEADINGS = [
  "State Locked-in",
  "Current Focus",
  "Active Decisions",
  "Key Files"
] as const;

export function parseCompactionSummaryContract(summary: string): CompactionContractSections | null {
  const trimmed = summary.trim();
  if (!trimmed || trimmed === "Local fallback history summary. Context is saved to disk.") {
    return null;
  }
  if (INVALID_COMPACTION_MARKERS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }

  const headingRegex = /^###\s+([^\n]+)\s*$/gm;
  const matches = Array.from(trimmed.matchAll(headingRegex));
  if (matches.length !== REQUIRED_COMPACTION_HEADINGS.length) {
    return null;
  }

  for (let index = 0; index < REQUIRED_COMPACTION_HEADINGS.length; index += 1) {
    const actual = matches[index]?.[1]?.trim() ?? "";
    if (actual !== REQUIRED_COMPACTION_HEADINGS[index]) {
      return null;
    }
  }

  const sections: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const sectionStart = (match.index ?? 0) + match[0].length;
    const sectionEnd = index + 1 < matches.length ? (matches[index + 1].index ?? trimmed.length) : trimmed.length;
    const body = trimmed.slice(sectionStart, sectionEnd).trim();
    if (!body) {
      return null;
    }
    sections.push(body);
  }

  return {
    stateLockedIn: sections[0]!,
    currentFocus: sections[1]!,
    activeDecisions: sections[2]!,
    keyFiles: sections[3]!
  };
}

export function isValidCompactionSummary(summary: string): boolean {
  return parseCompactionSummaryContract(summary) !== null;
}
