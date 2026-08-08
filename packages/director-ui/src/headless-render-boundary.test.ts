import { describe, expect, it, vi } from "vitest";

describe("Director headless render boundary", () => {
  it("publishes a frame only after the product WebGL renderer draws it", async () => {
    const module = await import("./headless-render-boundary").catch(() => ({})) as Record<string, unknown>;
    expect(typeof module.renderDirectorFrameNow).toBe("function");

    const order: string[] = [];
    const render = vi.fn(() => order.push("render"));
    const publish = vi.fn(() => order.push("publish"));
    (module.renderDirectorFrameNow as (input: Record<string, unknown>) => void)({
      renderer: { render },
      scene: { id: "scene" },
      camera: { id: "camera" },
      timeSeconds: 1.25,
      canvas: { width: 1080, height: 1920 },
      publish,
    });

    expect(render).toHaveBeenCalledWith({ id: "scene" }, { id: "camera" });
    expect(publish).toHaveBeenCalledWith({
      timeSeconds: 1.25,
      canvas: { width: 1080, height: 1920 },
    });
    expect(order).toEqual(["render", "publish"]);
  });

  it("holds first publication until resources and scene effects stay settled", async () => {
    const module = await import("./headless-render-boundary") as Record<string, any>;
    expect(typeof module.createDirectorFramePublicationGate).toBe("function");
    const gate = module.createDirectorFramePublicationGate(8);

    expect(Array.from({ length: 7 }, () => gate.tick(false))).toEqual([
      false, false, false, false, false, false, false,
    ]);
    expect(gate.tick(false)).toBe(true);
    expect(gate.tick(false)).toBe(false);

    gate.reset();
    expect(gate.tick(false)).toBe(false);
    expect(gate.tick(true)).toBe(false);
    expect(Array.from({ length: 7 }, () => gate.tick(false))).toEqual([
      false, false, false, false, false, false, false,
    ]);
    expect(gate.tick(false)).toBe(true);
  });
});
