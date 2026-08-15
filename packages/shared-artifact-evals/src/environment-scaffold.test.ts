import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureBenchmarkWorkspaceScaffold,
  removeVerifiedBenchmarkWorkspaceScaffold,
} from "./environment";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspaceScaffold() {
  const workspace = await mkdtemp(join(tmpdir(), "clash-bench-scaffold-"));
  roots.push(workspace);
  await Promise.all([
    mkdir(join(workspace, ".agents", "skills", "clash"), {
      recursive: true,
    }),
    mkdir(join(workspace, ".agents", "skills", "clash", "empty-runtime"), {
      recursive: true,
    }),
    mkdir(join(workspace, ".claude", "skills", "clash"), {
      recursive: true,
    }),
    mkdir(join(workspace, ".clash"), { recursive: true }),
    mkdir(join(workspace, "fixtures"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(workspace, "outcome.json"), "{}\n", "utf8"),
    writeFile(join(workspace, "OUTCOME.md"), "# Outcome\n", "utf8"),
    writeFile(
      join(workspace, ".agents", "skills", "clash", "SKILL.md"),
      "agent skill\n",
      "utf8",
    ),
    writeFile(
      join(workspace, ".claude", "skills", "clash", "SKILL.md"),
      "claude skill\n",
      "utf8",
    ),
    writeFile(join(workspace, "submission.json"), "keep me\n", "utf8"),
    writeFile(
      join(workspace, ".clash", "project.toml"),
      "projectId = 'fixture-project'\n",
      "utf8",
    ),
    writeFile(
      join(workspace, ".clash", "headless-host-ready.json"),
      '{"pid":123,"endpoint":"http://127.0.0.1:9999"}\n',
      "utf8",
    ),
    writeFile(
      join(workspace, ".clash", "benchmark-input-fixture.json"),
      '{"source":"runner"}\n',
      "utf8",
    ),
    writeFile(
      join(workspace, "fixtures", "agent-input.txt"),
      "fixture bytes stay\n",
      "utf8",
    ),
  ]);
  return workspace;
}

describe("runner-owned Workspace scaffold", () => {
  it("removes only exact unchanged runner scaffolding before product export", async () => {
    const workspace = await workspaceScaffold();
    const receipt = await captureBenchmarkWorkspaceScaffold({
      workspace,
      skillNames: ["clash"],
    });

    await removeVerifiedBenchmarkWorkspaceScaffold({ workspace, receipt });

    await expect(
      readFile(join(workspace, "submission.json"), "utf8"),
    ).resolves.toBe("keep me\n");
    await expect(
      readFile(join(workspace, "fixtures", "agent-input.txt"), "utf8"),
    ).resolves.toBe("fixture bytes stay\n");
    await expect(
      readFile(join(workspace, ".clash", "project.toml"), "utf8"),
    ).resolves.toContain("fixture-project");
    await expect(
      readFile(join(workspace, "outcome.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(workspace, ".agents", "skills", "clash", "SKILL.md"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(workspace, ".agents"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(workspace, ".clash", "headless-host-ready.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(workspace, ".clash", "benchmark-input-fixture.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to hide agent changes inside runner scaffolding", async () => {
    const workspace = await workspaceScaffold();
    const receipt = await captureBenchmarkWorkspaceScaffold({
      workspace,
      skillNames: ["clash"],
    });
    await writeFile(
      join(workspace, ".agents", "skills", "clash", "SKILL.md"),
      "agent changed the harness\n",
      "utf8",
    );

    await expect(
      removeVerifiedBenchmarkWorkspaceScaffold({ workspace, receipt }),
    ).rejects.toThrow(/changed.*scaffold/i);
    await expect(
      readFile(
        join(workspace, ".agents", "skills", "clash", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe("agent changed the harness\n");
  });
});
