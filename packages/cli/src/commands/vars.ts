import { Command } from "commander";
import { ACTION_PROVIDER_PRESETS } from "@clash/shared-types";
import { apiJson, apiFetch } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";
import * as readline from "readline";

export const varsCommand = new Command("vars")
  .description("Manage user variables (API keys for actions)");

// ─── set ──────────────────────────────────────────────

varsCommand
  .command("set")
  .description("Set a variable (prompts for value securely)")
  .argument("<key>", "Variable name (e.g. FAL_API_KEY)")
  .option("--value <value>", "Variable value (use stdin for security)")
  .option("--json", "Output as JSON")
  .action(async (key: string, options) => {
    let value = options.value;

    // If no --value flag, prompt for it
    if (!value) {
      value = await new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        process.stderr.write(`Enter value for ${key}: `);
        rl.question("", (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    if (!value) {
      console.error("Error: No value provided.");
      process.exit(1);
    }

    const data = await apiJson<{ ok: boolean; key: string }>(`/api/v1/vars/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`Variable set: ${key}`);
    }
  });

// ─── list ─────────────────────────────────────────────

varsCommand
  .command("list")
  .description("List configured variable keys")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ variables: Array<{ key: string; createdAt: number | null }> }>("/api/v1/vars");

    if (isJsonMode(options)) {
      printJson(data.variables);
    } else if (data.variables.length === 0) {
      console.log("No variables configured. Use `clash vars set <KEY>` to add one.");
    } else {
      for (const v of data.variables) {
        console.log(`  ${v.key.padEnd(30)} ✅ set`);
      }
      console.log(`\n${data.variables.length} variable(s)`);
    }
  });

// ─── providers ─────────────────────────────────────────

varsCommand
  .command("providers")
  .description("List built-in action provider variable keys")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const providers = Object.values(ACTION_PROVIDER_PRESETS).map((preset) => ({
      id: preset.id,
      label: preset.label,
      key: preset.defaultSecretId,
      description: preset.secretDescription,
      docsUrl: preset.docsUrl,
    }));

    if (isJsonMode(options)) {
      printJson(providers);
      return;
    }

    for (const provider of providers) {
      console.log(`  ${provider.label.padEnd(14)} ${provider.key}`);
    }
    console.log("\nSet one with: clash vars set <KEY>");
  });

// ─── delete ───────────────────────────────────────────

varsCommand
  .command("delete")
  .description("Delete a variable")
  .argument("<key>", "Variable name to delete")
  .option("--json", "Output as JSON")
  .action(async (key: string, options) => {
    const resp = await apiFetch(`/api/v1/vars/${encodeURIComponent(key)}`, { method: "DELETE" });
    await resp.text().catch(() => "");

    if (!resp.ok) {
      console.error(`Variable not found: ${key}`);
      process.exit(1);
    }

    if (isJsonMode(options)) {
      printJson({ deleted: true, key });
    } else {
      console.log(`Deleted: ${key}`);
    }
  });
