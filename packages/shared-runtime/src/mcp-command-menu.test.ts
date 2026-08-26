import { describe, expect, it } from "vitest";

import {
  CLASH_MCP_COMMANDS,
  buildClashMcpCommandMenu,
  classifyClashMcpTool,
  getClashMcpCommand,
} from "./mcp-command-menu.js";

describe("Clash MCP command menu", () => {
  it("uses CLI-like root commands without exposing CLI wrappers", () => {
    expect(CLASH_MCP_COMMANDS.map(({ id }) => id)).toEqual([
      "workspace",
      "plugin",
      "assets",
      "canvas",
      "generators",
      "director",
      "timeline",
    ]);
    expect(classifyClashMcpTool("clash_workspace_init")).toBe("workspace");
    expect(classifyClashMcpTool("clash_plugin_activate")).toBe("plugin");
    expect(classifyClashMcpTool("clash_assets_get")).toBe("assets");
    expect(classifyClashMcpTool("clash_canvas_get")).toBe("canvas");
    expect(classifyClashMcpTool("clash_generators_run")).toBe("generators");
    expect(classifyClashMcpTool("clash_director_save")).toBe("director");
    expect(classifyClashMcpTool("clash_timeline_schema")).toBe("timeline");
    expect(classifyClashMcpTool("clash_cli_assets")).toBe("other");
  });

  it("classifies generic Project Generator and Action Run leaves as the generators command, not just AIGC provider leaves", () => {
    expect(classifyClashMcpTool("clash_generators_get")).toBe("generators");
    expect(classifyClashMcpTool("clash_generators_action_run_get")).toBe(
      "generators",
    );
  });

  it("describes the generators command as the generic Project Generator abstraction, not an AIGC-only provider catalog", () => {
    const generators = getClashMcpCommand("generators");
    // The Project Generator abstraction (GeneratorDefinition -> ProjectGenerator
    // -> GeneratorRevision -> Action Run -> Output Commit) is plugin-registered
    // and spans Timeline, Director Stage, transcription, and media generation,
    // not only AIGC image/video providers.
    expect(generators.useWhen).toMatch(/project generator/i);
    expect(generators.useWhen).toMatch(/action run/i);
    expect(generators.useWhen.toLowerCase()).not.toContain("aigc");
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
