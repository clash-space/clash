import { Command } from "commander";
import WebSocket from "ws";
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import {
  lstat,
  mkdir as mkdirAsync,
  mkdtemp,
  readFile as readFileAsync,
  readdir as readdirAsync,
  rename,
  rm,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  createExecutablePluginActivationReceipt,
  executablePluginActivationReceiptPath,
  runExecutablePluginContractTests,
} from "@clash-space/bridge/actions-host";
import {
  CustomActionDefinitionSchema,
  ExecutablePluginActivationReceiptSchema,
  ExecutablePluginManifestSchema,
  LoroSyncClient,
  diffExecutablePluginPermissions,
  isSafePluginRelativePath,
  type ExecutablePluginPermissionDiff,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { resolveClashRoot } from "../lib/clash-home";
import { isJsonMode, printJson } from "../lib/output";

const REGISTRY_URL = "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

/**
 * Directory that the bridge daemon's ActionsHost watches. Installing an
 * action means writing manifest.json + source files into a subdir here;
 * the bridge picks it up via fs.watch and spawns the python subprocess.
 */
export function localActionsDir(env: Record<string, string | undefined> = process.env): string {
  return join(resolveClashRoot(env), "actions");
}

export function customActionSecretHint(runtime: unknown): string {
  return runtime === "local"
    ? "  → Local actions read credentials from their local runtime environment."
    : "  → Remote worker action secrets are managed in hosted/remote Settings.";
}

/** Shape of the GET /api/v1/actions/:id/package response. */
interface ActionPackage {
  id: string;
  manifest: Record<string, unknown> & { id: string; version?: string };
  /** path → base64-encoded contents. */
  files: Record<string, string>;
}

export interface ValidatedDownloadedActionPackage extends ActionPackage {
  format: "legacy-custom-action" | "executable-plugin";
}

export interface LocalMarketplaceInstallResult {
  actionId: string;
  packageId: string;
  installed: boolean;
  targetDir: string;
}

export async function tryInstallLocalMarketplaceAction(options: {
  packageId: string;
  serverUrl: string;
  apiKey: string;
  request?: typeof fetch;
}): Promise<LocalMarketplaceInstallResult | null> {
  const request = options.request ?? fetch;
  const response = await request(
    `${options.serverUrl}/api/marketplace/actions/${encodeURIComponent(options.packageId)}/install`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Local marketplace returned ${response.status} ${response.statusText}`
        + (detail ? `: ${detail}` : ""),
    );
  }
  return await response.json() as LocalMarketplaceInstallResult;
}

function packageRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function formatPermissionUpgrade(diff: ExecutablePluginPermissionDiff): string {
  const lines: string[] = [];
  if (diff.networkDomains.length) lines.push(`  Network: ${diff.networkDomains.join(", ")}`);
  if (diff.secrets.length) lines.push(`  Secrets: ${diff.secrets.join(", ")}`);
  if (diff.assetCapabilities.length) lines.push(`  Assets: ${diff.assetCapabilities.join(", ")}`);
  if (diff.hostTools.length) lines.push(`  Host tools: ${diff.hostTools.join(", ")}`);
  if (diff.filesystem.read.length) lines.push(`  File read: ${diff.filesystem.read.join(", ")}`);
  if (diff.filesystem.write.length) lines.push(`  File write: ${diff.filesystem.write.join(", ")}`);
  if (diff.externalWrites) lines.push("  External writes: enabled");
  return lines.join("\n");
}

/** Validate the complete package in memory before the installer mutates disk. */
export function validateDownloadedActionPackage(input: unknown): ValidatedDownloadedActionPackage {
  const pkg = packageRecord(input, "Action package");
  const id = typeof pkg.id === "string" ? pkg.id : "";
  if (!id) throw new Error("Action package id is required.");
  const manifestInput = packageRecord(pkg.manifest, "Action package manifest");
  const filesInput = packageRecord(pkg.files, "Action package files");
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(filesInput)) {
    if (!isSafePluginRelativePath(path)) {
      throw new Error(`Refusing suspicious file path in package: ${path}`);
    }
    if (typeof contents === "string") files[path] = contents;
  }

  if (manifestInput.apiVersion === "clash.plugin/v1") {
    const parsedManifest = ExecutablePluginManifestSchema.parse(manifestInput);
    if (parsedManifest.id !== id) {
      throw new Error(`Package id ${id} does not match plugin manifest id ${parsedManifest.id}.`);
    }
    if (parsedManifest.runtime.kind === "local"
      && typeof files[parsedManifest.runtime.entrypoint] !== "string") {
      throw new Error(`Plugin entrypoint ${parsedManifest.runtime.entrypoint} is missing.`);
    }
    const cardDocuments: Record<string, unknown> = {};
    for (const card of parsedManifest.exports.cards) {
      const encoded = files[card.path];
      if (typeof encoded !== "string") {
        throw new Error(`Missing declared Card document: ${card.path}`);
      }
      try {
        cardDocuments[card.path] = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      } catch (error) {
        throw new Error(`Invalid Card JSON at ${card.path}: ${(error as Error).message}`);
      }
    }
    const contractTestDocuments: Record<string, unknown> = {};
    for (const path of parsedManifest.contractTests) {
      const encoded = files[path];
      if (typeof encoded !== "string") {
        throw new Error(`Missing declared contract test: ${path}`);
      }
      try {
        contractTestDocuments[path] = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      } catch (error) {
        throw new Error(`Invalid contract test JSON at ${path}: ${(error as Error).message}`);
      }
    }
    const validated = validateExecutablePluginPackage(
      parsedManifest,
      cardDocuments,
      contractTestDocuments,
    );
    return {
      id,
      format: "executable-plugin",
      manifest: validated.manifest,
      files,
    };
  }

  const legacy = CustomActionDefinitionSchema.parse(manifestInput);
  if (legacy.id !== id) {
    throw new Error(`Package id ${id} does not match action manifest id ${legacy.id}.`);
  }
  const entrypoint = typeof manifestInput.entrypoint === "string"
    ? manifestInput.entrypoint
    : "handler.py";
  if (!isSafePluginRelativePath(entrypoint)) {
    throw new Error(`Refusing suspicious action entrypoint: ${entrypoint}`);
  }
  if (legacy.runtime === "local" && typeof files[entrypoint] !== "string") {
    throw new Error(`Action entrypoint ${entrypoint} is missing.`);
  }
  return {
    id,
    format: "legacy-custom-action",
    manifest: { ...manifestInput, ...legacy, entrypoint },
    files,
  };
}

export function permissionUpgradeForDownloadedPackage(
  input: unknown,
  existingManifest?: unknown,
): ExecutablePluginPermissionDiff | null {
  const pkg = validateDownloadedActionPackage(input);
  if (pkg.format !== "executable-plugin") return null;
  const next = ExecutablePluginManifestSchema.parse(pkg.manifest);
  const existing = ExecutablePluginManifestSchema.safeParse(existingManifest);
  return diffExecutablePluginPermissions(
    existing.success ? existing.data.permissions : {},
    next.permissions,
  );
}

export interface ActivatedDownloadedActionPackage {
  targetDir: string;
  rollbackDir?: string;
  contractTests?: Awaited<ReturnType<typeof runExecutablePluginContractTests>>;
}

async function writeExecutablePluginActivationReceipt(
  root: string,
  pluginDir: string,
): Promise<void> {
  const receipt = await createExecutablePluginActivationReceipt(pluginDir);
  const target = executablePluginActivationReceiptPath(root, receipt.pluginId);
  await mkdirAsync(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), `.${receipt.pluginId}-`));
  const stagedReceipt = join(staging, "receipt.json");
  try {
    await writeFileAsync(stagedReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
    await rename(stagedReceipt, target);
  } finally {
    if (existsSync(staging)) await rm(staging, { recursive: true, force: true });
  }
}

export interface ValidatedExecutablePluginDraft {
  package: ValidatedDownloadedActionPackage & { format: "executable-plugin" };
  contractTests: Awaited<ReturnType<typeof runExecutablePluginContractTests>>;
}

export interface ScaffoldExecutablePluginDraftOptions {
  pluginDir: string;
  id: string;
  name?: string;
  kind?: "action" | "provider-projector";
}

export interface ScaffoldedExecutablePluginDraft {
  pluginDir: string;
  manifestPath: string;
  cardPath: string;
  contractTestPath: string;
  contractTests: Awaited<ReturnType<typeof runExecutablePluginContractTests>>;
}

export interface CheckoutExecutablePluginDraftOptions {
  id: string;
  pluginDir: string;
  root?: string;
}

/**
 * Copy one attested active package to a separate agent-editable draft. This
 * keeps exploratory edits from invalidating the running package receipt.
 */
export async function checkoutExecutablePluginDraft(
  options: CheckoutExecutablePluginDraftOptions,
): Promise<{ pluginDir: string; id: string; version: string }> {
  const id = options.id.trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid executable plugin id ${id}.`);
  }
  const root = options.root ?? localActionsDir();
  const sourceDir = join(root, id);
  const targetDir = resolve(options.pluginDir);
  const pkg = await packageExecutablePluginDraft(sourceDir);
  if (pkg.id !== id) {
    throw new Error(`Active directory ${id} contains plugin ${pkg.id}.`);
  }
  const receiptPath = executablePluginActivationReceiptPath(root, id);
  const storedReceipt = ExecutablePluginActivationReceiptSchema.parse(
    JSON.parse(await readFileAsync(receiptPath, "utf8")),
  );
  const currentReceipt = await createExecutablePluginActivationReceipt(sourceDir);
  if (storedReceipt.pluginId !== currentReceipt.pluginId
    || storedReceipt.version !== currentReceipt.version
    || storedReceipt.schemaHash !== currentReceipt.schemaHash
    || storedReceipt.contentHash !== currentReceipt.contentHash) {
    throw new Error(
      `Active plugin ${id} differs from its activation receipt; restore or reactivate it before checkout.`,
    );
  }

  await mkdirAsync(dirname(targetDir), { recursive: true });
  try {
    await mkdirAsync(targetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Plugin draft directory already exists: ${targetDir}`);
    }
    throw error;
  }
  try {
    await writeFileAsync(
      join(targetDir, "manifest.json"),
      await readFileAsync(join(sourceDir, "manifest.json")),
    );
    for (const [relativePath, encoded] of Object.entries(pkg.files)) {
      const destination = join(targetDir, relativePath);
      await mkdirAsync(dirname(destination), { recursive: true });
      await writeFileAsync(destination, Buffer.from(encoded, "base64"));
    }
    return { pluginDir: targetDir, id, version: currentReceipt.version };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultPluginName(id: string): string {
  return id
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

/**
 * Create a complete, editable local plugin package for an agent. The generated
 * Card, manifest, stdio handler and declarative contract are validated before
 * the directory is handed back. Existing paths are never merged or replaced.
 */
export async function scaffoldExecutablePluginDraft(
  options: ScaffoldExecutablePluginDraftOptions,
): Promise<ScaffoldedExecutablePluginDraft> {
  const pluginDir = resolve(options.pluginDir);
  const id = options.id.trim();
  const name = options.name?.trim() || defaultPluginName(id);
  const kind = options.kind ?? "action";
  if (kind !== "action" && kind !== "provider-projector") {
    throw new Error(`Unsupported plugin kind ${String(kind)}.`);
  }

  const functionKind = kind;
  const cardKind = kind === "action" ? "action-card" : "model-card";
  const cardPath = `cards/${id}.json`;
  const contractTestPath = `contract-tests/${id}.json`;
  const manifest = {
    apiVersion: "clash.plugin/v1",
    id,
    version: "0.1.0",
    name,
    description: `Agent-editable ${kind} plugin.`,
    runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
    exports: {
      cards: [{ id, kind: cardKind, path: cardPath }],
      functions: [{ id, kind: functionKind, handler: "run" }],
    },
    permissions: {},
    contractTests: [contractTestPath],
  };
  const card = kind === "action"
    ? {
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id,
          name,
          description: "Edit this Card to define the user-facing inputs and output.",
          parameters: [],
          outputType: "text",
          input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
          functionExportId: id,
        },
      }
    : {
        apiVersion: "clash.card/v1",
        kind: "model-card",
        spec: {
          id,
          aliases: [],
          name,
          provider: "fal",
          kind: "video",
          description: "Replace the placeholder upstream route and extend this Card.",
          parameters: [],
          defaultParams: {},
          defaultAspectRatio: "16:9",
          input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
          providerImplementations: [{
            providerId: "fal",
            upstreamId: `${id}:default`,
            upstreamModel: "replace-me",
            apiShape: "custom",
            projectorExportId: id,
          }],
        },
      };
  const expectedValue = kind === "action"
    ? { text: "Describe the result" }
    : { prompt: "Describe the result" };
  const contractTest = {
    apiVersion: "clash.plugin.contract-test/v1",
    id: `${id}-basic`,
    target: { exportId: id, kind: functionKind },
    input: { values: { prompt: "Describe the result" }, references: [] },
    expect: {
      status: "completed",
      outputs: [{ slot: kind === "action" ? "result" : "request", kind: "value", value: expectedValue }],
    },
  };

  // Reject malformed ids or generated contracts before touching the target.
  validateExecutablePluginPackage(
    manifest,
    { [cardPath]: card },
    { [contractTestPath]: contractTest },
  );

  await mkdirAsync(dirname(pluginDir), { recursive: true });
  try {
    await mkdirAsync(pluginDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Plugin draft directory already exists: ${pluginDir}`);
    }
    throw error;
  }

  try {
    await mkdirAsync(join(pluginDir, "cards"));
    await mkdirAsync(join(pluginDir, "contract-tests"));
    await writeFileAsync(join(pluginDir, "manifest.json"), jsonDocument(manifest));
    await writeFileAsync(join(pluginDir, cardPath), jsonDocument(card));
    await writeFileAsync(join(pluginDir, contractTestPath), jsonDocument(contractTest));
    await writeFileAsync(join(pluginDir, "handler.mjs"), [
      'import { createInterface } from "node:readline";',
      "",
      `const exportId = ${JSON.stringify(id)};`,
      `const pluginKind = ${JSON.stringify(kind)};`,
      "",
      "createInterface({ input: process.stdin }).on(\"line\", (line) => {",
      "  const invocation = JSON.parse(line);",
      "  if (invocation.protocol !== \"clash.plugin.invoke/v1\") return;",
      "  const prompt = typeof invocation.input?.values?.prompt === \"string\"",
      "    ? invocation.input.values.prompt",
      "    : \"\";",
      "  const value = pluginKind === \"action\" ? { text: prompt } : { prompt };",
      "  const slot = pluginKind === \"action\" ? \"result\" : \"request\";",
      "  const result = invocation.target?.exportId === exportId",
      "    ? {",
      "        protocol: \"clash.plugin.result/v1\",",
      "        invocationId: invocation.invocationId,",
      "        status: \"completed\",",
      "        outputs: [{ slot, kind: \"value\", value }],",
      "      }",
      "    : {",
      "        protocol: \"clash.plugin.result/v1\",",
      "        invocationId: invocation.invocationId,",
      "        status: \"failed\",",
      "        error: { code: \"UNKNOWN_EXPORT\", message: \"Unknown export\", retryable: false },",
      "      };",
      "  process.stdout.write(`${JSON.stringify(result)}\\n`);",
      "});",
      "",
    ].join("\n"));
    await writeFileAsync(join(pluginDir, "AGENTS.md"), [
      "# Executable Plugin Authoring",
      "",
      "This directory is intentionally agent-editable.",
      "",
      "- Keep `manifest.json`, every Card, and every contract on the versioned Clash v1 schemas.",
      "- Keep provider wire-shape translation in `handler.mjs`; keep user-facing fields in the Card.",
      "- Add broker fixtures before adding network, Secret, asset, filesystem, or external-write permissions.",
      "- Run `clash action validate .` after edits.",
      "- Bump `manifest.json` version for code or schema changes, then run `clash action activate .`.",
      "- Capability increases require user confirmation; never bypass that gate.",
      "",
    ].join("\n"));

    const validated = await validateExecutablePluginDraft(pluginDir);
    return {
      pluginDir,
      manifestPath: join(pluginDir, "manifest.json"),
      cardPath: join(pluginDir, cardPath),
      contractTestPath: join(pluginDir, contractTestPath),
      contractTests: validated.contractTests,
    };
  } catch (error) {
    await rm(pluginDir, { recursive: true, force: true });
    throw error;
  }
}

