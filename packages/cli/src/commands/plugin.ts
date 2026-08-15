import { pluginIdSchema } from "@clash/shared-types";
import { Command } from "commander";
import { resolve } from "node:path";

import { getServerUrl } from "../lib/config";
import { assertDraftOutsideManagedStorage } from "../lib/plugin-draft-location";
import { isJsonMode, printJson } from "../lib/output";
import {
  activateExecutablePluginDraft,
  checkoutExecutablePluginDraft,
  createLocalPluginHostRequest,
  rollbackDownloadedActionPackage,
  scaffoldExecutablePluginDraft,
  tryInstallLocalMarketplaceAction,
  validateExecutablePluginDraft,
} from "../lib/plugin-lifecycle";

async function requestLocalPluginHost<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return createLocalPluginHostRequest({ serverUrl: getServerUrl() })(
    path,
    init,
  );
}

export const pluginCommand = new Command("plugin").description(
  "Create, validate, activate, and manage plugins",
);

pluginCommand
  // `create`, not `init`. The directory must not already exist, so this makes a new thing rather
  // than initialising the one you are standing in -- the distinction `npm init` and `npm create`
  // draw, and `cargo init` and `cargo new` after them.
  .command("create")
  .description(
    "Create a complete agent-editable plugin draft with a Card, handler, and contract",
  )
  .argument(
    "<directory>",
    "New plugin draft directory (must not already exist)",
  )
  .requiredOption("--id <id>", "Stable plugin and export id")
  .option("--name <name>", "User-facing plugin and Card name")
  .option(
    "--kind <kind>",
    "action, provider-projector, or provider-executor",
    "action",
  )
  .option("--lang <language>", "ts or python", "ts")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    try {
      assertDraftOutsideManagedStorage(directory);
      if (options.lang !== "ts" && options.lang !== "python") {
        throw new Error(
          `Unsupported --lang ${String(options.lang)}; expected ts or python.`,
        );
      }
      const created = await scaffoldExecutablePluginDraft({
        pluginDir: resolve(directory),
        id: options.id,
        name: options.name,
        kind: options.kind,
        language: options.lang,
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
          `Created ${options.id} at ${created.pluginDir}; ` +
            `${created.contractTests.passed} contract test(s) passed.`,
        );
        console.log(
          `Edit the Card and handler, then run: clash plugin activate ${created.pluginDir}`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft creation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

pluginCommand
  .command("checkout")
  .description(
    "Copy an attested active plugin to a separate agent-editable draft",
  )
  .argument("<id>", "Active executable plugin id")
  .argument("<directory>", "New draft directory (must not already exist)")
  .option("--json", "Output as JSON")
  .action(async (id: string, directory: string, options) => {
    try {
      assertDraftOutsideManagedStorage(directory);
      const checkedOut = await checkoutExecutablePluginDraft({
        id,
        pluginDir: resolve(directory),
      });
      const result = { checkedOut: true, ...checkedOut };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Checked out ${checkedOut.id}@${checkedOut.version} to ${checkedOut.pluginDir}.`,
        );
        console.log(
          `Edit it, then run: clash plugin validate ${checkedOut.pluginDir}`,
        );
      }
    } catch (error) {
      console.error(`Plugin checkout failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command("validate")
  .description(
    "Validate an agent-edited executable plugin draft and run all declared contracts",
  )
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      assertDraftOutsideManagedStorage(pluginDir);
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
          `Validated ${result.id}@${result.version}: ` +
            `${result.contractTests.passed} contract test(s) passed.`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft validation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

pluginCommand
  .command("activate")
  .description(
    "Validate, contract-test, and atomically activate a plugin draft",
  )
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      assertDraftOutsideManagedStorage(pluginDir);
      const activated = await activateExecutablePluginDraft({
        pluginDir,
      });
      const result = {
        activated: true,
        id: activated.id,
        version: activated.version,
        path: activated.targetDir,
        rollbackPath: activated.rollbackDir,
        contractTests: activated.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Activated ${result.id}@${result.version}; ` +
            `${result.contractTests.passed} contract test(s) passed. The local host will hot-reload it.`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft activation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

// ─── install ──────────────────────────────────────────

pluginCommand
  .command("install")
  .description("Install an executable plugin from the local host marketplace")
  .argument("<id>", "Marketplace plugin package id")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    await installFromMarketplace(id, options);
  });

// ─── list ─────────────────────────────────────────────

pluginCommand
  .command("list")
  .description("List executable plugins active in the local host")
  .option(
    "--local",
    "Compatibility flag; plugin state is always owned by the local host",
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const installed = await requestLocalPluginHost<
      Array<{
        id: string;
        name?: string;
        version?: string;
        targetDir: string;
        drifted: boolean;
      }>
    >("/api/v1/local/plugins");
    if (isJsonMode(options)) {
      printJson(installed);
    } else if (installed.length === 0) {
      console.log("No executable plugins are active in the local host.");
      console.log("Install one with: clash plugin install <id>");
    } else {
      for (const plugin of installed) {
        const version = plugin.version ? `@${plugin.version}` : "";
        const drift = plugin.drifted
          ? "  ⚠ differs from its activation receipt"
          : "";
        console.log(
          `  🖥  ${(plugin.name ?? plugin.id).padEnd(25)} ${plugin.id}${version}${drift}`,
        );
      }
      if (installed.some((plugin) => plugin.drifted)) {
        console.log(
          "\nReactivate a drifted plugin before editing it: clash plugin activate <dir>",
        );
      }
      console.log(`\n${installed.length} local plugin(s)`);
    }
  });

// ─── uninstall ────────────────────────────────────────
//
// local-api owns live plugin storage and moves removed packages to its trash.

pluginCommand
  .command("uninstall")
  .description("Remove a locally-installed plugin package from the local host")
  .argument("<id>", "Plugin id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    if (!options.yes) {
      const ok = await confirm(`Remove ${id} from the local host? [y/N] `);
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }

    let removed: { id: string; removed: boolean; trashDir?: string };
    try {
      removed = await requestLocalPluginHost(
        `/api/v1/local/plugins/${encodeURIComponent(pluginIdSchema.parse(id))}`,
        { method: "DELETE" },
      );
    } catch (e) {
      console.error(`Failed to remove ${id}: ${(e as Error).message}`);
      process.exit(1);
    }

    if (isJsonMode(options)) {
      printJson({ uninstalled: removed.removed, ...removed });
    } else {
      console.log(
        removed.removed ? `Uninstalled ${id}.` : `${id} is not installed.`,
      );
    }
  });

pluginCommand
  .command("rollback")
  .description("Restore the newest retained local plugin version")
  .argument("<id>", "Plugin id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    if (!options.yes) {
      const ok = await confirm(
        `Roll back ${id} to its newest retained version? [y/N] `,
      );
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }
    try {
      const restored = await rollbackDownloadedActionPackage(id);
      if (isJsonMode(options)) printJson({ rolledBack: true, id, ...restored });
      else console.log(`Rolled back ${id} to ${restored.version}.`);
    } catch (error) {
      console.error(`Failed to roll back ${id}: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── helpers (local marketplace install flow) ─────────

/**
 * Ask local-api to install and attest a marketplace executable plugin. The CLI
 * never downloads legacy action source or writes the live plugin directory.
 */
async function installFromMarketplace(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const serverUrl = getServerUrl();
  const marketplaceInstall = await tryInstallLocalMarketplaceAction({
    packageId: id,
    serverUrl,
  }).catch((error) => {
    console.error(
      `Failed to install local marketplace plugin: ${(error as Error).message}`,
    );
    process.exit(1);
  });
  if (!marketplaceInstall) {
    console.error(`Unknown marketplace plugin: ${id}`);
    process.exit(1);
  }
  if (isJsonMode(options)) {
    printJson(marketplaceInstall);
  } else {
    const verb = marketplaceInstall.installed
      ? "Installed"
      : "Already installed";
    console.log(
      `${verb} ${marketplaceInstall.actionId} from ${marketplaceInstall.packageId}.`,
    );
    console.log(`Path: ${marketplaceInstall.targetDir}`);
  }
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
