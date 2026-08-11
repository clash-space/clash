import { Command } from "commander";
import { readFileSync } from "node:fs";

import { apiJson } from "../lib/api";
import { getServerUrl } from "../lib/config";
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

/**
 * Which service issued this key, where a vendor runs more than one.
 *
 * Not a region. MiniMax's international and domestic services differ by geography, which made
 * `region` look right, but Google's are two products — and Agent Platform has real regions of its
 * own, which then had nowhere to go. Where the service runs is `--location`.
 */
const SERVICES: Record<string, string[]> = {
  minimax: ["global", "cn"],
  official: ["ai-studio", "agent-platform"],
};

async function currentAccounts(): Promise<ProviderAccountsResponse> {
  try {
    return await apiJson<ProviderAccountsResponse>("/api/v1/model-providers");
  } catch (error) {
    // A stopped host is an ordinary situation. Unhandled, it arrives as an AggregateError of
    // ECONNREFUSED entries and a Node stack, which reads like the CLI broke rather than like
    // something needs starting -- and the address matters, because discovery silently falls back
    // to the cloud gateway's port when no local daemon is found.
    if (error instanceof Error && /fetch failed|ECONNREFUSED/.test(`${error.message}${error.cause ?? ""}`)) {
      throw new Error(
        `The Clash host is not running at ${getServerUrl()}. Start the host, or run any local `
        + "command to start one automatically.",
      );
    }
    throw error;
  }
}

/**
 * The key, from the least exposed source available.
 *
 * An argument is the worst of the three: the shell records it in history, and on a shared machine
 * it is visible in the process list to anyone who runs `ps` while the command is in flight. It
 * stays supported because scripts need it, but a file and stdin come first in the documentation.
 */
/**
 * Collects a repeated `key=value` flag.
 *
 * Which credentials a provider needs is the provider's business, and a plugin may declare its own,
 * so a CLI with one flag per credential would be permanently one provider behind. It carries pairs
 * and lets the host validate — which the host already does, and is the only party that can.
 */
function collectPair(value: string, previous: Record<string, string>): Record<string, string> {
  const at = value.indexOf("=");
  if (at <= 0) {
    throw new Error(`Expected key=value, got "${value}".`);
  }
  return { ...previous, [value.slice(0, at)]: value.slice(at + 1) };
}

/** The same pairs, but the value is a path — for secrets that should not sit in shell history. */
function collectPairFile(value: string, previous: Record<string, string>): Record<string, string> {
  const at = value.indexOf("=");
  if (at <= 0) {
    throw new Error(`Expected key=path, got "${value}".`);
  }
  const key = value.slice(0, at);
  const contents = readFileSync(value.slice(at + 1), "utf8").trim();
  if (!contents) throw new Error(`No credential found in ${value.slice(at + 1)}.`);
  return { ...previous, [key]: contents };
}

function resolveApiKey(options: { apiKey?: string; apiKeyFile?: string }): string | undefined {
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
  // Not every provider has one. Kling authenticates with an access/secret pair and signs its own
  // token; demanding an apiKey there would make the generic --credential path unreachable for
  // exactly the providers it exists to serve.
  return undefined;
}

function assertService(providerId: string, service: string | undefined): void {
  const known = SERVICES[providerId];
  if (!service) return;
  if (!known) {
    throw new Error(`Provider ${providerId} runs one service; --service does not apply to it.`);
  }
  if (!known.includes(service)) {
    throw new Error(
      `Provider ${providerId} has no service "${service}". Known services: ${known.join(", ")}.`,
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
    .option("--service <service>", "Which of the vendor's services issued this key, where it runs more than one")
    .option("--upstream <upstreamId>", "Upstream service, when it differs from the provider id")
    .option("--label <label>", "A name for this account")
    .option("--id <accountId>", "Account id, for holding more than one key per provider")
    .option(
      "--credential <key=value>",
      "Any other credential this provider needs, repeatable (e.g. --credential accessKey=... --credential secretKey=...)",
      collectPair,
      {},
    )
    .option(
      "--credential-file <key=path>",
      "Read a credential's value from a file, repeatable",
      collectPairFile,
      {},
    )
    .option("--json", "Machine-readable output")
    .action(async (providerId: string, options: {
      apiKey?: string;
      apiKeyFile?: string;
      service?: string;
      upstream?: string;
      label?: string;
      id?: string;
      json?: boolean;
      credential?: Record<string, string>;
      credentialFile?: Record<string, string>;
    }) => {
      assertService(providerId, options.service);
      const apiKey = resolveApiKey(options);
      const supplied = { ...(apiKey ? { apiKey } : {}), ...(options.credential ?? {}), ...(options.credentialFile ?? {}) };
      if (Object.keys(supplied).length === 0) {
        throw new Error(
          "No credentials given. Pass --api-key-file <path>, pipe a key on stdin, or use "
          + "--credential key=value / --credential-file key=path.",
        );
      }
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
        ...(options.service ? { region: options.service } : {}),
        ...(options.label ? { label: options.label } : {}),
        enabled: true,
        // A file-sourced value wins over an inline one for the same key: whoever passed both meant
        // the safer of the two, and silently preferring the argument would put a secret in history.
        credentials: supplied,
      };
      await writeAccounts([...kept, added], current.readToken);
      if (isJsonMode(options)) {
        printJson({ added: accountId, providerId, ...(options.service ? { service: options.service } : {}) });
        return;
      }
      console.log(`Connected ${accountId} (${providerId}${options.service ? `, ${options.service}` : ""}).`);
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
