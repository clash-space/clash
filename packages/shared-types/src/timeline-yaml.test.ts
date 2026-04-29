import { describe, it, expect } from "vitest";
import {
  timelineDslToYaml,
  timelineDslFromYaml,
  timelineDslHash,
  parseFromExpression,
  resolveFromExpression,
} from "./timeline-yaml";

describe("parseFromExpression", () => {
  it("parses raw numbers", () => {
    expect(parseFromExpression(30)).toEqual({ kind: "absolute", value: 30 });
    expect(parseFromExpression(0)).toEqual({ kind: "absolute", value: 0 });
  });

  it("parses numeric strings", () => {
    expect(parseFromExpression("30")).toEqual({ kind: "absolute", value: 30 });
    expect(parseFromExpression("30.5")).toEqual({ kind: "absolute", value: 30.5 });
  });

  it("treats `start` as 0", () => {
    expect(parseFromExpression("start")).toEqual({ kind: "absolute", value: 0 });
  });

  it("parses bare references with zero offset", () => {
    expect(parseFromExpression("clip-A")).toEqual({ kind: "reference", refId: "clip-A", offset: 0 });
    expect(parseFromExpression("prev")).toEqual({ kind: "reference", refId: "prev", offset: 0 });
  });

  it("parses references with positive and negative offsets", () => {
    expect(parseFromExpression("clip-A+30")).toEqual({ kind: "reference", refId: "clip-A", offset: 30 });
    expect(parseFromExpression("clip-A-15")).toEqual({ kind: "reference", refId: "clip-A", offset: -15 });
    expect(parseFromExpression("prev + 5")).toEqual({ kind: "reference", refId: "prev", offset: 5 });
  });

  it("returns null on garbage", () => {
    expect(parseFromExpression("")).toBeNull();
    expect(parseFromExpression(null)).toBeNull();
    expect(parseFromExpression(undefined)).toBeNull();
    expect(parseFromExpression({})).toBeNull();
  });
});

