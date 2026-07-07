import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSecondaryCanvasRecovery, doctorCommand, inspectStorageContract, runStorageDoctor } from "./doctor";
import { buildProjectStatus, initProject } from "./projects";

const require = createRequire(import.meta.url);

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-storage-doctor-"));
}

function openSqlite(path: string) {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      close(): void;
    };
  };
  return new DatabaseSync(path);
}

function checkById(report: Awaited<ReturnType<typeof runStorageDoctor>>, id: string) {
  const check = report.checks.find((item) => item.id === id);
  assert.ok(check, `missing doctor check: ${id}`);
  return check;
}

test("storage doctor reports marker project with non-fatal missing-store warnings", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, true);
  assert.equal(report.projectId, "doctor_project");
  assert.equal(checkById(report, "project-context").level, "ok");
  assert.equal(checkById(report, "project-marker").level, "ok");
  assert.equal(checkById(report, "editable-protected-separation").level, "ok");
  assert.equal(checkById(report, "cwd-protected").level, "ok");
  assert.equal(checkById(report, "project-workspace").level, "warning");
  assert.equal(checkById(report, "editable-drafts-root").level, "warning");
  assert.equal(checkById(report, "editable-projections-root").level, "warning");
  assert.equal(checkById(report, "editable-sessions-root").level, "warning");
  assert.equal(checkById(report, "editable-asset-links-root").level, "warning");
  assert.equal(checkById(report, "protected-runtime-root").level, "warning");
  assert.equal(checkById(report, "loro-replica").level, "warning");
  assert.equal(checkById(report, "local-sqlite").level, "warning");
  assert.equal(checkById(report, "legacy-db-json").level, "ok");
});

test("storage doctor reports v1 project workspace roots when they exist", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const projectRoot = join(homeDir, ".clash", "projects", "doctor_project");
  await Promise.all([
    mkdir(join(projectRoot, "drafts"), { recursive: true }),
    mkdir(join(projectRoot, "projections", "text"), { recursive: true }),
    mkdir(join(projectRoot, "projections", "timelines"), { recursive: true }),
    mkdir(join(projectRoot, "sessions"), { recursive: true }),
    mkdir(join(projectRoot, "assets", "links"), { recursive: true }),
    mkdir(join(projectRoot, "runtime"), { recursive: true }),
  ]);

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, true);
  assert.equal(checkById(report, "project-workspace").level, "ok");
  assert.equal(checkById(report, "editable-drafts-root").level, "ok");
  assert.equal(checkById(report, "editable-projections-root").level, "ok");
  assert.equal(checkById(report, "editable-sessions-root").level, "ok");
  assert.equal(checkById(report, "editable-asset-links-root").level, "ok");
  assert.equal(checkById(report, "protected-runtime-root").level, "ok");
});

test("storage doctor fails on broken project asset links", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const projectRoot = join(homeDir, ".clash", "projects", "doctor_project");
  const assetLinksRoot = join(projectRoot, "assets", "links");
  await Promise.all([
    mkdir(join(projectRoot, "drafts"), { recursive: true }),
    mkdir(join(projectRoot, "projections"), { recursive: true }),
    mkdir(join(projectRoot, "sessions"), { recursive: true }),
    mkdir(assetLinksRoot, { recursive: true }),
    mkdir(join(projectRoot, "runtime"), { recursive: true }),
  ]);
  await symlink(
    join(homeDir, ".clash", "assets", "missing.png"),
    join(assetLinksRoot, "missing.png"),
  );

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, false);
  const linksCheck = checkById(report, "asset-link-integrity");
  assert.equal(linksCheck.level, "error");
  assert.match(linksCheck.message, /broken symlink/);
  assert.match(linksCheck.message, /missing\.png/);
});

test("storage doctor fails when cwd is inside protected Clash storage", async () => {
  const homeDir = await tempDir();
  const protectedCwd = join(homeDir, ".clash", "local-api");
  await mkdir(protectedCwd, { recursive: true });

  const report = await runStorageDoctor({
    cwd: protectedCwd,
    project: "doctor_project",
    env: {},
    homeDir,
  });

  assert.equal(report.ok, false);
  const cwdCheck = checkById(report, "cwd-protected");
  assert.equal(cwdCheck.level, "error");
  assert.equal(cwdCheck.path, protectedCwd);
});

