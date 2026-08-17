import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDemoSuite } from "./contracts.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("demo recording suite contract", () => {
  it("applies suite defaults to agent and feature cases", () => {
    const suite = parseDemoSuite(
      {
        schemaVersion: 1,
        id: "clash-desktop-demos-v1",
        defaults: {
          viewport: { width: 1440, height: 900 },
          locale: "zh-CN",
          theme: "light",
          timeoutMs: 120_000,
        },
        cases: [
          {
            id: "agent-canvas-workflow-v1",
            title: "Agent builds on Canvas",
            kind: "agent",
            driver: "./cases/agent-canvas-workflow.ts",
            chapters: [
              { id: "brief", title: "Submit brief" },
              { id: "result", title: "Review result" },
            ],
          },
          {
            id: "feature-timeline-tour-v1",
            title: "Timeline feature tour",
            kind: "feature",
            driver: "./cases/feature-timeline-tour.ts",
            chapters: [{ id: "timeline", title: "Open Timeline" }],
          },
        ],
      },
      "/repo/demos/desktop/v1/suite.json",
    );

    expect(suite.cases).toEqual([
      expect.objectContaining({
        id: "agent-canvas-workflow-v1",
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
        theme: "light",
        timeoutMs: 120_000,
        driverPath:
          "/repo/demos/desktop/v1/cases/agent-canvas-workflow.ts",
      }),
      expect.objectContaining({
        id: "feature-timeline-tour-v1",
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
        theme: "light",
        timeoutMs: 120_000,
        driverPath:
          "/repo/demos/desktop/v1/cases/feature-timeline-tour.ts",
      }),
    ]);
  });

  it("rejects duplicate case ids before a recording can overwrite evidence", () => {
    expect(() =>
      parseDemoSuite(
        {
          schemaVersion: 1,
          id: "duplicate-suite",
          cases: [
            {
              id: "same-case",
              title: "One",
              kind: "feature",
              driver: "./cases/one.ts",
              chapters: [{ id: "open", title: "Open" }],
            },
            {
              id: "same-case",
              title: "Two",
              kind: "feature",
              driver: "./cases/two.ts",
              chapters: [{ id: "open", title: "Open" }],
            },
          ],
        },
        "/repo/demos/desktop/v1/suite.json",
      ),
    ).toThrow(/duplicate demo case id same-case/iu);
  });

  it("rejects drivers outside the suite directory", () => {
    expect(() =>
      parseDemoSuite(
        {
          schemaVersion: 1,
          id: "unsafe-suite",
          cases: [
            {
              id: "unsafe-case",
              title: "Unsafe",
              kind: "feature",
              driver: "../../outside.ts",
              chapters: [{ id: "open", title: "Open" }],
            },
          ],
        },
        "/repo/demos/desktop/v1/suite.json",
      ),
    ).toThrow(/driver must stay inside the suite directory/iu);
  });

  it("rejects case ids that could escape the artifact directory", () => {
    expect(() =>
      parseDemoSuite(
        {
          schemaVersion: 1,
          id: "safe-suite",
          cases: [
            {
              id: "../outside",
              title: "Unsafe",
              kind: "feature",
              driver: "./cases/feature.ts",
              chapters: [{ id: "open", title: "Open" }],
            },
          ],
        },
        "/repo/demos/desktop/v1/suite.json",
      ),
    ).toThrow(/demo case id must be a portable identifier/iu);
  });

  it("rejects a driver symlink that escapes the suite directory", async () => {
    const suiteDirectory = await mkdtemp(join(tmpdir(), "clash-demo-suite-"));
    const outsideDirectory = await mkdtemp(join(tmpdir(), "clash-demo-driver-"));
    temporaryDirectories.push(suiteDirectory, outsideDirectory);
    await mkdir(join(suiteDirectory, "cases"));
    await writeFile(join(suiteDirectory, "suite.json"), "{}\n");
    await writeFile(join(outsideDirectory, "outside.ts"), "export default {};\n");
    await symlink(
      join(outsideDirectory, "outside.ts"),
      join(suiteDirectory, "cases", "linked.ts"),
    );

    expect(() =>
      parseDemoSuite(
        {
          schemaVersion: 1,
          id: "safe-suite",
          cases: [
            {
              id: "safe-case",
              title: "Unsafe symlink",
              kind: "feature",
              driver: "./cases/linked.ts",
              chapters: [{ id: "open", title: "Open" }],
            },
          ],
        },
        join(suiteDirectory, "suite.json"),
      ),
    ).toThrow(/driver must not be a symbolic link|suite directory/iu);
  });
});
