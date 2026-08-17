import type { AgentDemoDriver } from "../../../../apps/desktop/e2e/recording/types.js";

const driver = {
  kind: "agent",
  projectName: "Signal Garden Agent Demo",
  prompt: [
    "Build a small editable previsualization called Signal Garden in the current Clash project.",
    "Begin with tool calls, keep reasoning private, and keep any visible progress text brief.",
    "Use only the bundled Clash MCP tools for product state; do not use a shell or the Clash CLI for product mutations.",
    "Inspect the live dispatcher indexes and request the needed operation contracts before execution instead of guessing operation names or arguments.",
    "Perform mutations sequentially and wait for each tool result before starting the next mutation.",
    "First inspect the current Canvas and identify its Canvas id.",
    "Add two text nodes: one labelled Brief with the content 'A lone signal wakes a quiet garden at dusk', and one labelled Beat Sheet with the content 'Hook: a pulse. Turn: the garden answers. Payoff: lights bloom in rhythm.'.",
    "Create a standalone Director Stage with id signal-garden-stage and name Signal Garden Stage, then attach it to the current Canvas.",
    "Create a standalone Timeline with id signal-garden-timeline and name Signal Garden Cut, then attach it to the current Canvas.",
    "Finally read back the Canvas, Director Stage, and Timeline through Clash only after all six mutations are persisted.",
    "After the final readback, end with exactly DEMO_READY with no trailing whitespace, punctuation, Markdown, or other final text.",
  ].join(" "),
  expectedFinalAnswer: "DEMO_READY",
  requirements: {
    operations: [
      { name: "clash_canvas_add", minCalls: 2 },
      { name: "clash_director_create", minCalls: 1 },
      { name: "clash_director_attach", minCalls: 1 },
      { name: "clash_timeline_create", minCalls: 1 },
      { name: "clash_timeline_attach", minCalls: 1 },
    ],
    minimumProductState: {
      canvasNodes: 4,
      timelines: 1,
      directorStages: 1,
    },
    requiredProductState: {
      canvasNodes: [
        {
          type: "text",
          label: "Brief",
          content: "A lone signal wakes a quiet garden at dusk",
          canvasId: "main",
        },
        {
          type: "text",
          label: "Beat Sheet",
          content:
            "Hook: a pulse. Turn: the garden answers. Payoff: lights bloom in rhythm.",
          canvasId: "main",
        },
        { type: "video-editor", label: "Signal Garden Cut", canvasId: "main" },
        { type: "director-stage", label: "Signal Garden Stage", canvasId: "main" },
      ],
      timelines: [{
        id: "signal-garden-timeline",
        name: "Signal Garden Cut",
        owner: { kind: "canvas-action", canvasId: "main" },
      }],
      directorStages: [{
        id: "signal-garden-stage",
        name: "Signal Garden Stage",
        owner: { kind: "canvas-action", canvasId: "main" },
      }],
    },
  },
} satisfies AgentDemoDriver;

export default driver;
