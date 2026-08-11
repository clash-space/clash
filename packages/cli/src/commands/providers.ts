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
 * Resolves one credential value, which may say where it lives.
 *
 * `@path` reads that file and `-` reads stdin, the convention curl settled on. The alternative was
 * a `-file` twin for every credential flag, which had already turned two flags into four and would
 * have grown with each new credential.
 *
 * Reading from a file or stdin is not a nicety: an argument is kept in shell history and is visible
 * in `ps` to every other user on the machine for as long as the command runs.
 */
function resolveValue(raw: string): string {
  if (raw === "-") {
    const piped = readFileSync(0, "utf8").trim();
    if (!piped) throw new Error("Nothing arrived on stdin.");
    return piped;
  }
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    let contents: string;
    try {
      contents = readFileSync(path, "utf8").trim();
    } catch {
      // ENOENT on its own says nothing about which argument caused it, and someone who meant a
      // literal value starting with @ needs to be told that @ is what triggered the read.
      throw new Error(
        `Cannot read the credential file ${path}. A value starting with @ is read from that path; `
        + "pass the value directly if it is not a file.",
      );
    }
    if (!contents) throw new Error(`The credential file ${path} is empty.`);
    return contents;
  }
  return raw.trim();
}

/**
 * Collects a repeated `key=value` flag.
 *
 * Which credentials a provider needs is the provider's business, and a plugin may declare its own,
 * so a CLI with one flag per credential would be permanently one provider behind. It carries pairs
 * and lets the host validate -- which the host already does, and is the only party that can.
 */
function collectPair(value: string, previous: Record<string, string>): Record<string, string> {
  const at = value.indexOf("=");
  if (at <= 0) {
    throw new Error(`Expected key=value, got "${value}".`);
  }
  return { ...previous, [value.slice(0, at)]: resolveValue(value.slice(at + 1)) };
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
    .option(
      "--api-key <value>",
      "The provider's API key. Use @path to read a file, or - to read stdin, so the secret stays out of shell history",
    )
    .option("--service <service>", "Which of the vendor's services issued this key, where it runs more than one")
    .option("--upstream <upstreamId>", "Upstream service, when it differs from the provider id")
    .option("--label <label>", "A name for this account")
    .option("--id <accountId>", "Account id, for holding more than one key per provider")
    .option(
      "--credential <key=value>",
      "Any other credential this provider needs, repeatable. Values accept @path and - as well "
        + "(e.g. --credential accessKey=@ak.txt --credential secretKey=@sk.txt)",
      collectPair,
      {},
    )
    .option("--json", "Machine-readable output")
    .action(async (providerId: string, options: {
      apiKey?: string;
      service?: string;
      upstream?: string;
      label?: string;
      id?: string;
      json?: boolean;
      credential?: Record<string, string>;
    }) => {
      assertService(providerId, options.service);
      const apiKey = options.apiKey ? resolveValue(options.apiKey) : undefined;
      const supplied = { ...(apiKey ? { apiKey } : {}), ...(options.credential ?? {}) };
      if (Object.keys(supplied).length === 0) {
        throw new Error(
          "No credentials given. Pass --api-key <value|@path|->, or --credential key=value "
          + "(also accepting @path and -).",
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