test("storage doctor fails when cwd owns a second canvas replica", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  await mkdir(join(cwd, "loro"), { recursive: true });
  await writeFile(join(cwd, "loro", "snapshot.bin"), "draft snapshot", "utf8");
  await writeFile(join(cwd, "loro", "updates.log"), "draft updates", "utf8");

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, false);
  const replicaCheck = checkById(report, "secondary-canvas-replica");
  assert.equal(replicaCheck.level, "error");
  assert.match(replicaCheck.message, /second canvas replica/i);
  assert.match(replicaCheck.message, /snapshot\.bin/);
  assert.equal(replicaCheck.path, join(cwd, "loro", "snapshot.bin"));
});

test("storage doctor accepts canonical local-api Loro replica files", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const projectId = "doctor_project";
  await initProject({ cwd, projectId });
  const canonicalReplicaRoot = join(
    homeDir,
    ".clash",
    "local-api",
    "projects",
    encodeURIComponent(projectId),
    "loro",
  );
  await mkdir(canonicalReplicaRoot, { recursive: true });
  await writeFile(join(canonicalReplicaRoot, "snapshot.bin"), "canonical snapshot", "utf8");
  await writeFile(join(canonicalReplicaRoot, "updates.log"), "canonical updates", "utf8");

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, true);
  assert.equal(checkById(report, "secondary-canvas-replica").level, "ok");
  assert.equal(checkById(report, "loro-replica").level, "ok");
});

test("storage doctor repair quarantines cwd secondary canvas replica files", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const snapshotPath = join(cwd, "loro", "snapshot.bin");
  const updatesPath = join(cwd, "loro", "updates.log");
  await mkdir(join(cwd, "loro"), { recursive: true });
  await writeFile(snapshotPath, "draft snapshot", "utf8");
  await writeFile(updatesPath, "draft updates", "utf8");

  const repaired = await runStorageDoctor({ cwd, env: {}, homeDir, repair: true });

  assert.equal(repaired.ok, true);
  assert.equal(checkById(repaired, "secondary-canvas-replica").level, "ok");
  const quarantined = repaired.repairs?.filter((repair) => repair.id === "secondary-canvas-replica-quarantine") ?? [];
  assert.equal(quarantined.length, 2);
  assert.ok(quarantined.every((repair) => repair.path?.includes(join("runtime", "recovery", "secondary-canvas-replicas"))));
  await assert.rejects(readFile(snapshotPath, "utf8"), /ENOENT/);
  await assert.rejects(readFile(updatesPath, "utf8"), /ENOENT/);
  assert.equal(await readFile(quarantined.find((repair) => repair.path?.endsWith("snapshot.bin"))?.path ?? "", "utf8"), "draft snapshot");
  assert.equal(await readFile(quarantined.find((repair) => repair.path?.endsWith("updates.log"))?.path ?? "", "utf8"), "draft updates");

  const manifestPath = join(quarantined[0].path ? join(quarantined[0].path, "..", "..") : "", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    schemaVersion: number;
    projectId: string;
    canonicalReplica: { snapshotPath: string; updatesLogPath: string };
    files: Array<{ sourcePath: string; destinationPath: string; kind: string }>;
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.projectId, "doctor_project");
  assert.match(manifest.canonicalReplica.snapshotPath, /local-api\/projects\/doctor_project\/loro\/snapshot\.bin$/);
  assert.deepEqual(
    manifest.files.map((file) => ({
      sourcePath: file.sourcePath,
      kind: file.kind,
      basename: file.destinationPath.endsWith("snapshot.bin") ? "snapshot.bin" : "updates.log",
    })).sort((a, b) => a.basename.localeCompare(b.basename)),
    [
      { sourcePath: snapshotPath, kind: "snapshot", basename: "snapshot.bin" },
      { sourcePath: updatesPath, kind: "updates-log", basename: "updates.log" },
    ].sort((a, b) => a.basename.localeCompare(b.basename)),
  );

  const verified = await runStorageDoctor({ cwd, env: {}, homeDir });
  assert.equal(verified.ok, true);
  assert.equal(checkById(verified, "secondary-canvas-replica").level, "ok");
  const recovery = checkById(verified, "secondary-canvas-recovery");
  assert.equal(recovery.level, "warning");
  assert.equal(recovery.path, manifestPath);
  assert.match(recovery.message, /1 quarantined canvas replica recovery set/);
});

