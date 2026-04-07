import { describe, it, expect, vi } from "vitest";
import { tool } from "ai";
import type { ToolSet } from "ai";

// ─── scopeTools (extracted for testing) ─────────────────────────

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

function scopeTools(allTools: ToolSet, agentName: string): ToolSet {
  const allowed = TOOL_ALLOWLISTS[agentName];
  if (!allowed) return allTools;
  const scoped: ToolSet = {};
  for (const name of allowed) {
    if (allTools[name]) scoped[name] = allTools[name];
  }
  return scoped;
}

// Create a mock tool set with all possible tools
function makeMockTools(): ToolSet {
  const names = [
    "list_canvas_nodes",
    "read_canvas_node",
    "create_canvas_node",
    "create_generation_node",
    "run_generation_node",
    "wait_for_generation",
    "list_models",
    "search_canvas",
    "timeline_editor",
    "task_delegation",
  ];
  const tools: ToolSet = {};
  for (const name of names) {
    tools[name] = { description: name } as any;
  }
  return tools;
}

describe("scopeTools", () => {
  const allTools = makeMockTools();

  it("ScriptWriter only gets text tools, no generation", () => {
    const scoped = scopeTools(allTools, "ScriptWriter");
    const names = Object.keys(scoped);

    expect(names).toContain("list_canvas_nodes");
    expect(names).toContain("read_canvas_node");
    expect(names).toContain("create_canvas_node");
    expect(names).toContain("search_canvas");
    expect(names).not.toContain("create_generation_node");
    expect(names).not.toContain("run_generation_node");
    expect(names).not.toContain("list_models");
    expect(names).not.toContain("timeline_editor");
    expect(names).not.toContain("task_delegation");
  });

  it("ConceptArtist gets generation tools but no timeline", () => {
    const scoped = scopeTools(allTools, "ConceptArtist");
    const names = Object.keys(scoped);

    expect(names).toContain("create_generation_node");
    expect(names).toContain("run_generation_node");
    expect(names).toContain("wait_for_generation");
    expect(names).toContain("list_models");
    expect(names).not.toContain("timeline_editor");
    expect(names).not.toContain("task_delegation");
  });

  it("StoryboardDesigner has same tools as ConceptArtist", () => {
    const concept = Object.keys(scopeTools(allTools, "ConceptArtist")).sort();
    const storyboard = Object.keys(scopeTools(allTools, "StoryboardDesigner")).sort();

    expect(storyboard).toEqual(concept);
  });

  it("Editor gets timeline but no generation tools", () => {
    const scoped = scopeTools(allTools, "Editor");
    const names = Object.keys(scoped);

    expect(names).toContain("timeline_editor");
    expect(names).toContain("list_canvas_nodes");
    expect(names).not.toContain("create_generation_node");
    expect(names).not.toContain("run_generation_node");
    expect(names).not.toContain("create_canvas_node");
  });

  it("unknown agent gets all tools (no allowlist)", () => {
    const scoped = scopeTools(allTools, "UnknownAgent");

    expect(Object.keys(scoped).length).toBe(Object.keys(allTools).length);
  });

  it("handles missing tools gracefully", () => {
    const partialTools: ToolSet = {
      list_canvas_nodes: { description: "list" } as any,
      // Missing other tools that ScriptWriter expects
    };

    const scoped = scopeTools(partialTools, "ScriptWriter");
    expect(Object.keys(scoped)).toEqual(["list_canvas_nodes"]);
  });

  it("no agent can access task_delegation (prevents recursion)", () => {
    for (const agentName of Object.keys(TOOL_ALLOWLISTS)) {
      const scoped = scopeTools(allTools, agentName);
      expect(Object.keys(scoped)).not.toContain("task_delegation");
    }
  });
});
