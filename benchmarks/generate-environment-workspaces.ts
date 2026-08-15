import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LoroDoc } from "loro-crdt";

import { writeWorkspaceBundleManifest } from "../packages/shared-runtime/src/workspace-bundle";
import {
  markActionAssetBindingAuthority,
  markDocumentAssetAuthority,
  markGeneratorAuthority,
  markProjectAssetAuthority,
} from "../packages/shared-types/src/index";

type Track = "functional" | "content-effect";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets: Array<{
  suite: string;
  bundle: string;
  projectId: string;
  track: Track;
}> = [
  {
    suite: "benchmarks/agent-product/v1/suite.json",
    bundle: "benchmarks/agent-product/v1/environments/base-workspace-v1",
    projectId: "benchmark-functional-base-v1",
    track: "functional",
  },
  {
    suite: "benchmarks/creative-artifacts/v2/suite.json",
    bundle: "benchmarks/creative-artifacts/v2/environments/base-workspace-v1",
    projectId: "benchmark-content-effect-base-v1",
    track: "content-effect",
  },
];

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
};

export async function generateBenchmarkEnvironmentWorkspaces(
  outputRoot = root,
): Promise<Array<{ bundle: string; bundleDigest: string }>> {
  const generated: Array<{ bundle: string; bundleDigest: string }> = [];
  for (const target of targets) {
    const suitePath = join(outputRoot, target.suite);
    if (process.argv.includes("--clear-inputs")) {
      const suite = JSON.parse(await readFile(suitePath, "utf8")) as {
        cases: Array<{
          execution?: { environment?: { initialState?: unknown } };
        }>;
      };
      for (const benchmarkCase of suite.cases) {
        if (benchmarkCase.execution?.environment) {
          delete benchmarkCase.execution.environment.initialState;
        }
      }
      await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");
      continue;
    }
    const bundleRoot = join(outputRoot, target.bundle);
    await rm(bundleRoot, { recursive: true, force: true });
    await mkdir(bundleRoot, { recursive: true });
    const doc = new LoroDoc();
    doc.setPeerId(1);
    markProjectAssetAuthority(doc);
    markActionAssetBindingAuthority(doc);
    markGeneratorAuthority(doc);
    markDocumentAssetAuthority(doc);
    doc.commit();
    const snapshot = doc.export({
      mode: "shallow-snapshot",
      frontiers: doc.oplogFrontiers(),
    });
    await writeFile(join(bundleRoot, "project.bin"), snapshot);
    const manifest = await writeWorkspaceBundleManifest(bundleRoot, {
      schemaVersion: 1,
      kind: "clash.workspace.bundle",
      source: {
        projectId: target.projectId,
        display: { name: target.projectId },
      },
      content: {
        workspaceRoot: "workspace",
        project: {
          path: "project.bin",
          codec: "loro-shallow-snapshot",
          codecVersion: 1,
        },
        resources: [],
        documentBodies: [],
        textRevisions: [],
      },
      semanticRequirements: {
        generatorDefinitions: [],
        modelReferences: [],
      },
      files: [
        {
          path: "project.bin",
          role: "project",
          bytes: snapshot.byteLength,
          sha256: await sha256(snapshot),
          mode: "0644",
        },
      ],
      excluded: [],
    });
    generated.push({
      bundle: target.bundle,
      bundleDigest: manifest.integrity.bundleDigest,
    });

    const suite = JSON.parse(await readFile(suitePath, "utf8")) as {
      cases: Array<{
        execution?: {
          preflight?: { status?: unknown };
          environment?: unknown;
        };
      }>;
    };
    for (const benchmarkCase of suite.cases) {
      if (!benchmarkCase.execution) continue;
      const ready = benchmarkCase.execution.preflight?.status !== "blocked";
      benchmarkCase.execution.environment = {
        profile: "clash-agent-environment-v1",
        track: target.track,
        ...(ready
          ? {
              initialState: {
                workspace: {
                  format: "clash-workspace-v1",
                  path: "environments/base-workspace-v1",
                  bundleDigest: manifest.integrity.bundleDigest,
                },
              },
            }
          : {}),
        outputs: {
          modifiedWorkspace: true,
          rawTrajectory: true,
          normalizedTrajectory: "clash-normalized-v1",
          atifTrajectory: "ATIF-v1.7-when-supported",
          otlpTrace: "otlp-json",
          attempt: "clash-attempt-v1",
        },
      };
    }
    await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");
  }
  return generated;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void generateBenchmarkEnvironmentWorkspaces().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
