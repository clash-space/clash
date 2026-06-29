import { describe, expect, it, vi } from "vitest";
import { sanitizeNodesForReactFlow } from "./canvasNodeOrder";

describe("sanitizeNodesForReactFlow", () => {
  it("keeps an already valid parent-first node array by reference", () => {
    const parent = { id: "parent", position: { x: 0, y: 0 }, data: {} };
    const child = { id: "child", parentId: "parent", position: { x: 8, y: 8 }, data: {} };
    const nodes = [parent, child];

    expect(sanitizeNodesForReactFlow(nodes)).toBe(nodes);
  });

  it("orders parents before children without cloning unchanged nodes", () => {
    const parent = { id: "parent", position: { x: 0, y: 0 }, data: {} };
    const child = { id: "child", parentId: "parent", position: { x: 8, y: 8 }, data: {} };

    const result = sanitizeNodesForReactFlow([child, parent]);

    expect(result.map((node) => node.id)).toEqual(["parent", "child"]);
    expect(result[0]).toBe(parent);
    expect(result[1]).toBe(child);
  });

  it("cleans invalid parents once and reports them to the caller", () => {
    const onInvalidParent = vi.fn();
    const child = {
      id: "child",
      parentId: "missing",
      extent: "parent",
      position: { x: 8, y: 8 },
      data: {},
    };

    const nodes = [child];
    const result = sanitizeNodesForReactFlow(nodes, { onInvalidParent });

    expect(result).not.toBe(nodes);
    expect(result[0]).not.toBe(child);
    expect(result[0]).toMatchObject({
      id: "child",
      parentId: undefined,
      extent: undefined,
    });
    expect(onInvalidParent).toHaveBeenCalledWith(child, "missing");
  });
});