test("secondary canvas recovery compare reports canonical and quarantined file hashes without importing", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const status = buildProjectStatus(
    { projectId: "doctor_project", source: "marker", markerPath: join(cwd, ".clash", "project.toml") },
    { homeDir },
  );
  await mkdir(status.loro.replicaRoot, { recursive: true });
  await writeFile(status.loro.snapshotPath, "canonical snapshot", "utf8");
  await writeFile(status.loro.updatesLogPath, "canonical updates", "utf8");
  const snapshotPath = join(cwd, "loro", "snapshot.bin");
  const updatesPath = join(cwd, "loro", "updates.log");
  await mkdir(join(cwd, "loro"), { recursive: true });
  await writeFile(snapshotPath, "draft snapshot", "utf8");
  await writeFile(updatesPath, "draft updates", "utf8");

  const repaired = await runStorageDoctor({ cwd, env: {}, homeDir, repair: true });
  const quarantined = repaired.repairs?.filter((repair) => repair.id === "secondary-canvas-replica-quarantine") ?? [];
  const manifestPath = join(quarantined[0].path ? join(quarantined[0].path, "..", "..") : "", "manifest.json");

  const compared = await compareSecondaryCanvasRecovery({ manifestPath });

  assert.equal(compared.schemaVersion, 1);
  assert.equal(compared.status, "compared");
  assert.equal(compared.projectId, "doctor_project");
  assert.equal(compared.safeToImportAutomatically, false);
  assert.equal(compared.files.length, 2);
  const snapshot = compared.files.find((file) => file.kind === "snapshot");
  assert.ok(snapshot);
  assert.equal(snapshot.sourcePath, snapshotPath);
  assert.equal(snapshot.canonical.path, status.loro.snapshotPath);
  assert.equal(snapshot.quarantined.exists, true);
  assert.equal(snapshot.canonical.exists, true);
  assert.equal(snapshot.quarantined.size, "draft snapshot".length);
  assert.equal(snapshot.canonical.size, "canonical snapshot".length);
  assert.notEqual(snapshot.quarantined.sha256, snapshot.canonical.sha256);
  assert.equal(snapshot.sameBytes, false);
});

test("storage doctor validates the project status storage role contract", () => {
  const status = buildProjectStatus(
    { projectId: "doctor_project", source: "explicit" },
    { homeDir: "/tmp/clash-home" },
  );

  const checks = inspectStorageContract(status);

  assert.deepEqual(checks, [
    {
      id: "storage-role-contract",
      level: "ok",
      message: "Project storage contract separates agent workspace from protected canonical replica.",
    },
  ]);
});

test("storage doctor fails when storage roles make canonical state agent-writable", () => {
  const status = buildProjectStatus(
    { projectId: "doctor_project", source: "explicit" },
    { homeDir: "/tmp/clash-home" },
  );
  const corrupted = {
    ...status,
    storage: {
      ...status.storage,
      workspace: {
        ...status.storage.workspace,
        ownsCanonicalSnapshot: true,
        editablePaths: [
          ...status.storage.workspace.editablePaths,
          status.loro.snapshotPath,
        ],
      },
      canonicalReplica: {
        ...status.storage.canonicalReplica,
        metadata: {
          ...status.storage.canonicalReplica.metadata,
          agentWritable: true,
        },
      },
    },
  };

  const checks = inspectStorageContract(corrupted as any);

  const contract = checkById({ checks } as Awaited<ReturnType<typeof runStorageDoctor>>, "storage-role-contract");
  assert.equal(contract.level, "error");
  assert.match(contract.message, /owns canonical snapshot/);
  assert.match(contract.message, /canonical metadata is agent-writable/);
  assert.match(contract.message, /editable workspace includes canonical canvas path/);
});

test("storage doctor warns when legacy db.json exists", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const localApiDir = join(homeDir, ".clash", "local-api");
  await mkdir(localApiDir, { recursive: true });
  await writeFile(join(localApiDir, "db.json"), "{}\n", "utf8");

  const report = await runStorageDoctor({
    cwd,
    project: "doctor_project",
    env: {},
    homeDir,
  });

  assert.equal(report.ok, true);
  const dbJsonCheck = checkById(report, "legacy-db-json");
  assert.equal(dbJsonCheck.level, "warning");
  assert.match(dbJsonCheck.message, /Legacy db\.json exists but is ignored/);
});