async function collectPluginDraftFiles(
  root: string,
  directory: string,
  output: Record<string, string>,
): Promise<void> {
  for (const entry of await readdirAsync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(root.length + 1).split("\\").join("/");
    if (!isSafePluginRelativePath(relativePath)) {
      throw new Error(`Refusing suspicious draft path: ${relativePath}`);
    }
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Executable plugin drafts cannot contain symbolic links: ${relativePath}`);
    }
    if (metadata.isDirectory()) {
      await collectPluginDraftFiles(root, absolutePath, output);
      continue;
    }
    if (!metadata.isFile() || relativePath === "manifest.json") continue;
    output[relativePath] = (await readFileAsync(absolutePath)).toString("base64");
  }
}

/** Load and strictly validate an agent-edited unpacked plugin directory. */
export async function packageExecutablePluginDraft(
  pluginDir: string,
): Promise<ValidatedDownloadedActionPackage & { format: "executable-plugin" }> {
  const manifest = JSON.parse(await readFileAsync(join(pluginDir, "manifest.json"), "utf8")) as {
    id?: unknown;
  };
  if (typeof manifest.id !== "string") {
    throw new Error("Executable plugin draft manifest id is required.");
  }
  const files: Record<string, string> = {};
  await collectPluginDraftFiles(pluginDir, pluginDir, files);
  const validated = validateDownloadedActionPackage({ id: manifest.id, manifest, files });
  if (validated.format !== "executable-plugin") {
    throw new Error("Agent draft activation requires a clash.plugin/v1 package.");
  }
  return validated as ValidatedDownloadedActionPackage & { format: "executable-plugin" };
}

/** Validate Cards/manifest and execute every declared contract without mutating active state. */
export async function validateExecutablePluginDraft(
  pluginDir: string,
): Promise<ValidatedExecutablePluginDraft> {
  const pkg = await packageExecutablePluginDraft(pluginDir);
  const contractTests = await runExecutablePluginContractTests(pluginDir);
  return { package: pkg, contractTests };
}

export interface ActivateExecutablePluginDraftOptions {
  pluginDir: string;
  root?: string;
  approvePermissionIncrease?: (diff: ExecutablePluginPermissionDiff) => Promise<boolean>;
}

/**
 * Agent self-evolution gate: validate and test a draft, ask for any capability
 * increase, then atomically replace the active package with rollback retained.
 */
export async function activateExecutablePluginDraft(
  options: ActivateExecutablePluginDraftOptions,
): Promise<ActivatedDownloadedActionPackage & {
  contractTests: Awaited<ReturnType<typeof runExecutablePluginContractTests>>;
}> {
  const validated = await validateExecutablePluginDraft(options.pluginDir);
  const root = options.root ?? localActionsDir();
  const existingManifestPath = join(root, validated.package.id, "manifest.json");
  let existingManifest: unknown;
  if (existsSync(existingManifestPath)) {
    existingManifest = JSON.parse(await readFileAsync(existingManifestPath, "utf8"));
  }
  const permissionIncrease = permissionUpgradeForDownloadedPackage(
    validated.package,
    existingManifest,
  );
  if (permissionIncrease?.requiresApproval) {
    const approved = await options.approvePermissionIncrease?.(permissionIncrease) ?? false;
    if (!approved) {
      throw new Error("Executable plugin permission increase was not approved; no files were changed.");
    }
  }
  const activated = await activateDownloadedActionPackage(validated.package, root);
  return { ...activated, contractTests: validated.contractTests };
}

/**
 * Stage a fully validated package beside the live directory, then switch it in
 * with directory renames. A previous version is retained verbatim for rollback.
 */
export async function activateDownloadedActionPackage(
  input: unknown,
  root: string = localActionsDir(),
): Promise<ActivatedDownloadedActionPackage> {
  const pkg = validateDownloadedActionPackage(input);
  const targetDir = join(root, pkg.id);
  if (pkg.format === "executable-plugin" && existsSync(join(targetDir, "manifest.json"))) {
    const existing = ExecutablePluginManifestSchema.parse(
      JSON.parse(await readFileAsync(join(targetDir, "manifest.json"), "utf8")),
    );
    const next = ExecutablePluginManifestSchema.parse(pkg.manifest);
    if (existing.version === next.version) {
      throw new Error(
        `Executable plugin ${pkg.id} version ${next.version} is already active; `
          + "bump the version before changing or reactivating executable code.",
      );
    }
  }
  await mkdirAsync(root, { recursive: true });
  // A sibling directory stays outside ActionsHost's watched root while files
  // and the final manifest are still being written.
  const stagingDir = await mkdtemp(`${root}.staging-${pkg.id}-`);
  let rollbackDir: string | undefined;
  let contractTests: Awaited<ReturnType<typeof runExecutablePluginContractTests>> | undefined;

  try {
    for (const [relPath, encoded] of Object.entries(pkg.files)) {
      const destination = join(stagingDir, relPath);
      await mkdirAsync(join(destination, ".."), { recursive: true });
      await writeFileAsync(destination, Buffer.from(encoded, "base64"));
    }
    // Manifest last: neither the watcher nor a human sees a ready package
    // until all referenced files are present in the staging directory.
    await writeFileAsync(
      join(stagingDir, "manifest.json"),
      `${JSON.stringify(pkg.manifest, null, 2)}\n`,
    );

    if (pkg.format === "executable-plugin") {
      const manifest = ExecutablePluginManifestSchema.parse(pkg.manifest);
      if (manifest.exports.functions.length > 0) {
        contractTests = await runExecutablePluginContractTests(stagingDir);
      }
    }

    if (existsSync(targetDir)) {
      const rollbackRoot = join(root, ".rollback", pkg.id);
      await mkdirAsync(rollbackRoot, { recursive: true });
      const existing = JSON.parse(await readFileAsync(join(targetDir, "manifest.json"), "utf8")) as {
        version?: string;
      };
      rollbackDir = join(
        rollbackRoot,
        `${String(Date.now()).padStart(16, "0")}-${existing.version ?? "unknown"}`,
      );
      await rename(targetDir, rollbackDir);
    }

    try {
      await rename(stagingDir, targetDir);
      if (pkg.format === "executable-plugin") {
        await writeExecutablePluginActivationReceipt(root, targetDir);
      }
    } catch (error) {
      if (existsSync(targetDir) && !existsSync(stagingDir)) {
        try { await rename(targetDir, stagingDir); } catch { /* receipt verification will fail closed */ }
      }
      if (rollbackDir && !existsSync(targetDir)) await rename(rollbackDir, targetDir);
      throw error;
    }
    return {
      targetDir,
      ...(rollbackDir ? { rollbackDir } : {}),
      ...(contractTests ? { contractTests } : {}),
    };
  } catch (error) {
    if (existsSync(stagingDir)) await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/** Restore the newest retained version and archive the displaced live copy. */
export async function rollbackDownloadedActionPackage(
  root: string,
  id: string,
): Promise<{ targetDir: string; version: string }> {
  const rollbackRoot = join(root, ".rollback", id);
  const entries = (await readdirAsync(rollbackRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{16}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const selected = entries[0];
  if (!selected) throw new Error(`No rollback version is available for ${id}.`);

  const targetDir = join(root, id);
  const selectedDir = join(rollbackRoot, selected);
  const displacedDir = join(root, ".rollback-displaced", id, String(Date.now()));
  if (existsSync(targetDir)) {
    await mkdirAsync(join(displacedDir, ".."), { recursive: true });
    await rename(targetDir, displacedDir);
  }
  try {
    await rename(selectedDir, targetDir);
    const restoredManifest = JSON.parse(
      await readFileAsync(join(targetDir, "manifest.json"), "utf8"),
    ) as { apiVersion?: string };
    if (restoredManifest.apiVersion === "clash.plugin/v1") {
      await writeExecutablePluginActivationReceipt(root, targetDir);
    }
  } catch (error) {
    if (existsSync(targetDir) && !existsSync(selectedDir)) {
      try { await rename(targetDir, selectedDir); } catch { /* leave fail-closed receipt mismatch */ }
    }
    if (existsSync(displacedDir) && !existsSync(targetDir)) await rename(displacedDir, targetDir);
    throw error;
  }
  const manifest = JSON.parse(await readFileAsync(join(targetDir, "manifest.json"), "utf8")) as {
    version?: string;
  };
  return { targetDir, version: manifest.version ?? "0.0.0" };
}

async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const wsUrl = serverUrl.replace(/^http/, "ws");
  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token: apiKey,
    clientType: "cli",
    WebSocket: WebSocket as any,
  });
  await client.connect();
  return client;
}

export const actionsCommand = new Command("action")
  .description("Create, validate, activate, and manage executable plugins and canvas actions");

actionsCommand
  .command("init-plugin")
  .description("Create a complete agent-editable plugin draft with a Card, handler, and contract")
  .argument("<directory>", "New plugin draft directory (must not already exist)")
  .requiredOption("--id <id>", "Stable plugin and export id")
  .option("--name <name>", "User-facing plugin and Card name")
  .option("--kind <kind>", "action or provider-projector", "action")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    try {
      const created = await scaffoldExecutablePluginDraft({
        pluginDir: resolve(directory),
        id: options.id,
        name: options.name,
        kind: options.kind,
      });
      const result = {
        created: true,
        path: created.pluginDir,
        manifest: created.manifestPath,
        card: created.cardPath,
        contract: created.contractTestPath,
        contractTests: created.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Created ${options.id} at ${created.pluginDir}; `
            + `${created.contractTests.passed} contract test(s) passed.`,
        );
        console.log(`Edit the Card and handler, then run: clash action activate ${created.pluginDir}`);
      }
    } catch (error) {
      console.error(`Plugin draft creation failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

actionsCommand
  .command("checkout")
  .description("Copy an attested active plugin to a separate agent-editable draft")
  .argument("<id>", "Active executable plugin id")
  .argument("<directory>", "New draft directory (must not already exist)")
  .option("--json", "Output as JSON")
  .action(async (id: string, directory: string, options) => {
    try {
      const checkedOut = await checkoutExecutablePluginDraft({
        id,
        pluginDir: resolve(directory),
      });
      const result = { checkedOut: true, ...checkedOut };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(`Checked out ${checkedOut.id}@${checkedOut.version} to ${checkedOut.pluginDir}.`);
        console.log(`Edit it, then run: clash action validate ${checkedOut.pluginDir}`);
      }
    } catch (error) {
      console.error(`Plugin checkout failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

actionsCommand
  .command("validate")
  .description("Validate an agent-edited executable plugin draft and run all declared contracts")
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      const validated = await validateExecutablePluginDraft(pluginDir);
      const result = {
        valid: true,
        id: validated.package.id,
        version: validated.package.manifest.version ?? "0.0.0",
        path: pluginDir,
        contractTests: validated.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Validated ${result.id}@${result.version}: `
            + `${result.contractTests.passed} contract test(s) passed.`,
        );
      }
    } catch (error) {
      console.error(`Plugin draft validation failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

actionsCommand
  .command("activate")
  .description("Validate, contract-test, approve capabilities, and atomically activate a plugin draft")
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("-y, --yes", "Approve requested capability increases without an interactive prompt")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      const activated = await activateExecutablePluginDraft({
        pluginDir,
        approvePermissionIncrease: options.yes
          ? async () => true
          : async (diff) => confirm(
              `The draft requests new capabilities:\n${formatPermissionUpgrade(diff)}\n`
                + "Approve and activate? [y/N] ",
            ),
      });
      const manifest = JSON.parse(
        await readFileAsync(join(activated.targetDir, "manifest.json"), "utf8"),
      ) as { id: string; version?: string };
      const result = {
        activated: true,
        id: manifest.id,
        version: manifest.version ?? "0.0.0",
        path: activated.targetDir,
        rollbackPath: activated.rollbackDir,
        contractTests: activated.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Activated ${result.id}@${result.version}; `
            + `${result.contractTests.passed} contract test(s) passed. Bridge will hot-reload it.`,
        );
      }
    } catch (error) {
      console.error(`Plugin draft activation failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── install ──────────────────────────────────────────

actionsCommand
  .command("install")
  .description(
    "Install an action. Two modes:\n" +
      "  clash action install <id>                                  fetch from server registry → $CLASH_HOME/actions/<id>/\n" +
      "  clash action install --project <id> --repo owner/repo      register a project-level worker action via Loro"
  )
  .argument("[id]", "Action id to fetch from the server registry")
  .option("--project <id>", "Project ID (for --repo / --url Loro register flow)")
  .option("--repo <owner/repo>", "GitHub repo (e.g. user/style-transfer-action)")
  .option("--url <workerUrl>", "Direct CF Worker URL for author-deployed actions")
  .option("--json", "Output as JSON")
  .action(async (id: string | undefined, options) => {
    // ─── New flow: install <id> → write package to $CLASH_HOME/actions/<id>/ ───
    //
    // This is the path the task brief specifies. The CLI hits
    // GET /api/v1/actions/:id/package, decodes the base64 file contents,
    // and writes them to the bridge's actions dir. The bridge's
    // ActionsHost fs.watch picks up the new manifest within ~500ms and
    // spawns the python subprocess — no daemon restart needed.
    if (id && !options.repo && !options.url) {
      await installFromRegistry(id, options);
      return;
    }
    // If a project-level register was explicitly requested, ensure
    // --project is supplied (commander can't enforce a conditional
    // requirement, hence the manual check).
    if ((options.repo || options.url) && !options.project) {
      console.error("--project <id> is required when using --repo or --url");
      process.exit(1);
    }
    if (!id && !options.repo && !options.url) {
      console.error(
        "Provide an action id (e.g. `clash action install grid-split`)\n" +
          "or --repo / --url for the project-level register flow."
      );
      process.exit(1);
    }

    let manifest: any;

    if (options.url) {
      // Mode A: Direct worker URL — fetch manifest from the worker
      try {
        const resp = await fetch(options.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "manifest" }),
        });
        if (resp.ok) {
          manifest = await resp.json();
        }
      } catch {
        // Worker doesn't support manifest endpoint — require manual info
      }

      if (!manifest) {
        console.error(
          "Could not fetch manifest from worker URL. Provide --repo to fetch action.json from GitHub."
        );
        process.exit(1);
      }

      manifest.runtime = "worker";
      manifest.workerUrl = options.url;
    } else if (options.repo) {
      // Fetch action.json from GitHub
      const [owner, repo] = options.repo.includes("/")
        ? options.repo.split("/")
        : [null, null];
      if (!owner || !repo) {
        console.error("Invalid repo format. Use: owner/repo");
        process.exit(1);
      }

      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/action.json`;
      const resp = await fetch(rawUrl);
      if (!resp.ok) {
        console.error(`Failed to fetch action.json from ${rawUrl} (${resp.status})`);
        process.exit(1);
      }
      manifest = await resp.json();
    } else {
      console.error("Provide --repo or --url");
      process.exit(1);
    }

    // Validate required fields
    const parsedManifest = CustomActionDefinitionSchema.safeParse(manifest);
    if (!parsedManifest.success) {
      console.error(`Invalid action manifest: ${parsedManifest.error.message}`);
      process.exit(1);
    }
    manifest = parsedManifest.data;

    // Register in project's Loro customActions map via WebSocket
    const client = await connectToProject(options.project);
    try {
      // Send register message (ProjectRoom handles this)
      const ws = (client as any).ws;
      if (ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            type: "register_custom_actions",
            actions: [
              {
                id: manifest.id,
                name: manifest.name,
                description: manifest.description || "",
                parameters: manifest.parameters || [],
                outputType: manifest.outputType || "image",
                icon: manifest.icon || "",
                color: manifest.color || "",
                runtime: manifest.runtime || "worker",
                version: manifest.version || "0.0.0",
                author: manifest.author || "",
                repository: manifest.repository || options.repo || "",
                workerUrl: manifest.workerUrl || options.url || "",
                secrets: manifest.secrets || [],
                model: manifest.model,
                pluginBinding: manifest.pluginBinding,
                pluginPermissions: manifest.pluginPermissions,
                tags: manifest.tags || [],
              },
            ],
          })
        );
        // Wait for Loro sync
        await new Promise((r) => setTimeout(r, 500));
      }

      if (isJsonMode(options)) {
        printJson({ installed: true, actionId: manifest.id, runtime: manifest.runtime });
      } else {
        console.log(`Installed action: ${manifest.name} (${manifest.id})`);
        console.log(`  Runtime:  ${manifest.runtime || "worker"}`);
        console.log(`  Output:   ${manifest.outputType}`);
        if (manifest.workerUrl) console.log(`  Worker:   ${manifest.workerUrl}`);
        if (manifest.secrets?.length) {
          console.log(`  Requires: ${manifest.secrets.map((s: any) => s.id).join(", ")}`);
          console.log(customActionSecretHint(manifest.runtime));
        }
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── list ─────────────────────────────────────────────

actionsCommand
  .command("list")
  .description(
    "List actions. Without --local, lists actions registered in a project " +
      "(requires --project). With --local, lists packages installed under $CLASH_HOME/actions/."
  )
  .option("--project <id>", "Project ID (omit when using --local)")
  .option("--local", "List packages installed locally under $CLASH_HOME/actions/")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    if (options.local) {
      const installed = readLocalInstalls();
      if (isJsonMode(options)) {
        printJson(installed);
      } else if (installed.length === 0) {
        console.log(`No local actions installed (looked in ${localActionsDir()}).`);
        console.log("Install one with: clash action install <id>");
      } else {
        for (const a of installed) {
          const version = a.version ? `@${a.version}` : "";
          console.log(`  🖥  ${(a.name ?? a.id).padEnd(25)} ${a.id}${version}`);
        }
        console.log(`\n${installed.length} local action(s) at ${localActionsDir()}`);
      }
      return;
    }

    if (!options.project) {
      console.error("--project <id> is required (or pass --local to list local installs)");
      process.exit(1);
    }
    const client = await connectToProject(options.project);
    try {
      const actionsMap = client.doc.getMap("customActions");
      const actions: any[] = [];
      for (const [, raw] of actionsMap.entries()) {
        actions.push(raw);
      }

      if (isJsonMode(options)) {
        printJson(actions);
      } else if (actions.length === 0) {
        console.log("No actions installed. Use `clash action install` to add one.");
      } else {
        for (const a of actions) {
          const runtime = (a as any).runtime === "worker" ? "☁️" : "🖥";
          console.log(`  ${runtime} ${(a as any).name?.padEnd(25)} ${(a as any).id}`);
        }
        console.log(`\n${actions.length} action(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── uninstall ────────────────────────────────────────
//
// Removes a locally-installed action package (rm -rf $CLASH_HOME/actions/<id>).
// The bridge's fs.watch picks up the deletion within ~500ms and SIGTERMs
// the running subprocess for that action — no daemon restart needed.

actionsCommand
  .command("uninstall")
  .description("Remove a locally-installed action package from $CLASH_HOME/actions/")
  .argument("<id>", "Action id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    const dir = join(localActionsDir(), id);
    if (!existsSync(dir)) {
      console.error(`Not installed: ${dir}`);
      process.exit(1);
    }

    if (!options.yes) {
      const ok = await confirm(`Remove ${dir}? [y/N] `);
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }

    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to remove ${dir}: ${(e as Error).message}`);
      process.exit(1);
    }

    if (isJsonMode(options)) {
      printJson({ uninstalled: true, id, path: dir });
    } else {
      console.log(`Uninstalled ${id} from ${dir}. Bridge will SIGTERM the subprocess.`);
    }
  });

actionsCommand
  .command("rollback")
  .description("Restore the newest retained local action/plugin version")
  .argument("<id>", "Action or plugin id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    if (!options.yes) {
      const ok = await confirm(`Roll back ${id} to its newest retained version? [y/N] `);
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }
    try {
      const restored = await rollbackDownloadedActionPackage(localActionsDir(), id);
      if (isJsonMode(options)) printJson({ rolledBack: true, id, ...restored });
      else console.log(`Rolled back ${id} to ${restored.version}. Bridge will hot-reload it.`);
    } catch (error) {
      console.error(`Failed to roll back ${id}: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── remove ───────────────────────────────────────────

actionsCommand
  .command("remove")
  .description("Remove an action from a project")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--action <id>", "Action ID to remove")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const ws = (client as any).ws;
      if (ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            type: "unregister_custom_actions",
            actionIds: [options.action],
          })
        );
        await new Promise((r) => setTimeout(r, 500));
      }

      if (isJsonMode(options)) {
        printJson({ removed: true, actionId: options.action });
      } else {
        console.log(`Removed action: ${options.action}`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── search ───────────────────────────────────────────

actionsCommand
  .command("search")
  .description("Search community actions from the awesome-list registry")
  .argument("<query>", "Search query")
  .option("--tag <tag>", "Filter by tag")
  .option("--json", "Output as JSON")
  .action(async (query: string, options) => {
    try {
      const resp = await fetch(REGISTRY_URL);
      if (!resp.ok) {
        console.error(`Failed to fetch registry (${resp.status}). Check your network.`);
        process.exit(1);
      }

      const registry = (await resp.json()) as {
        actions: Array<{
          id: string;
          name: string;
          description?: string;
          repository?: string;
          runtime?: string;
          outputType?: string;
          tags?: string[];
          author?: string;
        }>;
      };

      let results = registry.actions;

      // Filter by tag
      if (options.tag) {
        results = results.filter((a) =>
          a.tags?.some((t) => t.toLowerCase() === options.tag.toLowerCase())
        );
      }

      // Search by query
      const q = query.toLowerCase();
      results = results.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.description || "").toLowerCase().includes(q) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(q))
      );

      if (isJsonMode(options)) {
        printJson(results);
      } else if (results.length === 0) {
        console.log(`No actions found for "${query}".`);
      } else {
        for (const a of results) {
          const runtime = a.runtime === "worker" ? "☁️" : "🖥";
          console.log(`  ${runtime} ${a.name}`);
          console.log(`    ${a.id} · ${a.outputType || "image"} · ${a.author || "unknown"}`);
          if (a.description) console.log(`    ${a.description}`);
          if (a.repository) console.log(`    → ${a.repository}`);
          console.log();
        }
        console.log(`${results.length} result(s)`);
      }
    } catch (e) {
      console.error("Failed to search registry:", e);
      process.exit(1);
    }
  });

// ─── helpers (registry-install flow) ──────────────────

/**
 * Fetch a package from the server registry and unpack it into
 * `$CLASH_HOME/actions/<id>/`. The bridge's ActionsHost fs.watch picks
 * up the new manifest within ~500ms and spawns the python subprocess —
 * no daemon restart needed.
 *
 * If a manifest already exists at the same version, skip the write so
 * idempotent install calls do not churn the watcher.
 */
async function installFromRegistry(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const url = `${serverUrl}/api/v1/actions/${encodeURIComponent(id)}/package`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    console.error(`Failed to reach server ${serverUrl}: ${(e as Error).message}`);
    process.exit(1);
  }
  if (resp.status === 404) {
    const marketplaceInstall = await tryInstallLocalMarketplaceAction({
      packageId: id,
      serverUrl,
      apiKey,
    }).catch((error) => {
      console.error(`Failed to install local marketplace action: ${(error as Error).message}`);
      process.exit(1);
    });
    if (marketplaceInstall) {
      if (isJsonMode(options)) {
        printJson(marketplaceInstall);
      } else {
        const verb = marketplaceInstall.installed ? "Installed" : "Already installed";
        console.log(`${verb} ${marketplaceInstall.actionId} from ${marketplaceInstall.packageId}.`);
        console.log(`Path: ${marketplaceInstall.targetDir}`);
      }
      return;
    }
    console.error(`Unknown action: ${id}`);
    process.exit(1);
  }
  if (!resp.ok) {
    console.error(`Server returned ${resp.status} ${resp.statusText} for ${url}`);
    const body = await resp.text().catch(() => "");
    if (body) console.error(body);
    process.exit(1);
  }

  let pkg: ValidatedDownloadedActionPackage;
  try {
    pkg = validateDownloadedActionPackage(await resp.json());
  } catch (error) {
    console.error(`Invalid action package: ${(error as Error).message}`);
    process.exit(1);
  }
  if (pkg.id !== id) {
    console.error(`Server returned a package with mismatched id (${pkg.id} != ${id})`);
    process.exit(1);
  }

  const targetDir = join(localActionsDir(), id);
  const manifestPath = join(targetDir, "manifest.json");
  const newVersion = pkg.manifest.version ?? "0.0.0";
  let existingManifest: unknown;

  // Idempotent reinstall: if the same version is already on disk, no-op.
  if (existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        version?: string;
      };
      existingManifest = existing;
      if (existing.version === newVersion) {
        if (isJsonMode(options)) {
          printJson({
            installed: false,
            id,
            version: newVersion,
            path: targetDir,
            reason: "already-installed",
          });
        } else {
          console.log(`${id}@${newVersion} already installed at ${targetDir}.`);
        }
        return;
      }
    } catch {
      // Existing manifest unreadable — fall through and overwrite.
    }
  }

  const permissionUpgrade = permissionUpgradeForDownloadedPackage(pkg, existingManifest);
  if (permissionUpgrade?.requiresApproval) {
    const ok = await confirm(
      `${pkg.id}@${newVersion} requests new capabilities:\n`
        + `${formatPermissionUpgrade(permissionUpgrade)}\nApprove and activate? [y/N] `,
    );
    if (!ok) {
      console.error("Permission increase was not approved; no files were changed.");
      process.exit(1);
    }
  }

  const activated = await activateDownloadedActionPackage(pkg);

  if (isJsonMode(options)) {
    printJson({
      installed: true,
      id,
      version: newVersion,
      path: activated.targetDir,
      files: Object.keys(pkg.files),
      rollbackPath: activated.rollbackDir,
    });
  } else {
    console.log(`Installed ${id}@${newVersion} to ${targetDir}.`);
    console.log(
      `Bridge daemon auto-reloads via fs.watch — no restart needed. ` +
        `(If the daemon predates the watcher, restart it manually.)`
    );
  }
}

/** Read every manifest.json under $CLASH_HOME/actions/ for `list --local`. */
function readLocalInstalls(): Array<{
  id: string;
  name?: string;
  version?: string;
  dir: string;
}> {
  const actionsDir = localActionsDir();
  if (!existsSync(actionsDir)) return [];
  const out: Array<{ id: string; name?: string; version?: string; dir: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(actionsDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const dir = join(actionsDir, entry);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        id?: string;
        name?: string;
        version?: string;
      };
      out.push({ id: m.id ?? entry, name: m.name, version: m.version, dir });
    } catch {
      // Bad manifest — surface as id-from-dir with no metadata so the
      // user can at least see something to uninstall.
      out.push({ id: entry, dir });
    }
  }
  return out;
}

/** Tiny readline-based y/N prompt — avoids pulling in a dep for this. */
async function confirm(question: string): Promise<boolean> {
  // If stdin isn't a TTY (e.g. piped automation), require -y explicitly
  // rather than silently defaulting to "yes".
  if (!process.stdin.isTTY) return false;
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    const onData = (chunk: Buffer) => {
      const ans = chunk.toString("utf-8").trim().toLowerCase();
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      resolve(ans === "y" || ans === "yes");
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}
