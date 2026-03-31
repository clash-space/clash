import { Command } from "commander";
import WebSocket from "ws";
import { LoroSyncClient } from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";

const REGISTRY_URL = "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

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
  .description("Install an action from a GitHub repo or URL")
  .requiredOption("--project <id>", "Project ID to install into")
  .option("--repo <owner/repo>", "GitHub repo (e.g. user/style-transfer-action)")
  .option("--url <workerUrl>", "Direct CF Worker URL for author-deployed actions")
  .option("--json", "Output as JSON")
  .action(async (options) => {
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
  .description("List installed actions in a project")
  .requiredOption("--project <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
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
