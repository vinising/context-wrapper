import { readFile } from "node:fs/promises";
import { EvalCase } from "@wrapper/schemas";

export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
  toolsUsed: string[];
};

export type TranscriptEpisode = {
  id: string;
  timestamp?: string;
  rawPrompt: string;
  assistantResponse: string;
  toolsUsed: string[];
  followUpTurns: number;
};

export async function parseTranscript(filePath: string): Promise<TranscriptEpisode[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  
  const turns: TranscriptTurn[] = [];
  
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const role = parsed.role;
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      
      let text = "";
      const toolsUsed: string[] = [];
      
      const contentList = parsed.message?.content || parsed.content;
      if (Array.isArray(contentList)) {
        for (const item of contentList) {
          if (item.type === "text" && typeof item.text === "string") {
            text += item.text + "\n";
          } else if (item.type === "tool_use" && typeof item.name === "string") {
            toolsUsed.push(item.name);
          }
        }
      }
      
      turns.push({
        role,
        text: text.trim(),
        toolsUsed
      });
    } catch {
      // Skip malformed lines gracefully
    }
  }
  
  const episodes: TranscriptEpisode[] = [];
  let episodeCount = 1;
  
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if (turn.role === "user") {
      // Extract prompt
      let rawPrompt = turn.text;
      
      // Clean tags if present
      const queryMatch = rawPrompt.match(/<user_query>([\s\S]*?)<\/user_query>/i);
      if (queryMatch && queryMatch[1]) {
        rawPrompt = queryMatch[1].trim();
      }
      
      // Extract timestamp
      const timestampMatch = turn.text.match(/<timestamp>([\s\S]*?)<\/timestamp>/i);
      const timestampStr = timestampMatch && timestampMatch[1] ? timestampMatch[1].trim() : undefined;
      
      // Find following assistant turn and collect tools used until next user turn
      let assistantResponse = "";
      const episodeTools: string[] = [];
      let followUpTurns = 0;
      
      let j = i + 1;
      while (j < turns.length && turns[j]!.role !== "user") {
        const nextTurn = turns[j]!;
        if (nextTurn.role === "assistant") {
          assistantResponse += nextTurn.text + "\n";
          episodeTools.push(...nextTurn.toolsUsed);
          followUpTurns++;
        }
        j++;
      }
      
      // Skip empty or purely operational user prompts if they have no useful prompt content
      if (!rawPrompt) {
        continue;
      }
      
      episodes.push({
        id: `T${String(episodeCount).padStart(2, "0")}`,
        timestamp: timestampStr,
        rawPrompt,
        assistantResponse: assistantResponse.trim(),
        toolsUsed: [...new Set(episodeTools)],
        followUpTurns
      });
      
      episodeCount++;
    }
  }
  
  return episodes;
}

export function mapEpisodesToEvalCases(episodes: TranscriptEpisode[]): EvalCase[] {
  return episodes.map((ep) => {
    // Map intents based on keywords or tools
    let intent: "implementation" | "debugging" | "planning" | "review" = "implementation";
    const promptLower = ep.rawPrompt.toLowerCase();
    
    if (promptLower.includes("plan") || promptLower.includes("architecture") || promptLower.includes("scoping")) {
      intent = "planning";
    } else if (promptLower.includes("bug") || promptLower.includes("error") || promptLower.includes("fail") || promptLower.includes("fix")) {
      intent = "debugging";
    } else if (promptLower.includes("review") || promptLower.includes("eval")) {
      intent = "review";
    }
    
    // Parse timestamp into a valid ISO string if possible, or fallback to now
    let isoTimestamp: string | undefined;
    if (ep.timestamp) {
      try {
        const parsedDate = new Date(ep.timestamp);
        if (!isNaN(parsedDate.getTime())) {
          isoTimestamp = parsedDate.toISOString();
        }
      } catch {
        // use default ISO
      }
    }
    
    if (!isoTimestamp) {
      isoTimestamp = new Date().toISOString();
    }
    
    return {
      id: ep.id,
      rawPrompt: ep.rawPrompt,
      intent,
      timestamp: isoTimestamp,
      followUpTurns: ep.followUpTurns,
      toolsUsed: ep.toolsUsed,
      fixture: selectFixtureForTask(ep.rawPrompt, intent),
      goldenOutcome: ep.assistantResponse.slice(0, 100) + "..."
    };
  });
}

function selectFixtureForTask(prompt: string, intent: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("mcp") || p.includes("tool")) {
    return "mini-mcp-stub";
  }
  if (p.includes("index") || p.includes("semantic")) {
    return "repo-with-drift";
  }
  if (p.includes("scaffold") || p.includes("initial")) {
    return "empty-dir";
  }
  return "empty-node-project";
}
