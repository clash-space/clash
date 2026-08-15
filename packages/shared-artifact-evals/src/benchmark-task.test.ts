import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeBenchmarkTaskManifest } from "./benchmark-task";
import { renderOutcomeMarkdown } from "./outcome";
import { loadBenchmarkSuite } from "./suite";
import type { ArtifactBenchmarkCase, BenchmarkEnvironmentTrack } from "./types";

const INPUT_WORKSPACE_DIGEST =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function benchmarkCase(
  track: BenchmarkEnvironmentTrack,
): ArtifactBenchmarkCase {
  const functional = track === "functional";
  return {
    id: functional ? "asset-import-v1" : "premium-product-frame-v1",
    title: functional
      ? "Import one exact image Asset"
      : "Create a premium product hero frame",
    category: functional ? "asset" : "director",
    tags: functional
      ? ["agent-product", "asset"]
      : ["content-effect", "product"],
    outcome: {
      objective: functional
        ? "Import the fixture through Clash and preserve its exact bytes."
        : "Create a polished premium product hero frame.",
      acceptanceCriteria: functional
        ? ["The submitted image matches the imported Project Asset bytes."]
        : ["The submitted image is a valid 1280 by 720 frame."],
      deliverables: [
        {
          artifactId: functional ? "imported-image" : "hero-frame",
          kind: "image",
          description: functional
            ? "Exact imported image bytes"
            : "Rendered product hero frame",
        },
      ],
    },
    ...(functional
      ? {}
      : {
          qualityCriteria: [
            {
              id: "premium-focus",
              description:
                "The product remains the unambiguous premium focal point.",
              weight: 1,
              evidenceArtifactIds: ["hero-frame"],
            },
          ],
        }),
    passScore: functional ? 100 : 80,
    timeoutMs: 120_000,
    skills: ["../../../plugins/clash/skills/clash"],
    execution: {
      profile: "clash-host",
      lane: "agent-product",
      requiredProductOperations: [
        functional ? "asset.import" : "director.capture",
      ],
      environment: {
        profile: "clash-agent-environment-v1",
        track,
        initialState: {
          workspace: {
            format: "clash-workspace-v1",
            path: "environments/base-workspace-v1",
            bundleDigest: INPUT_WORKSPACE_DIGEST,
          },
        },
        outputs: {
          modifiedWorkspace: true,
          rawTrajectory: true,
          normalizedTrajectory: "clash-normalized-v1",
          atifTrajectory: "ATIF-v1.7-when-supported",
          otlpTrace: "otlp-json",
          attempt: "clash-attempt-v1",
        },
      },
    },
    rubric: [
      {
        id: "image-exists",
        type: "artifact-exists",
        artifactId: functional ? "imported-image" : "hero-frame",
        kind: "image",
        minBytes: 1,
        weight: 1,
        required: true,
      },
    ],
  };
}

async function freshCaseRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-benchmark-task-"));
}

