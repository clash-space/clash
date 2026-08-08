import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { prepareBenchmarkWorkspaceBinding } from "./runner";

describe("benchmark Clash workspace setup", () => {
  it("reuses an existing project through idempotent Clash init without overwriting its marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-existing-binding-"));
    const workspace = join(root, "workspace");
    const caseRoot = join(root, "case");
    const logsRoot = join(caseRoot, "logs");
    const cliPath = join(root, "clash-cli.cjs");
    const tracePath = join(root, "init-argv.json");
    const markerPath = join(workspace, ".clash", "project.toml");
    const marker = [
      "schema_version = 1",
      'project_id = "existing-project"',
      'workspace_id = "external:existing"',
      'store = "external"',
      "",
    ].join("\n");
    await Promise.all([
      mkdir(join(workspace, ".clash"), { recursive: true }),
      mkdir(logsRoot, { recursive: true }),
    ]);
    await writeFile(markerPath, marker, "utf8");
    await writeFile(
      cliPath,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const argv = process.argv.slice(2)',
        'fs.writeFileSync(process.env.TEST_INIT_TRACE, JSON.stringify(argv))',
        'if (argv.join(" ") !== "init --json") process.exit(41)',
        'const markerPath = path.join(process.cwd(), ".clash", "project.toml")',
        'const source = fs.readFileSync(markerPath, "utf8")',
        'const projectId = /project_id\\s*=\\s*"([^"]+)"/.exec(source)?.[1]',
        'const workspaceId = /workspace_id\\s*=\\s*"([^"]+)"/.exec(source)?.[1]',
        'process.stdout.write(JSON.stringify({projectId,markerPath,workspaceId,reused:true}) + "\\n")',
      ].join("\n"),
      "utf8",
    );
    await chmod(cliPath, 0o755);

    const binding = await prepareBenchmarkWorkspaceBinding({
      cliPath,
      workspace,
      caseRoot,
      logsRoot,
      generatedProjectId: "headless_eval_must_not_replace",
      environment: {
        ...process.env,
        TEST_INIT_TRACE: tracePath,
      },
    });

    expect(binding).toMatchObject({
      projectId: "existing-project",
      initDisposition: "reused",
      markerPath,
    });
    await expect(readFile(markerPath, "utf8")).resolves.toBe(marker);
    await expect(readFile(tracePath, "utf8")).resolves.toBe(
      JSON.stringify(["init", "--json"]),
    );
    await expect(
      readFile(join(caseRoot, "clash-workspace-init.json"), "utf8"),
    ).resolves.toContain('"initDisposition": "reused"');
  });
});
