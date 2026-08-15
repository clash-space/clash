import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { verifyWorkspaceBundleDirectory } from "@clash/shared-runtime";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";

import { generateBenchmarkEnvironmentWorkspaces } from "../../../benchmarks/generate-environment-workspaces";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const tsxLoader = createRequire(import.meta.url).resolve("tsx");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeSuite(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      id: "test-suite",
      title: "Test suite",
      cases: [
        { execution: { preflight: { status: "ready" } } },
        { execution: { preflight: { status: "blocked" } } },
      ],
    })}\n`,
    "utf8",
  );
}

describe("benchmark input Environment generator", () => {
  it("produces deterministic shallow bundles admitted by the real Workspace Host", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-environment-generator-"));
    roots.push(root);
    await Promise.all([
      writeSuite(join(root, "benchmarks/agent-product/v1/suite.json")),
      writeSuite(join(root, "benchmarks/creative-artifacts/v2/suite.json")),
    ]);

    const first = await generateBenchmarkEnvironmentWorkspaces(root);
    const second = await generateBenchmarkEnvironmentWorkspaces(root);

    expect(second).toEqual(first);
    for (const generated of second) {
      const bundleRoot = join(root, generated.bundle);
      const verified = await verifyWorkspaceBundleDirectory(bundleRoot);
      expect(verified.manifest.integrity.bundleDigest).toBe(
        generated.bundleDigest,
      );
      expect(verified.manifest.content.project.codec).toBe(
        "loro-shallow-snapshot",
      );
      expect(verified.manifest.source).not.toHaveProperty("sourceWorkspaceId");
      const imported = new LoroDoc();
      imported.import(await readFile(join(bundleRoot, "project.bin")));
      expect(imported.oplogFrontiers().length).toBeGreaterThan(0);
    }

    const hostModulePath: string = pathToFileURL(
      join(repositoryRoot, "apps/local-api/src/server.ts"),
    ).href;
    const { startLocalApiServer } = (await import(hostModulePath)) as {
      startLocalApiServer(input: {
        port: number;
        dataDir: string;
        discovery: { enabled: boolean };
      }): Promise<{
        address(): string | { port: number } | null;
        close(callback: (error?: Error) => void): void;
      }>;
    };
    const hostData = join(root, "host-data");
    const server = await startLocalApiServer({
      port: 0,
      dataDir: hostData,
      discovery: { enabled: false },
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Workspace test Host did not publish a TCP address");
      }
      const generated = second[0]!;
      const target = join(root, "imported-workspace");
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          tsxLoader,
          join(repositoryRoot, "packages/cli/src/index.ts"),
          "workspace",
          "import",
          join(root, generated.bundle),
          "--into",
          target,
          "--json",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            CLASH_API_URL: `http://127.0.0.1:${address.port}`,
            CLASH_HOME: join(root, "clash-home"),
            CLASH_LOCAL_DATA_DIR: hostData,
            CLASH_PROFILE: "dev",
            TSX_TSCONFIG_PATH: join(
              repositoryRoot,
              "packages/cli/tsconfig.dev.json",
            ),
          },
          timeout: 60_000,
        },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        projectId: "benchmark-functional-base-v1",
        bundleDigest: generated.bundleDigest,
        targetPath: target,
      });
      await expect(
        readFile(join(target, ".clash", "project.toml"), "utf8"),
      ).resolves.toContain("benchmark-functional-base-v1");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  }, 90_000);
});
