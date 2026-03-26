import { z } from "zod";
import { tool as _tool, streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";

const tool = _tool as any;

import { SCRIPT_WRITER_PROMPT } from "../../prompts/script-writer";
import { CONCEPT_ARTIST_PROMPT } from "../../prompts/concept-artist";
import { STORYBOARD_DESIGNER_PROMPT } from "../../prompts/storyboard-designer";
import { EDITOR_PROMPT } from "../../prompts/editor";

/** Specialist agent definitions. */
const SPECIALISTS: Record<string, { prompt: string; description: string }> = {
  ScriptWriter: {
    prompt: SCRIPT_WRITER_PROMPT,
    description: "Professional script writer for creating story outlines",
  },
  ConceptArtist: {
    prompt: CONCEPT_ARTIST_PROMPT,
    description: "Concept artist for visualizing characters and scenes",
  },
  StoryboardDesigner: {
    prompt: STORYBOARD_DESIGNER_PROMPT,
    description: "Storyboard designer for creating shot sequences",
  },
  Editor: {
    prompt: EDITOR_PROMPT,
    description: "Video editor for assembling the final video",
  },
};

/**
 * Create the task delegation tool.
 *
 * Sub-agents are separate `streamText()` calls with different system prompts,
 * all within the same DO.
 */
export function createDelegationTool(
  model: LanguageModel,
  agentTools: ToolSet,
  sendMessage: (msg: Record<string, unknown>) => void
) {
  const agentNames = Object.keys(SPECIALISTS);

  const taskDelegation = tool({
    description: `Delegate a task to a specialized sub-agent. Available agents: ${agentNames.join(", ")}`,
    parameters: z.object({
      agent: z.string().describe("Name of the sub-agent to use"),
      instruction: z.string().describe("Clear task description"),
      workspace_group_id: z.string().optional().describe("Optional group node ID to scope the agent's work"),
      context: z.record(z.unknown()).optional().describe("Optional context data"),
    }),
    execute: async (args: any) => {
      const { agent, instruction, workspace_group_id, context } = args;
      const specialist = SPECIALISTS[agent];
      if (!specialist) {
        return `Unknown agent: ${agent}. Available: ${agentNames.join(", ")}`;
      }

      try {
        sendMessage({ type: "sub_agent_start", agentName: agent });

        let msgContent = instruction;
        if (workspace_group_id) {
          msgContent = `[Workspace: ${workspace_group_id}]\n${instruction}`;
        }
        if (context) {
          msgContent = `${msgContent}\nContext: ${JSON.stringify(context)}`;
        }

        const result = streamText({
          model,
          system: specialist.prompt,
          messages: [{ role: "user" as const, content: msgContent }],
          tools: agentTools,
        });

        let fullText = "";
        for await (const chunk of result.textStream) {
          fullText += chunk;
        }

        sendMessage({ type: "sub_agent_end", agentName: agent, result: fullText });
        return `${agent} completed: ${fullText.slice(0, 500)}`;
      } catch (e) {
        sendMessage({ type: "sub_agent_end", agentName: agent, result: `Error: ${e}` });
        return `${agent} error: ${e}`;
      }
    },
  });

  return taskDelegation;
}