describe("timelineDslFromYaml — relative reference resolution", () => {
  it("resolves `prev` chain on a single track", () => {
    const yaml = `
tracks:
  - id: video
    name: Main
    items:
      - id: clip-A
        type: video
        from: 0
        durationInFrames: 150
      - id: clip-B
        type: video
        from: prev
        durationInFrames: 90
      - id: clip-C
        type: video
        from: prev-30
        durationInFrames: 60
`;
    const result = timelineDslFromYaml(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.dsl.tracks[0].items;
    expect(items[0].from).toBe(0);
    expect(items[1].from).toBe(150); // 0 + 150
    expect(items[1].fromExpr).toBe("prev");
    expect(items[2].from).toBe(210); // 150 + 90 - 30
    expect(items[2].fromExpr).toBe("prev-30");
  });

  it("resolves explicit id references", () => {
    const yaml = `
tracks:
  - id: video
    items:
      - id: a
        type: video
        from: 100
        durationInFrames: 60
      - id: b
        type: video
        from: a+0
        durationInFrames: 30
      - id: c
        type: video
        from: a-15
        durationInFrames: 30
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = r.dsl.tracks[0].items;
    expect(items[1].from).toBe(160); // 100 + 60 + 0
    expect(items[2].from).toBe(145); // 100 + 60 - 15
  });

  it("falls back to 0 on cycle and unknown refs", () => {
    const yaml = `
tracks:
  - id: t
    items:
      - id: a
        type: video
        from: b+0
        durationInFrames: 30
      - id: b
        type: video
        from: a+0
        durationInFrames: 30
      - id: c
        type: video
        from: missing+10
        durationInFrames: 30
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Cycle a↔b: both should fall back to 0 (then resolve to 0 + 30 + 0 = 30
    // for whoever is resolved second). Either way both ≥ 0 and finite.
    for (const it of r.dsl.tracks[0].items) {
      expect(Number.isFinite(it.from)).toBe(true);
      expect(it.from).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats `start` as zero", () => {
    const yaml = `
tracks:
  - id: t
    items:
      - id: a
        type: video
        from: start
        durationInFrames: 30
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dsl.tracks[0].items[0].from).toBe(0);
  });

  it("rejects items missing required fields", () => {
    const yaml = `
tracks:
  - id: t
    items:
      - type: video
        from: 0
        durationInFrames: 30
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(false);
  });
});

describe("timelineDslToYaml round-trip", () => {
  it("preserves fromExpr through a round trip", () => {
    const dsl = {
      compositionWidth: 1920,
      compositionHeight: 1080,
      fps: 30,
      durationInFrames: 300,
      tracks: [
        {
          id: "video",
          name: "Main",
          items: [
            { id: "a", type: "video", from: 0, durationInFrames: 150 },
            { id: "b", type: "video", from: 150, durationInFrames: 90, fromExpr: "prev" },
            { id: "c", type: "video", from: 210, durationInFrames: 60, fromExpr: "prev-30" },
          ],
        },
      ],
    };
    const yaml = timelineDslToYaml(dsl);
    expect(yaml).toContain("from: prev");
    expect(yaml).toContain("from: prev-30");
    expect(yaml).not.toContain("fromExpr"); // collapsed into `from`
    const parsed = timelineDslFromYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dsl.tracks[0].items.map((i) => i.from)).toEqual([0, 150, 210]);
    expect(parsed.dsl.tracks[0].items[1].fromExpr).toBe("prev");
    expect(parsed.dsl.tracks[0].items[2].fromExpr).toBe("prev-30");
  });

  it("emits items with stable key order (id, type, from, durationInFrames first)", () => {
    const yaml = timelineDslToYaml({
      tracks: [
        {
          id: "t",
          items: [
            // Author with deliberately scrambled key order:
            { durationInFrames: 50, id: "x", from: 0, type: "video", volume: 0.5 },
          ],
        },
      ],
    });
    // The first occurrence of each key in the output should match the
    // canonical ordering. Use indexOf as a cheap structural check.
    const idAt = yaml.indexOf("id: x");
    const typeAt = yaml.indexOf("type: video");
    const fromAt = yaml.indexOf("from: 0");
    const durAt = yaml.indexOf("durationInFrames: 50");
    expect(idAt).toBeGreaterThanOrEqual(0);
    expect(idAt).toBeLessThan(typeAt);
    expect(typeAt).toBeLessThan(fromAt);
    expect(fromAt).toBeLessThan(durAt);
  });
});

describe("timelineDslHash", () => {
  it("returns the same hash for semantically identical DSLs (key order, fromExpr)", async () => {
    const a = {
      tracks: [{ id: "t", items: [{ id: "a", type: "video", from: 30, durationInFrames: 60 }] }],
      fps: 30,
    };
    const b = {
      // Different JS key order; should not affect hash.
      fps: 30,
      tracks: [{ items: [{ durationInFrames: 60, type: "video", from: 30, id: "a" }], id: "t" }],
    };
    const c = {
      // fromExpr added — semantic from is identical, hash should match.
      tracks: [{ id: "t", items: [{ id: "a", type: "video", from: 30, durationInFrames: 60, fromExpr: "30" }] }],
      fps: 30,
    };
    const ha = await timelineDslHash(a);
    const hb = await timelineDslHash(b);
    const hc = await timelineDslHash(c);
    expect(ha).toBe(hb);
    expect(ha).toBe(hc);
  });

  it("returns a different hash when `from` actually changes", async () => {
    const a = { tracks: [{ id: "t", items: [{ id: "a", type: "video", from: 30, durationInFrames: 60 }] }] };
    const b = { tracks: [{ id: "t", items: [{ id: "a", type: "video", from: 31, durationInFrames: 60 }] }] };
    expect(await timelineDslHash(a)).not.toBe(await timelineDslHash(b));
  });

  it("hash is sensitive to item order (reordering = different hash)", async () => {
    const a = {
      tracks: [
        {
          id: "t",
          items: [
            { id: "a", type: "video", from: 0, durationInFrames: 60 },
            { id: "b", type: "video", from: 60, durationInFrames: 60 },
          ],
        },
      ],
    };
    const b = {
      tracks: [
        {
          id: "t",
          items: [
            { id: "b", type: "video", from: 60, durationInFrames: 60 },
            { id: "a", type: "video", from: 0, durationInFrames: 60 },
          ],
        },
      ],
    };
    expect(await timelineDslHash(a)).not.toBe(await timelineDslHash(b));
  });

  it("hash is sensitive to track-level field changes (locked, name)", async () => {
    const a = { tracks: [{ id: "t", name: "A", items: [] }] };
    const b = { tracks: [{ id: "t", name: "B", items: [] }] };
    expect(await timelineDslHash(a)).not.toBe(await timelineDslHash(b));
  });
});

describe("cross-track references", () => {
  it("resolves an expression that targets an item on a different track", () => {
    const yaml = `
tracks:
  - id: video
    items:
      - id: shot-A
        type: video
        from: 0
        durationInFrames: 150
  - id: captions
    items:
      - id: caption-A
        type: text
        from: shot-A-30
        durationInFrames: 60
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const caption = r.dsl.tracks[1].items[0];
    expect(caption.from).toBe(120); // 0 + 150 - 30
    expect(caption.fromExpr).toBe("shot-A-30");
  });

  it("`prev` is scoped per-track — does not look across tracks", () => {
    const yaml = `
tracks:
  - id: a
    items:
      - id: a1
        type: video
        from: 100
        durationInFrames: 50
  - id: b
    items:
      - id: b1
        type: video
        from: prev
        durationInFrames: 30
`;
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // b1 has no prev in its own track — falls back to absolute 0 + offset(0) = 0
    expect(r.dsl.tracks[1].items[0].from).toBe(0);
  });
});

describe("YAML edge cases", () => {
  it("handles empty tracks array", () => {
    const r = timelineDslFromYaml("tracks: []\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dsl.tracks).toEqual([]);
  });

  it("handles tracks with no items field", () => {
    const r = timelineDslFromYaml("tracks:\n  - id: empty\n    name: nothing\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dsl.tracks[0].items).toEqual([]);
  });

  it("rejects when root is not an object", () => {
    expect(timelineDslFromYaml("[1,2,3]").ok).toBe(false);
    expect(timelineDslFromYaml("just a string").ok).toBe(false);
    expect(timelineDslFromYaml("").ok).toBe(false);
  });

  it("rejects malformed YAML with a parse error", () => {
    const r = timelineDslFromYaml("tracks:\n  - { broken");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("YAML parse error");
  });

  it("rejects when `tracks` is missing", () => {
    const r = timelineDslFromYaml("fps: 30\ndurationInFrames: 100\n");
    expect(r.ok).toBe(false);
  });

  it("preserves track-level fields (name, locked, hidden) through round-trip", () => {
    const dsl = {
      tracks: [
        {
          id: "v",
          name: "Main video",
          locked: true,
          hidden: false, // false is dropped on serialize (no point in writing it)
          items: [{ id: "a", type: "video", from: 0, durationInFrames: 60 }],
        },
      ],
    };
    const yaml = timelineDslToYaml(dsl);
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.dsl.tracks[0];
    expect(t.name).toBe("Main video");
    expect(t.locked).toBe(true);
    expect(t.hidden).toBeUndefined();
  });

  it("preserves arbitrary item fields (volume, sourceStartInFrames, etc.) through round-trip", () => {
    const dsl = {
      tracks: [
        {
          id: "v",
          items: [
            {
              id: "a",
              type: "video",
              from: 0,
              durationInFrames: 60,
              sourceStartInFrames: 30,
              volume: 0.5,
              videoFadeIn: 10,
              videoFadeOutColor: "white",
            },
          ],
        },
      ],
    };
    const yaml = timelineDslToYaml(dsl);
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.dsl.tracks[0].items[0] as Record<string, unknown>;
    expect(item.sourceStartInFrames).toBe(30);
    expect(item.volume).toBe(0.5);
    expect(item.videoFadeIn).toBe(10);
    expect(item.videoFadeOutColor).toBe("white");
  });

  it("when `from` is a numeric YAML value it stays numeric and clears any stale fromExpr", () => {
    const dsl = {
      tracks: [
        {
          id: "t",
          items: [
            { id: "a", type: "video", from: 100, durationInFrames: 60, fromExpr: "prev+10" /* stale */ },
          ],
        },
      ],
    };
    // Round-trip: when serializing, fromExpr wins; on parse it's preserved
    // because it parses as a non-numeric reference. So the only way to
    // CLEAR a stale fromExpr is to write a numeric `from` directly.
    const yaml = "tracks:\n  - id: t\n    items:\n      - id: a\n        type: video\n        from: 100\n        durationInFrames: 60\n";
    const r = timelineDslFromYaml(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dsl.tracks[0].items[0].from).toBe(100);
    expect(r.dsl.tracks[0].items[0].fromExpr).toBeUndefined();
    void dsl;
  });
});

describe("resolveFromExpression direct API", () => {
  it("returns absolute value for `start`", () => {
    const expr = parseFromExpression("start")!;
    const out = resolveFromExpression(expr, { item: { id: "x", durationInFrames: 0 }, trackItems: [], trackIndex: 0 }, new Map());
    expect(out).toBe(0);
  });

  it("returns expr.offset when ref target is missing", () => {
    const expr = parseFromExpression("missing+42")!;
    const out = resolveFromExpression(
      expr,
      { item: { id: "self", durationInFrames: 0 }, trackItems: [], trackIndex: 0 },
      new Map(),
    );
    expect(out).toBe(42);
  });

  it("clamps to >= 0 even when offset would push it negative", () => {
    const expr = parseFromExpression("missing-100")!;
    const out = resolveFromExpression(
      expr,
      { item: { id: "self", durationInFrames: 0 }, trackItems: [], trackIndex: 0 },
      new Map(),
    );
    expect(out).toBe(0);
  });
});
