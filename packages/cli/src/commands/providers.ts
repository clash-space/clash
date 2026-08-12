import { Command } from "commander";
import type { PluginAuthDeclaration } from "@clash/shared-types";
import { assertDeclaredSetting } from "./provider-settings.js";
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
  priority?: number;
  modelPriorities?: Record<string, number>;
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
async function currentAccounts(): Promise<ProviderAccountsResponse> {
  try {
    return await apiJson<ProviderAccountsResponse>("/api/v1/model-providers");
  } catch (error) {
    // A stopped host is an ordinary situation. Unhandled, it arrives as an AggregateError of
    // ECONNREFUSED entries and a Node stack, which reads like the CLI broke rather than like
    // something needs starting -- and the address matters, because discovery silently falls back
    // to the optional cloud gateway when no local host is discovered.
    if (error instanceof Error && /fetch failed|ECONNREFUSED/.test(`${error.message}${error.cause ?? ""}`)) {
      throw new Error(
        `The Clash host is not running at ${getServerUrl()}. Open Clash Desktop or start local-api first.`,
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

/** The Provider's own declaration, as the host reports it. */
async function providerAuthDeclaration(
  providerId: string,
): Promise<PluginAuthDeclaration | undefined> {
  // Not caught. Swallowing the failure made every declared key look undeclared, so a correct
  // `--set apiKey=...` was refused with "this provider does not declare an apiKey setting" -- a
  // message about the Provider, for a problem with the host.
  const response = await apiJson<{ providers?: { id: string; auth?: PluginAuthDeclaration }[] }>(
    "/api/v1/plugin-providers",
  );
  const provider = response.providers?.find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(
      `No provider ${providerId} is installed. Installed: `
      + `${(response.providers ?? []).map((candidate) => candidate.id).join(", ") || "none"}.`,
    );
  }
  return provider.auth;
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
        ...(provider.priority === undefined ? {} : { priority: provider.priority }),
        ...(provider.modelPriorities && Object.keys(provider.modelPriorities).length
          ? { modelPriorities: provider.modelPriorities }
          : {}),
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
    // One flag for everything a vendor wants. `--api-key`, `--service` and `--region` were three
    // flags naming three things one vendor happens to want, each validated against a table here --
    // so connecting a Provider that wants an access key and a secret meant adding flags, and one
    // that spells its regions differently meant editing a table. Which keys exist, what they accept
    // and which are required all come from the Provider's own declaration, the same one the settings
    // screen renders.
    .option("--upstream <upstreamId>", "Upstream service, when it differs from the provider id")
    .option("--label <label>", "A name for this account")
    .option("--id <accountId>", "Account id, for holding more than one key per provider")
    .option(
      "--set <key=value>",
      "A setting or credential this provider declares, repeatable. Values accept @path and - so a "
        + "secret stays out of shell history (e.g. --set apiKey=@key.txt --set service=agent-platform)",
      collectPair,
      {},
    )
    .option(
      "--priority <number>",
      "Lower wins when several accounts serve one model. Unset leaves the resolver's own order",
    )
    .option("--json", "Machine-readable output")
    .action(async (providerId: string, options: {
      apiKey?: string;
      service?: string;
      upstream?: string;
      label?: string;
      id?: string;
      region?: string;
      priority?: string;
      json?: boolean;
      set?: Record<string, string>;
    }) => {
      const supplied = options.set ?? {};
      if (Object.keys(supplied).length === 0) {
        throw new Error(
          "Nothing to store. Pass --set key=value for each setting this provider declares "
          + "(values accept @path and - so a secret stays out of shell history).",
        );
      }
      // Checked against the Provider's own declaration, so a key it does not read is refused here
      // rather than stored and silently ignored.
      const declaration = await providerAuthDeclaration(providerId);
      for (const [key, value] of Object.entries(supplied)) {
        assertDeclaredSetting(declaration, key, value);
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
        // The service is a fact about the credential, not a place. It used to be written to the
        // region column, which made a Google account read `region: "agent-platform"` -- matching no
        // route, resolving to nothing, and silently producing a placeholder.
        ...(options.label ? { label: options.label } : {}),
        enabled: true,
        ...(options.priority === undefined ? {} : { priority: Number(options.priority) }),
        // A file-sourced value wins over an inline one for the same key: whoever passed both meant
        // the safer of the two, and silently preferring the argument would put a secret in history.
        // Everything the Provider declared, stored side by side. A setting is a fact about the
        // credential rather than a place, and separating the two put `service: "agent-platform"` in
        // the region column -- matching no route and resolving to nothing.
        credentials: supplied,
      };
      await writeAccounts([...kept, added], current.readToken);
      if (isJsonMode(options)) {
        printJson({ added: accountId, providerId, set: Object.keys(supplied) });
        return;
      }
      console.log(`Connected ${accountId} (${providerId}): ${Object.keys(supplied).join(", ")}.`);
    });

  providers
    .command("priority <accountId> <priority>")
    .description("Change which account answers first when several serve one model")
    .option("--json", "Machine-readable output")
    .action(async (accountId: string, priority: string, options: { json?: boolean }) => {
      const value = Number(priority);
      if (!Number.isFinite(value)) throw new Error(`Priority must be a number, got "${priority}".`);
      const current = await currentAccounts();
      let found = false;
      const providers = current.providers
        .filter((provider) => provider.id ?? provider.providerId)
        .map((provider) => {
          const id = provider.id ?? provider.providerId;
          const matched = id === accountId;
          if (matched) found = true;
          return {
            id,
            providerId: provider.providerId,
            ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
            ...(provider.region ? { region: provider.region } : {}),
            enabled: provider.enabled !== false,
            // Every account is sent back because the endpoint merges; the one being changed carries
            // its new priority and the rest carry the priority they already had.
            ...(matched
              ? { priority: value }
              : provider.priority === undefined ? {} : { priority: provider.priority }),
          };
        });
      if (!found) throw new Error(`No provider account named ${accountId}.`);
      await writeAccounts(providers, current.readToken);
      if (isJsonMode(options)) {
        printJson({ accountId, priority: value });
        return;
      }
      console.log(`${accountId} now has priority ${value}.`);
    });

  providers
    .command("prefer <accountId> <model> [priority]")
    .description("Make this account answer first for one model, whatever the catalogue order says")
    .option("--json", "Machine-readable output")
    .action(async (accountId: string, model: string, priority: string | undefined, options: { json?: boolean }) => {
      // Lower wins, and 1 is the useful default: the gesture is almost always "this one, for this
      // model", not a position in a ladder nobody can see.
      const value = priority === undefined ? 1 : Number(priority);
      if (!Number.isFinite(value)) throw new Error(`Priority must be a number, got "${priority}".`);
      const current = await currentAccounts();
      let found = false;
      const providers = current.providers
        .filter((provider) => provider.id ?? provider.providerId)
        .map((provider) => {
          const id = provider.id ?? provider.providerId;
          const matched = id === accountId;
          if (matched) found = true;
          const modelPriorities = {
            ...(provider.modelPriorities ?? {}),
            ...(matched ? { [model]: value } : {}),
          };
          return {
            id,
            providerId: provider.providerId,
            ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
            ...(provider.region ? { region: provider.region } : {}),
            enabled: provider.enabled !== false,
            ...(provider.priority === undefined ? {} : { priority: provider.priority }),
            ...(Object.keys(modelPriorities).length ? { modelPriorities } : {}),
          };
        });
      if (!found) throw new Error(`No provider account named ${accountId}.`);
      await writeAccounts(providers, current.readToken);
      if (isJsonMode(options)) {
        printJson({ accountId, model, priority: value });
        return;
      }
      console.log(`${accountId} now answers first for ${model} (priority ${value}).`);
    });

  providers
    .command("remove <accountId>")
    .description("Disconnect an account")
    .option("--json", "Machine-readable output")
    .action(async (accountId: string, options: { json?: boolean }) => {
      // A deletion is a deletion, not a rewrite of everything else. Sending the remaining accounts
      // through PATCH looked like it worked -- it printed success and named the account -- and the
      // row survived, because that endpoint merges rather than replaces. The DELETE route was there
      // the whole time.
      const current = await currentAccounts();
      const known = current.providers.some((provider) =>
        (provider.id ?? provider.providerId) === accountId);
      if (!known) throw new Error(`No provider account named ${accountId}.`);

      await apiJson(`/api/v1/model-providers/${encodeURIComponent(accountId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readToken: current.readToken }),
      });

      if (isJsonMode(options)) {
        printJson({ removed: accountId });
        return;
      }
      console.log(`Disconnected ${accountId}.`);
    });
}
