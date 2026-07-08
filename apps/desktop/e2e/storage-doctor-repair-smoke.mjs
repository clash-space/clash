import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const runId = process.env.CLASH_STORAGE_DOCTOR_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve(
  process.env.CLASH_STORAGE_DOCTOR_ARTIFACT_ROOT ||
    path.join(repoRoot, ".tmp", "storage-doctor-repair", runId),
);
const workspace = path.join(artifactRoot, "workspace");
const clashHome = path.join(artifactRoot, "clash-home");
const reportPath = path.join(artifactRoot, "storage-doctor-repair-report.json");
const cliEntry = path.join(repoRoot, "packages", "cli", "src", "index.ts");
const require = createRequire(path.join(repoRoot, "packages", "cli", "package.json"));
const tsxLoader = require.resolve("tsx");
const checks = [];

function now() {
  return new Date().toISOString();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function recordCheck(name, pass, evidence, extra = {}) {
  checks.push({
    name,
    status: pass ? "pass" : "fail",
    observedAt: now(),
    evidence,
    ...extra,
  });
  if (!pass) {
    throw new Error(`${name}: ${evidence}`);
  }
}

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CLASH_HOME: clashHome,
      },
    },
  );
  return {
    command: `clash ${args.join(" ")}`,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseStdoutJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${result.command}: ${error instanceof Error ? error.message : String(error)}\n${result.stdout}\n${result.stderr}`);
  }
}

function checkById(report, id) {
  return report.checks?.find((check) => check.id === id);
}

async function pathIsDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function pathIsFile(targetPath) {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

function isInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function textRevisionBlobPath(content) {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return path.join(clashHome, "local-api", "text-revision-blobs", hash.slice(0, 2), `${hash}.md`);
}

function sqliteObjectsExist(sqlitePath, objects) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(sqlitePath);
  try {
    return objects.every((object) => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get(object.type, object.name);
      return row?.name === object.name;
    });
  } finally {
    db.close();
  }
}

function sqlitePrimaryKeyMatches(sqlitePath, table, expectedColumns) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(sqlitePath);
  try {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all()
      .map((row) => ({
        name: typeof row.name === "string" ? row.name : "",
        pk: typeof row.pk === "number" ? row.pk : 0,
      }))
      .filter((row) => row.name && row.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((row) => row.name);
    return actual.length === expectedColumns.length &&
      actual.every((column, index) => column === expectedColumns[index]);
  } finally {
    db.close();
  }
}

function rewriteProviderAuthTablesWithLegacyPrimaryKeys(sqlitePath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(`
      DROP TABLE IF EXISTS provider_accounts;
      DROP TABLE IF EXISTS provider_oauth;

      CREATE TABLE provider_accounts (
        user_id TEXT NOT NULL,
        account_key TEXT NOT NULL,
        id TEXT,
        provider_id TEXT NOT NULL,
        upstream_id TEXT,
        region TEXT,
        label TEXT,
        enabled INTEGER NOT NULL,
        priority REAL,
        weight REAL,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (user_id, provider_id)
      );

      CREATE TABLE provider_oauth (
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        token_type TEXT,
        verification_uri TEXT,
        user_code TEXT,
        device_code TEXT,
        interval_seconds INTEGER,
        account_label TEXT,
        expires_at TEXT,
        error TEXT,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (user_id, provider_id)
      );
    `);
  } finally {
    db.close();
  }
}

async function main() {
  await mkdir(workspace, { recursive: true });
  await mkdir(clashHome, { recursive: true });
  const startedAt = now();
  const projectId = "storage-doctor-repair-smoke";

  const init = runCli(["init", "--project", projectId, "--json"]);
  recordCheck(
    "project init command succeeds",
    init.status === 0,
    init.stderr || init.stdout,
    { command: init.command },
  );
  const initialized = parseStdoutJson(init);
  recordCheck(
    "project marker uses requested project id",
    initialized.projectId === projectId,
    JSON.stringify(initialized),
    { command: init.command },
  );

  const before = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage before repair exits successfully with warnings",
    before.status === 0,
    before.stderr || before.stdout,
    { command: before.command },
  );
  const beforeReport = parseStdoutJson(before);
  recordCheck(
    "doctor before repair reports missing workspace prerequisites",
    checkById(beforeReport, "editable-drafts-root")?.level === "warning" &&
      checkById(beforeReport, "local-sqlite-schema")?.level === "warning",
    JSON.stringify({
      drafts: checkById(beforeReport, "editable-drafts-root"),
      sqliteSchema: checkById(beforeReport, "local-sqlite-schema"),
    }),
  );

  const secondaryReplicaRoot = path.join(workspace, "loro");
  const secondarySnapshotPath = path.join(secondaryReplicaRoot, "snapshot.bin");
  const secondaryUpdatesPath = path.join(secondaryReplicaRoot, "updates.log");
  await mkdir(secondaryReplicaRoot, { recursive: true });
  await writeFile(secondarySnapshotPath, "secondary snapshot", "utf8");
  await writeFile(secondaryUpdatesPath, "secondary updates", "utf8");

  const duplicate = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage detects secondary canvas replica before repair",
    duplicate.status === 1,
    duplicate.stderr || duplicate.stdout,
    { command: duplicate.command },
  );
  const duplicateReport = parseStdoutJson(duplicate);
  recordCheck(
    "doctor duplicate report points at cwd secondary snapshot",
    duplicateReport.ok === false &&
      checkById(duplicateReport, "secondary-canvas-replica")?.level === "error" &&
      checkById(duplicateReport, "secondary-canvas-replica")?.path === secondarySnapshotPath,
    JSON.stringify(checkById(duplicateReport, "secondary-canvas-replica")),
  );

  const repairableTextBlobContent = "repairable smoke text revision\n";
  const repairableTextBlob = textRevisionBlobPath(repairableTextBlobContent);
  await mkdir(path.dirname(repairableTextBlob), { recursive: true });
  await writeFile(repairableTextBlob, repairableTextBlobContent, { encoding: "utf8", mode: 0o644 });
  await chmod(repairableTextBlob, 0o644);

  const repair = runCli(["doctor", "storage", "--repair", "--json"]);
  recordCheck(
    "doctor storage repair command succeeds",
    repair.status === 0,
    repair.stderr || repair.stdout,
    { command: repair.command },
  );
  const repairReport = parseStdoutJson(repair);
  recordCheck(
    "doctor repair reports host-owned fixes",
    repairReport.ok === true &&
      repairReport.repaired === true &&
      repairReport.repairs?.some((item) => item.id === "project-workspace") &&
      repairReport.repairs?.some((item) => item.id === "local-sqlite-schema"),
    JSON.stringify({ repaired: repairReport.repaired, repairs: repairReport.repairs }),
  );
  recordCheck(
    "doctor repair makes valid writable revision blobs read-only",
    repairReport.repairs?.some((item) => item.id === "revision-blob-permissions" && item.path === repairableTextBlob) === true &&
      checkById(repairReport, "text-revision-blob-integrity")?.level === "ok" &&
      ((await stat(repairableTextBlob)).mode & 0o222) === 0,
    JSON.stringify({
      repair: repairReport.repairs?.find((item) => item.path === repairableTextBlob),
      integrity: checkById(repairReport, "text-revision-blob-integrity"),
    }),
  );
  const quarantinedSnapshot = repairReport.repairs?.find((item) =>
    item.id === "secondary-canvas-replica-quarantine" &&
    item.sourcePath === secondarySnapshotPath
  );
  const quarantinedUpdates = repairReport.repairs?.find((item) =>
    item.id === "secondary-canvas-replica-quarantine" &&
    item.sourcePath === secondaryUpdatesPath
  );
  recordCheck(
    "doctor repair quarantines secondary canvas replica",
    Boolean(quarantinedSnapshot?.path && quarantinedUpdates?.path) &&
      !(await pathIsFile(secondarySnapshotPath)) &&
      !(await pathIsFile(secondaryUpdatesPath)),
    JSON.stringify({ quarantinedSnapshot, quarantinedUpdates }),
  );
  recordCheck(
    "doctor repair preserves quarantined replica bytes",
    quarantinedSnapshot?.path &&
      quarantinedUpdates?.path &&
      await readFile(quarantinedSnapshot.path, "utf8") === "secondary snapshot" &&
      await readFile(quarantinedUpdates.path, "utf8") === "secondary updates",
    JSON.stringify({ quarantinedSnapshot, quarantinedUpdates }),
  );
  const manifestPath = quarantinedSnapshot?.path
    ? path.join(path.dirname(path.dirname(quarantinedSnapshot.path)), "manifest.json")
    : "";
  const recoveryManifest = manifestPath ? JSON.parse(await readFile(manifestPath, "utf8")) : null;
  recordCheck(
    "doctor repair writes secondary replica recovery manifest",
    recoveryManifest?.schemaVersion === 1 &&
      recoveryManifest?.projectId === projectId &&
      recoveryManifest?.canonicalReplica?.snapshotPath === repairReport.status?.loro?.snapshotPath &&
      recoveryManifest?.files?.some((file) => file.sourcePath === secondarySnapshotPath && file.kind === "snapshot") &&
      recoveryManifest?.files?.some((file) => file.sourcePath === secondaryUpdatesPath && file.kind === "updates-log"),
    JSON.stringify(recoveryManifest),
  );
  const recoveryList = runCli(["doctor", "storage-recovery", "list", "--json"]);
  recordCheck(
    "doctor storage recovery list command succeeds",
    recoveryList.status === 0,
    recoveryList.stderr || recoveryList.stdout,
    { command: recoveryList.command },
  );
  const recoveryListReport = parseStdoutJson(recoveryList);
  recordCheck(
    "doctor storage recovery list exposes quarantined manifest inventory",
    recoveryListReport.projectId === projectId &&
      recoveryListReport.safeToImportAutomatically === false &&
      recoveryListReport.invalidEntries?.length === 0 &&
      recoveryListReport.sets?.some((set) =>
        set.manifestPath === manifestPath &&
        set.fileCount === 2 &&
        set.files?.some((file) => file.sourcePath === secondarySnapshotPath && file.kind === "snapshot") &&
        set.files?.some((file) => file.sourcePath === secondaryUpdatesPath && file.kind === "updates-log")
      ),
    JSON.stringify(recoveryListReport),
  );
  const recoveryCompare = runCli(["doctor", "storage-recovery", "compare", "--manifest", manifestPath, "--json"]);
  recordCheck(
    "doctor storage recovery compare command succeeds",
    recoveryCompare.status === 0,
    recoveryCompare.stderr || recoveryCompare.stdout,
    { command: recoveryCompare.command },
  );
  const recoveryCompareReport = parseStdoutJson(recoveryCompare);
  const comparedSnapshot = recoveryCompareReport.files?.find((file) => file.kind === "snapshot");
  recordCheck(
    "doctor storage recovery compare reports quarantined hash and canonical state without import",
    recoveryCompareReport.safeToImportAutomatically === false &&
      typeof recoveryCompareReport.readToken === "string" &&
      recoveryCompareReport.readToken.startsWith("secondary-canvas-recovery:") &&
      comparedSnapshot?.quarantined?.exists === true &&
      comparedSnapshot?.canonical?.path === repairReport.status?.loro?.snapshotPath &&
      typeof comparedSnapshot?.quarantined?.sha256 === "string" &&
      comparedSnapshot?.canonical?.exists === false &&
      comparedSnapshot.sameBytes === false,
    JSON.stringify(recoveryCompareReport),
  );
  const unconfirmedRecoveryRestore = runCli([
    "doctor",
    "storage-recovery",
    "restore",
    "--manifest",
    manifestPath,
    "--if-match",
    recoveryCompareReport.readToken,
    "--json",
  ]);
  recordCheck(
    "doctor storage recovery restore requires explicit confirmation",
    unconfirmedRecoveryRestore.status !== 0 &&
      `${unconfirmedRecoveryRestore.stdout}\n${unconfirmedRecoveryRestore.stderr}`.includes("requires explicit --yes"),
    unconfirmedRecoveryRestore.stderr || unconfirmedRecoveryRestore.stdout,
    { command: unconfirmedRecoveryRestore.command },
  );
  const mismatchedRecoveryRestore = runCli([
    "doctor",
    "storage-recovery",
    "restore",
    "--manifest",
    manifestPath,
    "--if-match",
    "secondary-canvas-recovery:stale",
    "--yes",
    "--json",
  ]);
  recordCheck(
    "doctor storage recovery restore rejects stale read tokens before restore",
    mismatchedRecoveryRestore.status !== 0 &&
      `${mismatchedRecoveryRestore.stdout}\n${mismatchedRecoveryRestore.stderr}`.includes("read token is stale"),
    mismatchedRecoveryRestore.stderr || mismatchedRecoveryRestore.stdout,
    { command: mismatchedRecoveryRestore.command },
  );
  const recoveryRestore = runCli([
    "doctor",
    "storage-recovery",
    "restore",
    "--manifest",
    manifestPath,
    "--if-match",
    recoveryCompareReport.readToken,
    "--yes",
    "--json",
  ]);
  recordCheck(
    "doctor storage recovery restore command succeeds",
    recoveryRestore.status === 0,
    recoveryRestore.stderr || recoveryRestore.stdout,
    { command: recoveryRestore.command },
  );
  const recoveryRestoreReport = parseStdoutJson(recoveryRestore);
  const recoveryRestoreReceiptPath = recoveryRestoreReport.receiptPath;
  const recoveryRestoreReceipt = typeof recoveryRestoreReceiptPath === "string" &&
    await pathIsFile(recoveryRestoreReceiptPath)
    ? JSON.parse(await readFile(recoveryRestoreReceiptPath, "utf8"))
    : null;
  recordCheck(
    "doctor storage recovery restore promotes quarantined replica through CAS",
    recoveryRestoreReport.status === "restored" &&
      recoveryRestoreReport.safeToImportAutomatically === false &&
      recoveryRestoreReport.beforeReadToken === recoveryCompareReport.readToken &&
      recoveryRestoreReport.afterReadToken !== recoveryCompareReport.readToken &&
      recoveryRestoreReport.files?.some((file) => file.kind === "snapshot" && file.restored === true) &&
      recoveryRestoreReport.files?.some((file) => file.kind === "updates-log" && file.restored === true) &&
      await readFile(repairReport.status?.loro?.snapshotPath ?? "", "utf8") === "secondary snapshot" &&
      await readFile(repairReport.status?.loro?.updatesLogPath ?? "", "utf8") === "secondary updates",
    JSON.stringify(recoveryRestoreReport),
  );
  const receiptSnapshot = recoveryRestoreReceipt?.files?.find((file) => file.kind === "snapshot");
  const receiptUpdates = recoveryRestoreReceipt?.files?.find((file) => file.kind === "updates-log");
  recordCheck(
    "doctor storage recovery restore writes durable receipt under recovery set",
    typeof recoveryRestoreReceiptPath === "string" &&
      recoveryRestoreReceiptPath.endsWith("restore-receipt.json") &&
      isInside(recoveryRestoreReceiptPath, path.dirname(manifestPath)) &&
      recoveryRestoreReceipt?.schemaVersion === 1 &&
      recoveryRestoreReceipt?.status === "restored" &&
      recoveryRestoreReceipt?.projectId === projectId &&
      recoveryRestoreReceipt?.manifestPath === manifestPath &&
      recoveryRestoreReceipt?.expectedReadToken === recoveryCompareReport.readToken &&
      recoveryRestoreReceipt?.beforeReadToken === recoveryRestoreReport.beforeReadToken &&
      recoveryRestoreReceipt?.afterReadToken === recoveryRestoreReport.afterReadToken &&
      receiptSnapshot?.restored === true &&
      typeof receiptSnapshot?.canonicalAfter?.sha256 === "string" &&
      receiptUpdates?.restored === true &&
      typeof receiptUpdates?.canonicalAfter?.sha256 === "string",
    JSON.stringify({
      receiptPath: recoveryRestoreReceiptPath,
      receipt: recoveryRestoreReceipt,
    }),
  );
  const recoveryListAfterRestore = runCli(["doctor", "storage-recovery", "list", "--json"]);
  recordCheck(
    "doctor storage recovery list after restore command succeeds",
    recoveryListAfterRestore.status === 0,
    recoveryListAfterRestore.stderr || recoveryListAfterRestore.stdout,
    { command: recoveryListAfterRestore.command },
  );
  const recoveryListAfterRestoreReport = parseStdoutJson(recoveryListAfterRestore);
  const restoredSet = recoveryListAfterRestoreReport.sets?.find((set) => set.manifestPath === manifestPath);
  const restoredReceipt = restoredSet?.restoreReceipts?.find((receipt) => receipt.receiptPath === recoveryRestoreReceiptPath);
  recordCheck(
    "doctor storage recovery list exposes prior restore receipts",
    restoredReceipt?.status === "restored" &&
      restoredReceipt?.projectId === projectId &&
      restoredReceipt?.manifestPath === manifestPath &&
      restoredReceipt?.expectedReadToken === recoveryCompareReport.readToken &&
      restoredReceipt?.beforeReadToken === recoveryRestoreReport.beforeReadToken &&
      restoredReceipt?.afterReadToken === recoveryRestoreReport.afterReadToken &&
      restoredReceipt?.fileCount === 2,
    JSON.stringify({
      set: restoredSet,
      receiptPath: recoveryRestoreReceiptPath,
    }),
  );
  const staleAfterRestore = runCli([
    "doctor",
    "storage-recovery",
    "restore",
    "--manifest",
    manifestPath,
    "--if-match",
    recoveryCompareReport.readToken,
    "--yes",
    "--json",
  ]);
  recordCheck(
    "doctor storage recovery restore rejects old read token after canonical changes",
    staleAfterRestore.status !== 0 &&
      `${staleAfterRestore.stdout}\n${staleAfterRestore.stderr}`.includes("read token is stale"),
    staleAfterRestore.stderr || staleAfterRestore.stdout,
    { command: staleAfterRestore.command },
  );
  const externalManifestPath = path.join(artifactRoot, "external-recovery-manifest.json");
  await writeJson(externalManifestPath, {
    schemaVersion: 1,
    projectId,
    createdAt: now(),
    canonicalReplica: recoveryManifest.canonicalReplica,
    files: [],
  });
  const externalRecoveryCompare = runCli([
    "doctor",
    "storage-recovery",
    "compare",
    "--manifest",
    externalManifestPath,
    "--json",
  ]);
  recordCheck(
    "doctor storage recovery compare rejects external manifests",
    externalRecoveryCompare.status !== 0 &&
      `${externalRecoveryCompare.stdout}\n${externalRecoveryCompare.stderr}`.includes("outside current project recovery root"),
    externalRecoveryCompare.stderr || externalRecoveryCompare.stdout,
    { command: externalRecoveryCompare.command },
  );

  for (const id of [
    "project-workspace",
    "editable-drafts-root",
    "editable-projections-root",
    "editable-sessions-root",
    "editable-asset-links-root",
    "protected-runtime-root",
    "local-sqlite",
    "local-sqlite-schema",
  ]) {
    recordCheck(
      `doctor repair leaves ${id} ok`,
      checkById(repairReport, id)?.level === "ok",
      JSON.stringify(checkById(repairReport, id)),
    );
  }

  const status = repairReport.status;
  recordCheck(
    "project status keeps cwd as draft workspace",
    status?.storage?.workspace?.ownsCanonicalSnapshot === false &&
      status?.storage?.workspace?.ownsCanonicalMetadata === false,
    JSON.stringify(status?.storage?.workspace),
  );
  recordCheck(
    "doctor repair reports no secondary canvas replica",
    checkById(repairReport, "secondary-canvas-replica")?.level === "ok",
    JSON.stringify(checkById(repairReport, "secondary-canvas-replica")),
  );
  recordCheck(
    "local project status is not web-openable or shared",
    status?.collaboration?.mode === "local-only" &&
      status?.collaboration?.webOpenable === false &&
      status?.collaboration?.multiUser === false &&
      status?.collaboration?.roomAuthority === "local" &&
      status?.collaboration?.cloudProjectRoom === "disabled",
    JSON.stringify(status?.collaboration),
  );
  recordCheck(
    "local project action gates require sync before web or sharing",
    status?.collaboration?.actions?.openInWeb?.allowed === false &&
      status?.collaboration?.actions?.openInWeb?.reason === "project-is-local-only" &&
      status?.collaboration?.actions?.enableSync?.allowed === true &&
      status?.collaboration?.actions?.shareProject?.allowed === false &&
      status?.collaboration?.actions?.shareProject?.requirements?.includes("enable-sync") === true &&
      status?.collaboration?.actions?.runLocalAgent?.allowed === true,
    JSON.stringify(status?.collaboration?.actions),
  );
  recordCheck(
    "canonical canvas path is protected and outside editable workspace roots",
    typeof status?.loro?.snapshotPath === "string" &&
      repairReport.status.protectedPaths.includes(status.loro.snapshotPath) &&
      !isInside(status.loro.snapshotPath, status.projectWorkspaceRoot),
    JSON.stringify({
      snapshotPath: status?.loro?.snapshotPath,
      projectWorkspaceRoot: status?.projectWorkspaceRoot,
      protectedPaths: status?.protectedPaths,
    }),
  );
  const textRevisionBlobs = status?.storage?.canonicalReplica?.contentBlobs?.textRevisions;
  const timelineRevisionBlobs = status?.storage?.canonicalReplica?.contentBlobs?.timelineRevisions;
  recordCheck(
    "revision content blob roots are protected and outside editable workspace roots",
    textRevisionBlobs?.kind === "content-addressed-files" &&
      textRevisionBlobs.path === path.join(clashHome, "local-api", "text-revision-blobs") &&
      textRevisionBlobs.mediaType === "text/markdown" &&
      textRevisionBlobs.immutable === true &&
      textRevisionBlobs.agentWritable === false &&
      repairReport.status.protectedPaths.includes(textRevisionBlobs.path) &&
      !isInside(textRevisionBlobs.path, status.projectWorkspaceRoot) &&
      timelineRevisionBlobs?.kind === "content-addressed-files" &&
      timelineRevisionBlobs.path === path.join(clashHome, "local-api", "timeline-revision-blobs") &&
      timelineRevisionBlobs.mediaType === "application/yaml" &&
      timelineRevisionBlobs.immutable === true &&
      timelineRevisionBlobs.agentWritable === false &&
      repairReport.status.protectedPaths.includes(timelineRevisionBlobs.path) &&
      !isInside(timelineRevisionBlobs.path, status.projectWorkspaceRoot),
    JSON.stringify({
      textRevisionBlobs,
      timelineRevisionBlobs,
      projectWorkspaceRoot: status?.projectWorkspaceRoot,
      protectedPaths: status?.protectedPaths,
    }),
  );
  const tamperedTextBlob = path.join(textRevisionBlobs.path, "12", "1234567890abcdef.md");
  const tamperedTimelineBlob = path.join(timelineRevisionBlobs.path, "12", "1234567890abcdef.timeline.yaml");
  await mkdir(path.dirname(tamperedTextBlob), { recursive: true });
  await mkdir(path.dirname(tamperedTimelineBlob), { recursive: true });
  await writeFile(tamperedTextBlob, "tampered text body", { encoding: "utf8", mode: 0o644 });
  await writeFile(
    tamperedTimelineBlob,
    [
      "fps: 30",
      "durationInFrames: 30",
      "tracks:",
      "  - id: v1",
      "    name: Video",
      "    items: []",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o644 },
  );
  const tamperedRevisionBlobs = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage detects tampered revision content blobs",
    tamperedRevisionBlobs.status === 1,
    tamperedRevisionBlobs.stderr || tamperedRevisionBlobs.stdout,
    { command: tamperedRevisionBlobs.command },
  );
  const tamperedRevisionBlobReport = parseStdoutJson(tamperedRevisionBlobs);
  recordCheck(
    "doctor tampered revision blob report is parseable and path-specific",
    tamperedRevisionBlobReport.ok === false &&
      checkById(tamperedRevisionBlobReport, "text-revision-blob-integrity")?.level === "error" &&
      checkById(tamperedRevisionBlobReport, "text-revision-blob-integrity")?.path === tamperedTextBlob &&
      checkById(tamperedRevisionBlobReport, "text-revision-blob-integrity")?.message?.includes("hash mismatch") === true &&
      checkById(tamperedRevisionBlobReport, "text-revision-blob-integrity")?.message?.includes("writable") === true &&
      checkById(tamperedRevisionBlobReport, "timeline-revision-blob-integrity")?.level === "error" &&
      checkById(tamperedRevisionBlobReport, "timeline-revision-blob-integrity")?.path === tamperedTimelineBlob &&
      checkById(tamperedRevisionBlobReport, "timeline-revision-blob-integrity")?.message?.includes("hash mismatch") === true &&
      checkById(tamperedRevisionBlobReport, "timeline-revision-blob-integrity")?.message?.includes("writable") === true,
    JSON.stringify({
      text: checkById(tamperedRevisionBlobReport, "text-revision-blob-integrity"),
      timeline: checkById(tamperedRevisionBlobReport, "timeline-revision-blob-integrity"),
    }),
  );
  await rm(textRevisionBlobs.path, { recursive: true, force: true });
  await rm(timelineRevisionBlobs.path, { recursive: true, force: true });

  for (const targetPath of [
    status.roots.drafts,
    path.join(status.roots.projections, "text"),
    path.join(status.roots.projections, "timelines"),
    path.join(status.roots.projections, "storyboards"),
    path.join(status.roots.projections, "prompts"),
    path.join(status.roots.projections, "metadata"),
    status.roots.sessions,
    status.roots.assetLinks,
    status.roots.runtime,
  ]) {
    recordCheck(
      `filesystem root exists ${path.relative(status.projectWorkspaceRoot, targetPath) || "."}`,
      await pathIsDirectory(targetPath),
      targetPath,
    );
  }
  recordCheck("local sqlite file exists after repair", await pathIsFile(status.localSqlitePath), status.localSqlitePath);
  recordCheck(
    "local sqlite core metadata, provider auth tables, and projection indexes exist after repair",
    sqliteObjectsExist(status.localSqlitePath, [
      { type: "table", name: "local_migration" },
      { type: "table", name: "project" },
      { type: "index", name: "project_owner_idx" },
      { type: "table", name: "project_preview_asset" },
      { type: "table", name: "assets" },
      { type: "index", name: "assets_user_idx" },
      { type: "index", name: "assets_task_idx" },
      { type: "index", name: "assets_project_idx" },
      { type: "table", name: "asset_refs" },
      { type: "index", name: "asset_refs_project_idx" },
      { type: "table", name: "asset_node_refs" },
      { type: "index", name: "asset_node_refs_asset_idx" },
      { type: "index", name: "asset_node_refs_project_idx" },
      { type: "table", name: "text_revisions" },
      { type: "index", name: "text_revisions_project_node_idx" },
      { type: "index", name: "text_revisions_text_idx" },
      { type: "table", name: "timeline_revisions" },
      { type: "index", name: "timeline_revisions_project_node_idx" },
      { type: "index", name: "timeline_revisions_timeline_idx" },
      { type: "table", name: "runtime_session" },
      { type: "index", name: "runtime_session_project_idx" },
      { type: "table", name: "agent_member" },
      { type: "index", name: "agent_member_user_idx" },
      { type: "table", name: "chat_message" },
      { type: "index", name: "chat_message_session_idx" },
      { type: "table", name: "room_message" },
      { type: "index", name: "room_message_project_idx" },
      { type: "table", name: "mutation_audit" },
      { type: "index", name: "mutation_audit_created_idx" },
      { type: "index", name: "mutation_audit_operation_idx" },
      { type: "index", name: "mutation_audit_entity_idx" },
      { type: "table", name: "provider_accounts" },
      { type: "table", name: "provider_account_credentials" },
      { type: "table", name: "provider_account_supported_models" },
      { type: "table", name: "provider_account_model_priorities" },
      { type: "table", name: "provider_oauth" },
    ]),
    status.localSqlitePath,
  );
  rewriteProviderAuthTablesWithLegacyPrimaryKeys(status.localSqlitePath);
  const legacyProviderPkDoctor = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage detects legacy provider auth primary keys",
    legacyProviderPkDoctor.status === 0,
    legacyProviderPkDoctor.stderr || legacyProviderPkDoctor.stdout,
    { command: legacyProviderPkDoctor.command },
  );
  const legacyProviderPkReport = parseStdoutJson(legacyProviderPkDoctor);
  recordCheck(
    "doctor legacy provider primary-key report is provider-specific",
    checkById(legacyProviderPkReport, "local-sqlite-schema")?.level === "warning" &&
      checkById(legacyProviderPkReport, "local-sqlite-schema")?.message?.includes("provider_accounts primary key") === true &&
      checkById(legacyProviderPkReport, "local-sqlite-schema")?.message?.includes("provider_oauth primary key") === true,
    JSON.stringify(checkById(legacyProviderPkReport, "local-sqlite-schema")),
  );
  const legacyProviderPkRepair = runCli(["doctor", "storage", "--repair", "--json"]);
  recordCheck(
    "doctor storage repair fixes legacy provider auth primary keys",
    legacyProviderPkRepair.status === 0,
    legacyProviderPkRepair.stderr || legacyProviderPkRepair.stdout,
    { command: legacyProviderPkRepair.command },
  );
  recordCheck(
    "local sqlite provider auth primary keys support multi-account rows after repair",
    sqlitePrimaryKeyMatches(status.localSqlitePath, "provider_accounts", ["user_id", "account_key"]) &&
      sqlitePrimaryKeyMatches(status.localSqlitePath, "provider_oauth", ["user_id", "provider_id", "account_id"]),
    status.localSqlitePath,
  );

  const after = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage after repair succeeds",
    after.status === 0,
    after.stderr || after.stdout,
    { command: after.command },
  );
  const afterReport = parseStdoutJson(after);
  recordCheck(
    "doctor after repair reports repaired prerequisites as ok",
    checkById(afterReport, "local-sqlite-schema")?.level === "ok" &&
      checkById(afterReport, "editable-drafts-root")?.level === "ok" &&
      checkById(afterReport, "editable-projections-root")?.level === "ok",
    JSON.stringify({
      drafts: checkById(afterReport, "editable-drafts-root"),
      projections: checkById(afterReport, "editable-projections-root"),
      sqliteSchema: checkById(afterReport, "local-sqlite-schema"),
    }),
  );
  recordCheck(
    "doctor after repair reports quarantined recovery inventory",
    checkById(afterReport, "secondary-canvas-recovery")?.level === "warning" &&
      checkById(afterReport, "secondary-canvas-recovery")?.path === manifestPath,
    JSON.stringify(checkById(afterReport, "secondary-canvas-recovery")),
  );
  const invalidRecoverySetRoot = path.join(
    status.roots.runtime,
    "recovery",
    "secondary-canvas-replicas",
    "invalid-outside-destination",
  );
  const invalidRecoveryManifestPath = path.join(invalidRecoverySetRoot, "manifest.json");
  const outsideRecoveryFile = path.join(artifactRoot, "outside-recovery-snapshot.bin");
  await mkdir(invalidRecoverySetRoot, { recursive: true });
  await writeFile(outsideRecoveryFile, "outside recovery bytes", "utf8");
  await writeJson(invalidRecoveryManifestPath, {
    schemaVersion: 1,
    projectId,
    createdAt: now(),
    canonicalReplica: recoveryManifest.canonicalReplica,
    files: [
      {
        kind: "snapshot",
        sourcePath: secondarySnapshotPath,
        destinationPath: outsideRecoveryFile,
      },
    ],
  });
  const invalidRecoveryList = runCli(["doctor", "storage-recovery", "list", "--json"]);
  recordCheck(
    "doctor storage recovery list reports invalid manifest inventory",
    invalidRecoveryList.status === 0,
    invalidRecoveryList.stderr || invalidRecoveryList.stdout,
    { command: invalidRecoveryList.command },
  );
  const invalidRecoveryListReport = parseStdoutJson(invalidRecoveryList);
  recordCheck(
    "doctor storage recovery list rejects out-of-set manifest destinations",
    invalidRecoveryListReport.invalidEntries?.some((entry) =>
      entry.path === invalidRecoveryManifestPath &&
      entry.error?.includes("outside recovery set root")
    ) === true &&
      !invalidRecoveryListReport.sets?.some((set) => set.manifestPath === invalidRecoveryManifestPath),
    JSON.stringify(invalidRecoveryListReport),
  );
  const invalidRecoveryDoctor = runCli(["doctor", "storage", "--json"]);
  recordCheck(
    "doctor storage reports invalid recovery inventory without blessing it",
    invalidRecoveryDoctor.status === 0,
    invalidRecoveryDoctor.stderr || invalidRecoveryDoctor.stdout,
    { command: invalidRecoveryDoctor.command },
  );
  const invalidRecoveryDoctorReport = parseStdoutJson(invalidRecoveryDoctor);
  recordCheck(
    "doctor invalid recovery report points at the invalid manifest",
    checkById(invalidRecoveryDoctorReport, "secondary-canvas-recovery")?.level === "warning" &&
      checkById(invalidRecoveryDoctorReport, "secondary-canvas-recovery")?.path === invalidRecoveryManifestPath &&
      checkById(invalidRecoveryDoctorReport, "secondary-canvas-recovery")?.message?.includes("invalid manifest entries") === true,
    JSON.stringify(checkById(invalidRecoveryDoctorReport, "secondary-canvas-recovery")),
  );

  const markerPath = path.join(workspace, ".clash", "project.toml");
  await writeFile(
    markerPath,
    [
      "schema_version = 1",
      `project_id = ${JSON.stringify(projectId)}`,
      'store = "managed"',
      "",
      "[sync]",
      'mode = "cloud-sync"',
      "",
    ].join("\n"),
    "utf8",
  );
  const cloudSyncStatusResult = runCli(["project", "status", "--json"]);
  recordCheck(
    "cloud-sync project status stays pending until sync capabilities are ready",
    cloudSyncStatusResult.status === 0,
    cloudSyncStatusResult.stderr || cloudSyncStatusResult.stdout,
    { command: cloudSyncStatusResult.command },
  );
  const cloudSyncStatus = parseStdoutJson(cloudSyncStatusResult);
  recordCheck(
    "cloud-sync pending status is not web-openable",
    cloudSyncStatus?.collaboration?.mode === "synced" &&
      cloudSyncStatus?.collaboration?.webOpenable === false &&
      cloudSyncStatus?.collaboration?.roomAuthority === "local" &&
      cloudSyncStatus?.collaboration?.syncReadiness?.status === "pending" &&
      cloudSyncStatus?.collaboration?.syncReadiness?.ready === false &&
      cloudSyncStatus?.collaboration?.syncReadiness?.missing?.includes("room") === true &&
      cloudSyncStatus?.collaboration?.syncReadiness?.missing?.includes("asset-metadata") === true,
    JSON.stringify(cloudSyncStatus?.collaboration),
  );
  recordCheck(
    "cloud-sync pending action gates block web and sharing until required mirrors are ready",
    cloudSyncStatus?.collaboration?.actions?.openInWeb?.allowed === false &&
      cloudSyncStatus?.collaboration?.actions?.openInWeb?.reason === "cloud-sync-not-ready" &&
      cloudSyncStatus?.collaboration?.actions?.openInWeb?.requirements?.includes("canvas") === true &&
      cloudSyncStatus?.collaboration?.actions?.openInWeb?.requirements?.includes("room") === true &&
      cloudSyncStatus?.collaboration?.actions?.openInWeb?.requirements?.includes("asset-metadata") === true &&
      cloudSyncStatus?.collaboration?.actions?.enableSync?.allowed === false &&
      cloudSyncStatus?.collaboration?.actions?.shareProject?.allowed === false &&
      cloudSyncStatus?.collaboration?.actions?.shareProject?.reason === "cloud-sync-not-ready",
    JSON.stringify(cloudSyncStatus?.collaboration?.actions),
  );

  const report = {
    schemaVersion: 1,
    status: "pass",
    summary: "Storage doctor repair initializes agent workspace roots plus local SQLite core metadata, provider auth table/primary-key, and projection index schema through public CLI commands, and project status exposes explicit local/cloud action gates.",
    run: {
      artifactRoot,
      workspace,
      clashHome,
      startedAt,
      finishedAt: now(),
    },
    commands: [
      init,
      before,
      duplicate,
      repair,
      legacyProviderPkDoctor,
      legacyProviderPkRepair,
      recoveryList,
      recoveryCompare,
      unconfirmedRecoveryRestore,
      mismatchedRecoveryRestore,
      recoveryRestore,
      staleAfterRestore,
      externalRecoveryCompare,
      tamperedRevisionBlobs,
      after,
      invalidRecoveryList,
      invalidRecoveryDoctor,
      cloudSyncStatusResult,
    ].map((result) => ({
      command: result.command,
      status: result.status,
      stdout: result.stdout.slice(0, 2000),
      stderr: result.stderr.slice(0, 2000),
    })),
    checks,
  };
  await writeJson(reportPath, report);
  console.log("[storage-doctor-repair] report", reportPath);
  console.log(JSON.stringify({ status: "pass", reportPath, checks: checks.length }));
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeJson(reportPath, {
    schemaVersion: 1,
    status: "fail",
    summary: message,
    checks,
  });
  console.error(message);
  process.exit(1);
});
