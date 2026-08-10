import { Command } from "commander";
import { readFileSync } from "node:fs";

import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";

/**
 * A provider account is a person's own key, connected by that person.
 *
 * It had no command. The only way in was a PATCH whose body must carry a token first read back out
 * of a GET — the host's concurrency handshake, which no workflow should ever have to see. In
 * practice that meant the desktop app or nothing.
 */

interface ProviderAccountRow {
  id?: string;
  providerId: string;
  upstreamId?: string;
  region?: string;
  label?: string;
  enabled?: boolean;
  configuredCredentials?: string[];
  readToken?: string;
}

interface ProviderAccountsResponse {
  providers: ProviderAccountRow[];
  readToken: string;
}

/** Hosts that answer for the same upstream under separate logins. */
const REGIONS: Record<string, string[]> = {
  minimax: ["global", "cn"],
};

async function currentAccounts(): Promise<ProviderAccountsResponse> {
  return await apiJson<ProviderAccountsResponse>("/api/v1/model-providers");
}

/**
 * The key, from the least exposed source available.
 *
 * An argument is the worst of the three: the shell records it in history, and on a shared machine
 * it is visible in the process list to anyone who runs `ps` while the command is in flight. It
 * stays supported because scripts need it, but a file and stdin come first in the documentation.
 */
function resolveApiKey(options: { apiKey?: string; apiKeyFile?: string }): string {
  if (options.apiKeyFile) {
    const key = readFileSync(options.apiKeyFile, "utf8").trim();
    if (!key) throw new Error(`No API key found in ${options.apiKeyFile}.`);
    return key;
  }
  if (options.apiKey) return options.apiKey.trim();
  if (!process.stdin.isTTY) {
    const key = readFileSync(0, "utf8").trim();
    if (key) return key;
  }
  throw new Error(
    "No API key given. Pass --api-key-file <path>, pipe the key on stdin, or use --api-key.",
  );
}

function assertRegion(providerId: string, region: string | undefined): void {
  const known = REGIONS[providerId];
  if (!region) return;
  if (!known) {
    throw new Error(`Provider ${providerId} answers on one host; --region does not apply to it.`);
  }
  if (!known.includes(region)) {
    throw new Error(
      `Provider ${providerId} has no region "${region}". Known regions: ${known.join(", ")}.`,
    );
  }
}

/**
 * Writes the account list back, carrying the token the host just issued.
 *
 * The read-then-write pair is the host's rule for detecting a concurrent edit, and doing it here is
 * what keeps it out of the operator's hands. Skipping it would not be simpler, only unchecked.
 */
async function writeAccounts(providers: unknown[], readToken: string): Promise<unknown> {
  return await apiJson("/api/v1/model-providers", {
    method: "PATCH",
    body: JSON.stringify({ providers, readToken }),
    headers: { "content-type": "application/json" },
  });
}

export const providersCommand = new Command("providers")
  .alias("provider")
  .description("Connect the accounts that pay for generation");

/** Kept as a function so the entrypoint registers commands the same way for every family. */
export function registerProviderCommands(program: Command): void {
  program.addCommand(providersCommand);
}

{
  const providers = providersCommand;

  providers
    .command("list")
    .description("Show connected provider accounts")
    .option("--json", "Machine-readable output")
    .action(async (options: { json?: boolean }) => {
      const current = await currentAccounts();
      const rows = current.providers.map((provider) => ({
        id: provider.id ?? provider.providerId,
        provider: provider.providerId,
        upstream: provider.upstreamId ?? provider.providerId,
        ...(provider.region ? { region: provider.region } : {}),
        enabled: provider.enabled !== false,
        credentials: provider.configuredCredentials ?? [],
      }));
      if (isJsonMode(options)) {
        printJson({ providers: rows });
        return;
      }
      if (rows.length === 0) {
        console.log("No provider accounts connected. Add one with: clash providers add <provider>");
        return;
      }
      for (const row of rows) {
        const region = "region" in row ? `  region=${row.region}` : "";
        const creds = row.credentials.length > 0 ? `  [${row.credentials.join(", ")}]` : "  [no credentials]";
        console.log(`${row.enabled ? "*" : " "} ${row.id}  ${row.provider}${region}${creds}`);
      }
    });

  providers
    .command("add <providerId>")
    .description("Connect an account for a provider")
    .option("--api-key-file <path>", "Read the key from a file (preferred)")
    .option("--api-key <key>", "The key itself; recorded by shell history and visible in ps")
    .option("--region <region>", "Which host this account belongs to, where the upstream has more than one")
    .option("--upstream <upstreamId>", "Upstream service, when it differs from the provider id")
    .option("--label <label>", "A name for this account")
    .option("--id <accountId>", "Account id, for holding more than one key per provider")
    .option("--json", "Machine-readable output")
    .action(async (providerId: string, options: {
      apiKey?: string;
      apiKeyFile?: string;
      region?: string;
      upstream?: string;
      label?: string;
      id?: string;
      json?: boolean;
    }) => {
      assertRegion(providerId, options.region);
      const apiKey = resolveApiKey(options);
      const current = await currentAccounts();
      const accountId = options.id ?? `${providerId}-primary`;
      // Existing accounts are sent back untouched. The endpoint replaces the whole set, so leaving
      // one out is how a working account silently disappears while adding another.
      const kept = current.providers
        .filter((provider) => (provider.id ?? provider.providerId) !== accountId)
        .map((provider) => ({
          id: provider.id ?? provider.providerId,
          providerId: provider.providerId,
          ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
          ...(provider.region ? { region: provider.region } : {}),
          ...(provider.label ? { label: provider.label } : {}),
          enabled: provider.enabled !== false,
        }));
      const added = {
        id: accountId,
        providerId,
        ...(options.upstream ? { upstreamId: options.upstream } : {}),
        ...(options.region ? { region: options.region } : {}),
        ...(options.label ? { label: options.label } : {}),
        enabled: true,
        credentials: { apiKey },
      };
      await writeAccounts([...kept, added], current.readToken);
      if (isJsonMode(options)) {
        printJson({ added: accountId, providerId, ...(options.region ? { region: options.region } : {}) });
        return;
      }
      console.log(`Connected ${accountId} (${providerId}${options.region ? `, ${options.region}` : ""}).`);
    });

  providers
    .command("remove <accountId>")
    .description("Disconnect a provider account")
    .option("--json", "Machine-readable output")
    .action(async (accountId: string, options: { json?: boolean }) => {
      const current = await currentAccounts();
      const remaining = current.providers
        .filter((provider) => (provider.id ?? provider.providerId) !== accountId)
        .map((provider) => ({
          id: provider.id ?? provider.providerId,
          providerId: provider.providerId,
          ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
          ...(provider.region ? { region: provider.region } : {}),
          enabled: provider.enabled !== false,
        }));
      if (remaining.length === current.providers.length) {
        throw new Error(`No provider account named ${accountId}.`);
      }
      await writeAccounts(remaining, current.readToken);
      if (isJsonMode(options)) {
        printJson({ removed: accountId });
        return;
      }
      console.log(`Disconnected ${accountId}.`);
    });
}
