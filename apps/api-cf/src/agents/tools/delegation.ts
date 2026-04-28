import { z } from "zod";
import { tool, streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";

import { SCRIPT_WRITER_PROMPT } from "../../prompts/script-writer";
import { CONCEPT_ARTIST_PROMPT } from "../../prompts/concept-artist";
import { STORYBOARD_DESIGNER_PROMPT } from "../../prompts/storyboard-designer";
import { EDITOR_PROMPT } from "../../prompts/editor";
import { cachedSystemPrompt } from "../cache-control";
import type { ProviderType } from "../../providers";
import { log } from "../../logger";

/** Rich tool call detail accumulated across generator yields. */
export interface SubAgentToolCall {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  status: "calling" | "completed" | "error";
}

/** Tool sets each specialist is allowed to use. */
const TOOL_ALLOWLISTS: Record<string, string[]> = {
  ScriptWriter: [
    "list_canvas_nodes",
    "read_canvas_node",
    "create_canvas_node",
    "search_canvas",
  ],
  ConceptArtist: [
    "list_canvas_nodes",
    "read_canvas_node",
    "create_canvas_node",
    "create_generation_node",
    "run_generation_node",
    "wait_for_generation",
    "list_models",
    "search_canvas",
  ],
  StoryboardDesigner: [
    "list_canvas_nodes",
    "read_canvas_node",
    "create_canvas_node",
    "create_generation_node",
    "run_generation_node",
    "wait_for_generation",
    "list_models",
    "search_canvas",
  ],
  Editor: [
    "list_canvas_nodes",
    "read_canvas_node",
    "search_canvas",
    "timeline_editor",
  ],
};

/** Specialist agent definitions. */
const SPECIALISTS: Record<string, { prompt: string; description: string }> = {
  ScriptWriter: {
    prompt: SCRIPT_WRITER_PROMPT,
    description: "Creates story outlines and scripts (text nodes only, no generation)",
  },
  ConceptArtist: {
    prompt: CONCEPT_ARTIST_PROMPT,
    description: "Visualizes characters and scenes (creates prompts + image generation)",
  },
  StoryboardDesigner: {
    prompt: STORYBOARD_DESIGNER_PROMPT,
    description: "Creates shot sequences (creates prompts + image/video generation)",
  },
  Editor: {
    prompt: EDITOR_PROMPT,
    description: "Assembles the final video from existing canvas assets (timeline only)",
  },
};

/** Filter a tool set to only include allowed tools for a specialist. */
function scopeTools(allTools: ToolSet, agentName: string): ToolSet {
  const allowed = TOOL_ALLOWLISTS[agentName];
  if (!allowed) return allTools;
  const scoped: ToolSet = {};
  for (const name of allowed) {
    if (allTools[name]) scoped[name] = allTools[name];
  }
  return scoped;
}

const delegationSchema = z.object({
  agent: z.enum(["ScriptWriter", "ConceptArtist", "StoryboardDesigner", "Editor"])
    .describe("Name of the sub-agent to use"),
  instruction: z.string().describe("Clear, specific task description. Include all relevant context."),
  workspace_group_id: z.string().optional()
    .describe("Group node ID to scope the agent's work. Create a group first if needed."),
  context: z.record(z.unknown()).optional()
    .describe("Structured context data: existing node IDs, script content, upstream references, etc."),
});

/**
 * Sub-agent progress object yielded to the frontend via generator tool streaming.
 * Each yield sends a preliminary tool output (part.preliminary = true).
 * toolCalls is accumulated — each yield carries the full history so the
 * frontend doesn't lose prior entries when apply-chunk overwrites the output.
 */
interface SubAgentProgress {
  status: "started" | "step" | "completed" | "failed";
  agent: string;
  step?: number;
  totalSteps?: number;
  toolCalls?: SubAgentToolCall[];
  text?: string;
  message?: string;
}

/**
 * Create the task delegation tool.
 *
 * Uses generator tool streaming (async function*) so the frontend
 * receives real-time sub-agent progress via preliminary tool outputs.
 */
export function createDelegationTool(
  model: LanguageModel,
  agentTools: ToolSet,
  provider: ProviderType = "openai",
) {
  const agentNames = Object.keys(SPECIALISTS);

  const taskDelegation = tool({
    description: [
      `Delegate a task to a specialized sub-agent.`,
      `Available agents:`,
      ...agentNames.map(n => `- ${n}: ${SPECIALISTS[n].description}`),
      ``,
      `IMPORTANT: Provide detailed instructions and pass relevant context (node IDs, content) so the sub-agent can work independently.`,
      `The sub-agent CANNOT see the conversation history — it only sees what you pass in instruction and context.`,
    ].join("\n"),
    inputSchema: delegationSchema,
    execute: async function* ({ agent, instruction, workspace_group_id, context }): AsyncGenerator<SubAgentProgress, string> {
      const specialist = SPECIALISTS[agent];
      if (!specialist) {
        return `Unknown agent: ${agent}. Available: ${agentNames.join(", ")}`;
      }

      // Build the sub-agent's instruction with all context
      const parts: string[] = [];
      if (workspace_group_id) {
        parts.push(`[Workspace Group ID: ${workspace_group_id}]`);
        parts.push(`All nodes you create should use parent_id="${workspace_group_id}".`);
      }
      parts.push(instruction);
      if (context) {
        parts.push(`\nContext:\n${JSON.stringify(context, null, 2)}`);
      }
      parts.push(`\nWhen you finish, summarize what you created: list each node ID, type, and label.`);

      const msgContent = parts.join("\n");
      const scopedTools = scopeTools(agentTools, agent);

      // Yield start event — frontend sees this immediately
      yield { status: "started", agent, message: `${agent} is working...` };

      try {
        log.info(`Delegating to ${agent} (${Object.keys(scopedTools).length} tools): ${instruction.slice(0, 100)}`);

        const result = streamText({
          model,
          system: cachedSystemPrompt(specialist.prompt, provider),
          messages: [{ role: "user" as const, content: msgContent }],
          tools: scopedTools,
          stopWhen: stepCountIs(15),
        });

        // Use fullStream for real-time progress (text + tool calls + tool results)
        let fullText = "";
        let stepCount = 0;
        const accumulatedToolCalls: SubAgentToolCall[] = [];

        let lastEventTime = Date.now();
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullText += part.text;
          } else if (part.type === "tool-call") {
            const now = Date.now();
            log.info(`[${agent}] tool-call: ${part.toolName} (+${now - lastEventTime}ms)`);
            lastEventTime = now;
            accumulatedToolCalls.push({
              id: (part as any).toolCallId || `tc-${stepCount}`,
              toolName: part.toolName,
              args: (part as any).args ?? (part as any).input as Record<string, unknown>,
              status: "calling",
            });
            yield {
              status: "step" as const,
              agent,
              step: ++stepCount,
              toolCalls: [...accumulatedToolCalls],
            };
          } else if (part.type === "tool-result") {
            const now = Date.now();
            log.info(`[${agent}] tool-result: ${(part as any).toolName} (+${now - lastEventTime}ms)`);
            lastEventTime = now;
            // Find matching tool call by toolCallId and update it
            const tcId = (part as any).toolCallId;
            const tc = tcId
              ? accumulatedToolCalls.find(t => t.id === tcId)
              : [...accumulatedToolCalls].reverse().find(t => t.toolName === (part as any).toolName && t.status === "calling");
            if (tc) {
              const output = (part as any).output;
              tc.output = typeof output === "string"
                ? output.slice(0, 300)
                : JSON.stringify(output).slice(0, 300);
              tc.status = "completed";
            }
            yield {
              status: "step" as const,
              agent,
              step: stepCount,
              toolCalls: [...accumulatedToolCalls],
            };
          } else if ((part as any).type === "step-start") {
            const now = Date.now();
            log.info(`[${agent}] step-start (+${now - lastEventTime}ms since last event)`);
            lastEventTime = now;
          }
        }

        const report = fullText || `${agent} completed the task.`;
        log.info(`${agent} completed: ${report.slice(0, 200)}`);

        // Yield completion with full tool call history preserved
        yield { status: "completed", agent, message: report.slice(0, 500), toolCalls: [...accumulatedToolCalls] };

        // Return final result for the supervisor model
        return report;
      } catch (e) {
        log.error(`${agent} error:`, e);
        yield { status: "failed", agent, message: String(e) };
        return `${agent} failed: ${e}. You may need to handle this task directly.`;
      }
    },
  });

  return taskDelegation;
}
