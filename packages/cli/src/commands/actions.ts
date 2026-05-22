import { Command } from "commander";
import WebSocket from "ws";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LoroSyncClient } from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";

const REGISTRY_URL = "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

/**
 * Directory that the bridge daemon's ActionsHost watches. Installing an
 * action means writing manifest.json + source files into a subdir here;
 * the bridge picks it up via fs.watch and spawns the python subprocess.
 */
const ACTIONS_DIR = join(homedir(), ".clash", "actions");

/** Shape of the GET /api/v1/actions/:id/package response. */
interface ActionPackage {
  id: string;
  manifest: Record<string, unknown> & { id: string; version?: string };
  /** path → base64-encoded contents. */
  files: Record<string, string>;
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
  .description("Manage canvas actions (install, list, search)");

// ─── install ──────────────────────────────────────────

actionsCommand
  .command("install")
  .description(
    "Install an action. Two modes:\n" +
      "  clash action install <id>                                  fetch from server registry → ~/.clash/actions/<id>/\n" +
      "  clash action install --project <id> --repo owner/repo      register a project-level worker action via Loro"
  )
  .argument("[id]", "Action id to fetch from the server registry")
  .option("--force", "Reinstall even if the same version is already installed")
  .option("--project <id>", "Project ID (for --repo / --url Loro register flow)")
  .option("--repo <owner/repo>", "GitHub repo (e.g. user/style-transfer-action)")
  .option("--url <workerUrl>", "Direct CF Worker URL for author-deployed actions")
  .option("--json", "Output as JSON")
  .action(async (id: string | undefined, options) => {
    // ─── New flow: install <id> → write package to ~/.clash/actions/<id>/ ───
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
    if (!manifest.id || !manifest.name) {
      console.error("Invalid action manifest: missing 'id' or 'name'");
      process.exit(1);
    }

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
          console.log(`  → Set variables with: clash vars set <KEY>`);
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
      "(requires --project). With --local, lists packages installed under ~/.clash/actions/."
  )
  .option("--project <id>", "Project ID (omit when using --local)")
  .option("--local", "List packages installed locally under ~/.clash/actions/")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    if (options.local) {
      const installed = readLocalInstalls();
      if (isJsonMode(options)) {
        printJson(installed);
      } else if (installed.length === 0) {
        console.log(`No local actions installed (looked in ${ACTIONS_DIR}).`);
        console.log("Install one with: clash action install <id>");
      } else {
        for (const a of installed) {
          const version = a.version ? `@${a.version}` : "";
          console.log(`  🖥  ${(a.name ?? a.id).padEnd(25)} ${a.id}${version}`);
        }
        console.log(`\n${installed.length} local action(s) at ${ACTIONS_DIR}`);
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
// Removes a locally-installed action package (rm -rf ~/.clash/actions/<id>).
// The bridge's fs.watch picks up the deletion within ~500ms and SIGTERMs
// the running subprocess for that action — no daemon restart needed.

actionsCommand
  .command("uninstall")
  .description("Remove a locally-installed action package from ~/.clash/actions/")
  .argument("<id>", "Action id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    const dir = join(ACTIONS_DIR, id);
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
 * `~/.clash/actions/<id>/`. The bridge's ActionsHost fs.watch picks
 * up the new manifest within ~500ms and spawns the python subprocess —
 * no daemon restart needed.
 *
 * If a manifest already exists at the same version and `--force` is
 * not passed, we skip the write so we don't churn the watcher for
 * idempotent reinstall calls.
 */
async function installFromRegistry(
  id: string,
  options: { force?: boolean; json?: boolean }
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
    console.error(`Unknown action: ${id}`);
    process.exit(1);
  }
  if (!resp.ok) {
    console.error(`Server returned ${resp.status} ${resp.statusText} for ${url}`);
    const body = await resp.text().catch(() => "");
    if (body) console.error(body);
    process.exit(1);
  }

  const pkg = (await resp.json()) as ActionPackage;
  if (!pkg.manifest?.id || pkg.manifest.id !== id) {
    console.error(`Server returned a package with mismatched id (${pkg.manifest?.id} != ${id})`);
    process.exit(1);
  }

  const targetDir = join(ACTIONS_DIR, id);
  const manifestPath = join(targetDir, "manifest.json");
  const newVersion = pkg.manifest.version ?? "0.0.0";

  // Idempotent reinstall: if the same version is already on disk, no-op
  // unless --force. The watcher would otherwise see a manifest write +
  // restart the subprocess for no real reason.
  if (existsSync(manifestPath) && !options.force) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        version?: string;
      };
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
          console.log(
            `${id}@${newVersion} already installed at ${targetDir}. ` +
              `Pass --force to reinstall.`
          );
        }
        return;
      }
    } catch {
      // Existing manifest unreadable — fall through and overwrite.
    }
  }

  mkdirSync(targetDir, { recursive: true });
  // Manifest last so the watcher only treats the install as "ready"
  // once every referenced file is on disk (entrypoint validation in
  // the bridge looks for the entrypoint file alongside manifest.json).
  for (const [relPath, b64] of Object.entries(pkg.files)) {
    const dest = join(targetDir, relPath);
    // Refuse path-traversal: relPath must stay inside targetDir.
    if (!dest.startsWith(targetDir + "/") && dest !== targetDir) {
      console.error(`Refusing suspicious file path in package: ${relPath}`);
      process.exit(1);
    }
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, Buffer.from(b64, "base64"));
  }
  writeFileSync(manifestPath, JSON.stringify(pkg.manifest, null, 2) + "\n");

  if (isJsonMode(options)) {
    printJson({
      installed: true,
      id,
      version: newVersion,
      path: targetDir,
      files: Object.keys(pkg.files),
    });
  } else {
    console.log(`Installed ${id}@${newVersion} to ${targetDir}.`);
    console.log(
      `Bridge daemon auto-reloads via fs.watch — no restart needed. ` +
        `(If the daemon predates the watcher, restart it manually.)`
    );
  }
}

/** Read every manifest.json under ~/.clash/actions/ for `list --local`. */
function readLocalInstalls(): Array<{
  id: string;
  name?: string;
  version?: string;
  dir: string;
}> {
  if (!existsSync(ACTIONS_DIR)) return [];
  const out: Array<{ id: string; name?: string; version?: string; dir: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(ACTIONS_DIR);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const dir = join(ACTIONS_DIR, entry);
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
