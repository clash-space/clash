import { describe, expect, it } from "vitest";

import {
  CLASH_MCP_COMMANDS,
  buildClashMcpCommandMenu,
  classifyClashMcpTool,
} from "./mcp-command-menu.js";

describe("Clash MCP command menu", () => {
  it("uses CLI-like root commands without exposing CLI wrappers", () => {
    expect(CLASH_MCP_COMMANDS.map(({ id }) => id)).toEqual([
      "workspace",
      "assets",
      "canvas",
      "director",
      "timeline",
    ]);
    expect(classifyClashMcpTool("clash_workspace_init")).toBe("workspace");
    expect(classifyClashMcpTool("clash_assets_get")).toBe("assets");
    expect(classifyClashMcpTool("clash_canvas_get")).toBe("canvas");
    expect(classifyClashMcpTool("clash_director_save")).toBe("director");
    expect(classifyClashMcpTool("clash_timeline_schema")).toBe("timeline");
    expect(classifyClashMcpTool("clash_cli_assets")).toBe("other");
  });

  it("folds leaf operations until a root command is selected", () => {
    const operations = [
      { name: "clash_canvas_get" },
      { name: "clash_director_save" },
    ];
    const root = buildClashMcpCommandMenu({
      operations,
      belongsToCommand: (operation, command) =>
        classifyClashMcpTool(operation.name) === command.id,
    });
    expect(root.operations).toBeUndefined();
    expect(
      root.commands.find(({ id }) => id === "director")?.availableOperations,
    ).toBe(1);

    const director = buildClashMcpCommandMenu({
      operations,
      selectedCommand: "director",
      belongsToCommand: (operation, command) =>
        classifyClashMcpTool(operation.name) === command.id,
    });
    expect(director.operations).toEqual([{ name: "clash_director_save" }]);
  });
});