test("storage doctor warns when local SQLite lacks the asset reference index schema", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const localApiDir = join(homeDir, ".clash", "local-api");
  await mkdir(localApiDir, { recursive: true });
  const sqlite = openSqlite(join(localApiDir, "local.sqlite"));
  try {
    sqlite.exec(`
      CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE asset_refs (
        asset_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY (asset_id, project_id)
      );
    `);
  } finally {
    sqlite.close();
  }

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  assert.equal(report.ok, true);
  const schemaCheck = checkById(report, "local-sqlite-schema");
  assert.equal(schemaCheck.level, "warning");
  assert.match(schemaCheck.message, /asset_node_refs/);
  assert.match(schemaCheck.message, /reference_role/);
});

test("storage doctor repair creates workspace roots and fixes local SQLite asset reference schema", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const localApiDir = join(homeDir, ".clash", "local-api");
  await mkdir(localApiDir, { recursive: true });
  const sqlite = openSqlite(join(localApiDir, "local.sqlite"));
  try {
    sqlite.exec(`
      CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE asset_refs (
        asset_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY (asset_id, project_id)
      );
    `);
  } finally {
    sqlite.close();
  }

  const repaired = await runStorageDoctor({ cwd, env: {}, homeDir, repair: true });

  assert.equal(repaired.ok, true);
  assert.equal(repaired.repaired, true);
  assert.ok(repaired.repairs?.some((repair) => repair.id === "project-workspace"));
  assert.ok(repaired.repairs?.some((repair) => repair.id === "local-sqlite-schema"));
  assert.equal(checkById(repaired, "project-workspace").level, "ok");
  assert.equal(checkById(repaired, "editable-drafts-root").level, "ok");
  assert.equal(checkById(repaired, "editable-projections-root").level, "ok");
  assert.equal(checkById(repaired, "editable-sessions-root").level, "ok");
  assert.equal(checkById(repaired, "editable-asset-links-root").level, "ok");
  assert.equal(checkById(repaired, "protected-runtime-root").level, "ok");
  assert.equal(checkById(repaired, "local-sqlite").level, "ok");
  assert.equal(checkById(repaired, "local-sqlite-schema").level, "ok");

  const verified = await runStorageDoctor({ cwd, env: {}, homeDir });
  assert.equal(checkById(verified, "local-sqlite-schema").level, "ok");
});

test("storage doctor accepts the local SQLite asset reference index schema", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "doctor_project" });
  const localApiDir = join(homeDir, ".clash", "local-api");
  await mkdir(localApiDir, { recursive: true });
  const sqlite = openSqlite(join(localApiDir, "local.sqlite"));
  try {
    sqlite.exec(`
      CREATE TABLE asset_node_refs (
        asset_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        field_path TEXT NOT NULL,
        reference_role TEXT NOT NULL DEFAULT 'asset',
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, node_id, field_path, asset_id)
      );
      CREATE INDEX asset_node_refs_asset_idx ON asset_node_refs(asset_id, project_id);
      CREATE INDEX asset_node_refs_project_idx ON asset_node_refs(project_id, node_id);
    `);
  } finally {
    sqlite.close();
  }

  const report = await runStorageDoctor({ cwd, env: {}, homeDir });

  const schemaCheck = checkById(report, "local-sqlite-schema");
  assert.equal(schemaCheck.level, "ok");
  assert.match(schemaCheck.message, /supports asset reference indexing/);
});

test("doctor command is registered with storage subcommand", async () => {
  assert.equal(doctorCommand.name(), "doctor");
  assert.deepEqual(doctorCommand.commands.map((command) => command.name()), ["storage", "storage-recovery"]);
  assert.deepEqual(
    doctorCommand.commands.find((command) => command.name() === "storage-recovery")?.commands.map((command) => command.name()),
    ["compare"],
  );

  const indexSource = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /import \{ doctorCommand \} from "\.\/commands\/doctor"/);
  assert.match(indexSource, /program\.addCommand\(doctorCommand\)/);
});
