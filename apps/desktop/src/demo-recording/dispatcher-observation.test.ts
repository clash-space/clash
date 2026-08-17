import { describe, expect, it } from "vitest";

describe("Clash dispatcher observation", () => {
  it("projects the same execution from Pi-direct and generic MCP wrapper inputs", async () => {
    const module = await import("./dispatcher-observation.js").catch(
      () => ({}),
    );
    const projectClashDispatcherCall = (
      module as {
        projectClashDispatcherCall?: (
          toolName: string | undefined,
          rawInput: unknown,
        ) => unknown;
      }
    ).projectClashDispatcherCall;

    expect(typeof projectClashDispatcherCall).toBe("function");
    if (!projectClashDispatcherCall) return;

    const expected = {
      dispatcher: "clash_canvas",
      mode: "execute",
      requestedOperation: "add",
      canonicalOperation: "clash_canvas_add",
    };
    expect(
      projectClashDispatcherCall("clash_canvas", {
        operation: "add",
        arguments: { type: "text", prompt: "fixture-private-prompt" },
      }),
    ).toEqual(expected);
    expect(
      projectClashDispatcherCall("clash_canvas", {
        server: "clash",
        tool: "clash_canvas",
        arguments: {
          operation: "add",
          arguments: { type: "text", prompt: "fixture-private-prompt" },
        },
      }),
    ).toEqual(expected);
    expect(JSON.stringify(expected)).not.toMatch(
      /prompt|arguments|fixture-private/u,
    );
  });

  it("projects only the four dispatcher modes and singular requested selectors", async () => {
    const module = await import("./dispatcher-observation.js").catch(
      () => ({}),
    );
    const projectClashDispatcherCall = (
      module as {
        projectClashDispatcherCall?: (
          toolName: string | undefined,
          rawInput: unknown,
        ) => unknown;
      }
    ).projectClashDispatcherCall;

    expect(typeof projectClashDispatcherCall).toBe("function");
    if (!projectClashDispatcherCall) return;

    expect(projectClashDispatcherCall("clash_assets", {})).toEqual({
      dispatcher: "clash_assets",
      mode: "index",
    });
    expect(
      projectClashDispatcherCall("clash_canvas", { contract: "get" }),
    ).toEqual({
      dispatcher: "clash_canvas",
      mode: "contract",
      requestedOperation: "get",
    });
    expect(
      projectClashDispatcherCall("clash_composition", {
        kind: "timeline",
        contracts: ["create", "attach"],
      }),
    ).toEqual({
      dispatcher: "clash_composition",
      mode: "contracts",
    });
    expect(
      projectClashDispatcherCall("clash_composition", {
        kind: "director-stage",
        operation: "create",
      }),
    ).toEqual({
      dispatcher: "clash_composition",
      mode: "execute",
      requestedOperation: "create",
      canonicalOperation: "clash_director_create",
    });
  });

  it("does not unwrap Pi leaf arguments as an MCP envelope", async () => {
    const module = await import("./dispatcher-observation.js").catch(
      () => ({}),
    );
    const projectClashDispatcherCall = (
      module as {
        projectClashDispatcherCall?: (
          toolName: string | undefined,
          rawInput: unknown,
        ) => unknown;
      }
    ).projectClashDispatcherCall;

    expect(typeof projectClashDispatcherCall).toBe("function");
    if (!projectClashDispatcherCall) return;

    expect(
      projectClashDispatcherCall("clash_canvas", {
        arguments: {
          operation: "delete",
          path: "/Users/alice/private-project",
        },
      }),
    ).toEqual({ dispatcher: "clash_canvas", mode: "index" });
  });

  it("fails closed for spoofed wrappers, conflicting selectors, and unsafe operation strings", async () => {
    const module = await import("./dispatcher-observation.js").catch(
      () => ({}),
    );
    const projectClashDispatcherCall = (
      module as {
        projectClashDispatcherCall?: (
          toolName: string | undefined,
          rawInput: unknown,
        ) => unknown;
      }
    ).projectClashDispatcherCall;

    expect(typeof projectClashDispatcherCall).toBe("function");
    if (!projectClashDispatcherCall) return;

    expect(
      projectClashDispatcherCall("clash_canvas", {
        server: "other",
        tool: "clash_canvas",
        arguments: { operation: "list" },
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_composition", {
        server: "clash",
        tool: "clash_canvas",
        arguments: { operation: "list" },
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_timeline", {
        server: "clash",
        tool: "clash_canvas",
        arguments: { operation: "list" },
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_canvas", {
        operation: "list",
        contract: "get",
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_canvas", {
        operation: "/Users/alice/private-project",
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_canvas", {
        operation: "clash_canvas__delete",
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_canvas", {
        contracts: ["get", "fixture private prompt"],
      }),
    ).toBeUndefined();
    expect(
      projectClashDispatcherCall("clash_canvas", "private prompt"),
    ).toBeUndefined();
  });

  it("does not canonicalize a complete leaf from another dispatcher family", async () => {
    const module = await import("./dispatcher-observation.js").catch(
      () => ({}),
    );
    const projectClashDispatcherCall = (
      module as {
        projectClashDispatcherCall?: (
          toolName: string | undefined,
          rawInput: unknown,
        ) => unknown;
      }
    ).projectClashDispatcherCall;

    expect(typeof projectClashDispatcherCall).toBe("function");
    if (!projectClashDispatcherCall) return;
    expect(
      projectClashDispatcherCall("clash_canvas", {
        operation: "clash_timeline_create",
      }),
    ).toEqual({
      dispatcher: "clash_canvas",
      mode: "execute",
      requestedOperation: "clash_timeline_create",
    });
  });
});
