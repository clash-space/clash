import { describe, expect, it } from "vitest";
import { DemoEventJournal } from "./events.js";

describe("demo recording event journal", () => {
  it("uses one monotonic sequence for chapters and observed agent events", () => {
    const journal = new DemoEventJournal({
      now: (() => {
        const values = [1_000, 1_120, 1_360];
        return () => values.shift() ?? 1_360;
      })(),
    });

    expect(journal.record({ source: "runner", type: "chapter.started", chapterId: "brief" })).toEqual({
      schemaVersion: 1,
      sequence: 1,
      monotonicMs: 0,
      source: "runner",
      type: "chapter.started",
      chapterId: "brief",
    });
    expect(journal.record({ source: "acp", type: "agent.tool.started", label: "Read Canvas" })).toEqual(
      expect.objectContaining({ sequence: 2, monotonicMs: 120, label: "Read Canvas" }),
    );
    expect(journal.record({ source: "acp", type: "agent.turn.completed" })).toEqual(
      expect.objectContaining({ sequence: 3, monotonicMs: 360 }),
    );
  });

  it("never admits raw tool arguments, credentials, or local paths", () => {
    const journal = new DemoEventJournal({ now: () => 5_000 });

    expect(() =>
      journal.record({
        source: "acp",
        type: "agent.tool.completed",
        label: "Generate image",
        rawInput: { apiKey: "secret", cwd: "/Users/me/project" },
      } as never),
    ).toThrow(/unsupported demo event fields: rawInput/iu);
  });

  it("redacts secrets and machine-local paths from display labels", () => {
    const journal = new DemoEventJournal({ now: () => 5_000 });

    const event = journal.record({
      source: "acp",
      type: "agent.tool.started",
      label: "Read /Users/me/project/private.txt with token=super-secret",
    });

    expect(event.label).not.toMatch(/Users|super-secret/iu);
  });

  it("admits only semantic error kinds from the recording allowlist", () => {
    const journal = new DemoEventJournal({ now: () => 5_000 });

    expect(journal.record({
      source: "acp",
      type: "agent.tool.failed",
      errorKind: "invalid_arguments",
    })).toEqual(expect.objectContaining({ errorKind: "invalid_arguments" }));
    expect(() => journal.record({
      source: "acp",
      type: "agent.tool.failed",
      errorKind: "fixture-error-secret",
    } as never)).toThrow(/unsupported demo event errorKind/iu);
  });
});