describe("benchmark task manifest", () => {
  it("atomically preserves the exact strict functional case as deterministic task evidence", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = benchmarkCase("functional");

    const evidence = await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: "clash-agent-product-v1",
      track: "functional",
      benchmark,
    });

    const taskPath = join(caseRoot, "task.json");
    const bytes = await readFile(taskPath);
    const task = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    const info = await stat(taskPath);
    const canonicalBenchmark = {
      ...benchmark,
      execution: { ...benchmark.execution!, transport: "auto" },
    };
    expect(evidence).toEqual({
      path: "task.json",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(task).toEqual({
      schemaVersion: 1,
      kind: "clash.benchmark.task",
      suiteId: "clash-agent-product-v1",
      track: "functional",
      benchmark: canonicalBenchmark,
    });
    expect(bytes.toString("utf8")).toMatch(/\n$/u);
    expect(bytes.toString("utf8")).not.toContain(caseRoot);
    expect(Object.keys(task)).toEqual([
      "benchmark",
      "kind",
      "schemaVersion",
      "suiteId",
      "track",
    ]);
    expect(info.isFile()).toBe(true);
    expect(info.nlink).toBe(1);
  });

  it("writes omitted transport and explicit auto as the same canonical task", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = benchmarkCase("functional");
    const omitted = await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: "clash-agent-product-v1",
      track: "functional",
      benchmark,
    });
    const before = await stat(join(caseRoot, "task.json"), { bigint: true });

    const explicit = await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: "clash-agent-product-v1",
      track: "functional",
      benchmark: {
        ...benchmark,
        execution: { ...benchmark.execution!, transport: "auto" },
      },
    });
    const after = await stat(join(caseRoot, "task.json"), { bigint: true });
    const task = JSON.parse(
      await readFile(join(caseRoot, "task.json"), "utf8"),
    ) as { benchmark: ArtifactBenchmarkCase };

    expect(explicit).toEqual(omitted);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(task.benchmark.execution?.transport).toBe("auto");
  });

  it("continues to reject schema normalization outside the transport default", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = benchmarkCase("functional");
    benchmark.execution!.environment = {
      profile: "clash-workspace-v1",
      track: "functional",
      inputWorkspace: {
        path: "environments/base-workspace-v1",
        bundleDigest: INPUT_WORKSPACE_DIGEST,
      },
      outputs: {
        modifiedWorkspace: true,
        rawTrajectory: true,
        normalizedTrajectory: "clash-normalized-v1",
        atifTrajectory: "ATIF-v1.7-when-supported",
        otlpTrace: "otlp-json",
        attempt: "clash-attempt-v1",
      },
    };

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "functional",
        benchmark,
      }),
    ).rejects.toThrow(/exact canonical JSON/iu);
  });

  it("retains content-effect quality criteria in the exact benchmark case", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = benchmarkCase("content-effect");

    await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: "clash-creative-artifacts-v2",
      track: "content-effect",
      benchmark,
    });

    const task = JSON.parse(
      await readFile(join(caseRoot, "task.json"), "utf8"),
    ) as {
      track: string;
      benchmark: ArtifactBenchmarkCase;
    };
    expect(task.track).toBe("content-effect");
    expect(task.benchmark.qualityCriteria).toEqual([
      {
        id: "premium-focus",
        description: "The product remains the unambiguous premium focal point.",
        weight: 1,
        evidenceArtifactIds: ["hero-frame"],
      },
    ]);
    expect(task.benchmark.outcome.acceptanceCriteria).toEqual([
      "The submitted image is a valid 1280 by 720 frame.",
    ]);
    expect(task.benchmark.execution?.environment?.track).toBe("content-effect");
  });

  it("exposes the medium mixed functional minima and final-revision lineage in task.json", async () => {
    const suiteUrl = new URL(
      "../../../benchmarks/creative-artifacts/v2/suite.json",
      import.meta.url,
    );
    const suite = await loadBenchmarkSuite(suiteUrl.pathname);
    const benchmark = suite.cases.find(
      (candidate) => candidate.id === "mixed-premium-gadget-mini-review-v2",
    );
    expect(benchmark).toBeDefined();
    const caseRoot = await freshCaseRoot();

    await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: suite.id,
      track: "content-effect",
      benchmark: benchmark!,
    });

    const task = JSON.parse(
      await readFile(join(caseRoot, "task.json"), "utf8"),
    ) as { benchmark: ArtifactBenchmarkCase };
    const publicContract = task.benchmark.outcome.acceptanceCriteria.join("\n");
    expect(publicContract).toMatch(
      /at least four objects.*two cameras.*three ordered sequence shots.*one animated track/isu,
    );
    expect(publicContract).not.toMatch(/captured shots/iu);
    expect(publicContract).toMatch(
      /at least three tracks.*five items.*270 frames.*image.*composition.*text/isu,
    );
    expect(publicContract).toMatch(
      /capture receipt.*projectAssetId.*final Stage revision.*canonical Timeline media item.*same projectAssetId.*Stage.*not mutated.*own Action output/isu,
    );
  });

  it("renders every evaluator-required MG body part as its canonical TSX marker in the agent prompt", async () => {
    const suiteUrl = new URL(
      "../../../benchmarks/agent-product/v1/suite.json",
      import.meta.url,
    );
    const suite = await loadBenchmarkSuite(suiteUrl.pathname);
    const benchmark = suite.cases.find(
      (candidate) => candidate.id === "mixed-director-remotion-timeline-v1",
    );
    expect(benchmark).toBeDefined();
    const caseRoot = await freshCaseRoot();

    await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: suite.id,
      track: "functional",
      benchmark: benchmark!,
    });

    const task = JSON.parse(
      await readFile(join(caseRoot, "task.json"), "utf8"),
    ) as { benchmark: ArtifactBenchmarkCase };
    const prompt = renderOutcomeMarkdown(task.benchmark);
    expect(prompt).toContain(
      'Required character-part markers: `data-character-part="head"`, `data-character-part="torso"`, `data-character-part="arm-left"`, `data-character-part="arm-right"`, `data-character-part="leg-left"`, `data-character-part="leg-right"`.',
    );
  });

  it("requires a real post-create Timeline revision through get and save in the agent prompt", async () => {
    const suiteUrl = new URL(
      "../../../benchmarks/agent-product/v1/suite.json",
      import.meta.url,
    );
    const suite = await loadBenchmarkSuite(suiteUrl.pathname);
    const benchmark = suite.cases.find(
      (candidate) => candidate.id === "mixed-director-remotion-timeline-v1",
    );
    expect(benchmark).toBeDefined();
    const caseRoot = await freshCaseRoot();

    await writeBenchmarkTaskManifest({
      caseRoot,
      suiteId: suite.id,
      track: "functional",
      benchmark: benchmark!,
    });

    const task = JSON.parse(
      await readFile(join(caseRoot, "task.json"), "utf8"),
    ) as { benchmark: ArtifactBenchmarkCase };
    const prompt = renderOutcomeMarkdown(task.benchmark);
    expect(prompt).toMatch(
      /after creating the Timeline.*timeline\.get.*real subsequent edit.*closing title.*timeline\.save.*not.*no-op/isu,
    );
  });

  it("rejects an unsafe suite id before creating task.json", async () => {
    const caseRoot = await freshCaseRoot();

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "../private-suite",
        track: "functional",
        benchmark: benchmarkCase("functional"),
      }),
    ).rejects.toThrow(/suite id.*safe/iu);
    await expect(lstat(join(caseRoot, "task.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a case that is not accepted by the strict ArtifactBenchmarkCase schema", async () => {
    const caseRoot = await freshCaseRoot();
    const invalid = {
      ...benchmarkCase("functional"),
      runnerPrivatePath: "/tmp/clash-runner",
    };

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "functional",
        benchmark: invalid as ArtifactBenchmarkCase,
      }),
    ).rejects.toThrow(/benchmark case/iu);
    await expect(lstat(join(caseRoot, "task.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects noncanonical JSON values instead of silently dropping them", async () => {
    const caseRoot = await freshCaseRoot();
    const noncanonical = {
      ...benchmarkCase("functional"),
      prompt: undefined,
    };

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "functional",
        benchmark: noncanonical,
      }),
    ).rejects.toThrow(/canonical JSON/iu);
  });

  it("rejects a track that disagrees with the case Environment", async () => {
    const caseRoot = await freshCaseRoot();

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "content-effect",
        benchmark: benchmarkCase("functional"),
      }),
    ).rejects.toThrow(/track.*Environment/iu);
  });

  it("rejects an absolute runtime skill path", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = {
      ...benchmarkCase("functional"),
      skills: ["/Users/alice/.codex/skills/private-skill"],
    };

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "functional",
        benchmark,
      }),
    ).rejects.toThrow(/absolute runtime paths/iu);
  });

  it("rejects credential-shaped values anywhere in the public task", async () => {
    const caseRoot = await freshCaseRoot();
    const benchmark = {
      ...benchmarkCase("functional"),
      prompt:
        "Use clsh_0123456789abcdef0123456789abcdef01234567 to access Clash.",
    };

    await expect(
      writeBenchmarkTaskManifest({
        caseRoot,
        suiteId: "clash-agent-product-v1",
        track: "functional",
        benchmark,
      }),
    ).rejects.toThrow(/credentials/iu);
  });

  it("is exactly idempotent without replacing the existing task inode", async () => {
    const caseRoot = await freshCaseRoot();
    const input = {
      caseRoot,
      suiteId: "clash-agent-product-v1",
      track: "functional" as const,
      benchmark: benchmarkCase("functional"),
    };
    const first = await writeBenchmarkTaskManifest(input);
    const before = await stat(join(caseRoot, "task.json"), { bigint: true });

    const replay = await writeBenchmarkTaskManifest(input);
    const after = await stat(join(caseRoot, "task.json"), { bigint: true });

    expect(replay).toEqual(first);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.nlink).toBe(1n);
  });

  it("rejects a mutated task without overwriting the mutation", async () => {
    const caseRoot = await freshCaseRoot();
    const taskPath = join(caseRoot, "task.json");
    const input = {
      caseRoot,
      suiteId: "clash-agent-product-v1",
      track: "functional" as const,
      benchmark: benchmarkCase("functional"),
    };
    await writeBenchmarkTaskManifest(input);
    await writeFile(taskPath, "mutated task\n", {
      encoding: "utf8",
      flag: "w",
    });

    await expect(writeBenchmarkTaskManifest(input)).rejects.toThrow(
      /conflicts/iu,
    );
    expect(await readFile(taskPath, "utf8")).toBe("mutated task\n");
  });

  it("rejects existing symlinked and hard-linked task targets", async () => {
    const benchmark = benchmarkCase("functional");
    for (const kind of ["symbolic", "hard"] as const) {
      const caseRoot = await freshCaseRoot();
      const external = join(caseRoot, "external.json");
      const taskPath = join(caseRoot, "task.json");
      await writeFile(external, "external\n", "utf8");
      if (kind === "symbolic") {
        await symlink(external, taskPath);
      } else {
        await link(external, taskPath);
      }

      await expect(
        writeBenchmarkTaskManifest({
          caseRoot,
          suiteId: "clash-agent-product-v1",
          track: "functional",
          benchmark,
        }),
      ).rejects.toThrow(/regular unlinked file/iu);
      expect(await readFile(external, "utf8")).toBe("external\n");
    }
  });
});
