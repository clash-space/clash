import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";
import {
  publicAgentCommandResult,
  recordAgentObservation,
  requireAgentObservation,
} from "../lib/agent-worktree-observation";

interface ProviderAccountPayload {
  providerId: string;
  upstreamId?: string;
  region?: string;
  enabled: boolean;
  weight?: number;
  priority?: number;
  credentials?: {
    vertexCredentials?: string;
  };
}

interface ModelProviderResponse {
  providers: Array<ProviderAccountPayload & { availableVariables?: string[] }>;
  readToken?: string;
}

interface ModelCatalogResponse {
  models: Array<{
    model: { id: string; name: string; kind: string };
    tier: "available" | "configured-provider" | "all";
    selectedRoute?: {
      providerId?: string;
      upstreamId: string;
      upstreamModel: string;
      apiShape: string;
    } | null;
    missingVariables: string[];
    candidateProviders: string[];
  }>;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

export function publicProviderAccountsResult(providers: unknown[]): unknown[] {
  const result = publicAgentCommandResult({ providers });
  return Array.isArray(result.providers) ? result.providers : [];
}

export function providerPayloadFromOptions(providerId: string, options: Record<string, unknown>): ProviderAccountPayload {
  const weight = optionalNumber(options.weight);
  const priority = optionalNumber(options.priority);
  return {
    providerId,
    ...(typeof options.upstream === "string" && options.upstream ? { upstreamId: options.upstream } : {}),
    ...(typeof options.region === "string" && options.region ? { region: options.region } : {}),
    enabled: options.disable === true ? false : true,
    ...(weight !== undefined ? { weight } : {}),
    ...(priority !== undefined ? { priority } : {}),
  };
}

export async function providerCredentialsFromOptions(
  options: Record<string, unknown>,
): Promise<ProviderAccountPayload["credentials"]> {
  if (typeof options.vertexCredentialsFile !== "string" || !options.vertexCredentialsFile.trim()) {
    return undefined;
  }
  const contents = await readFile(options.vertexCredentialsFile.trim(), "utf8");
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Vertex credentials file must contain a JSON object");
  }
  return { vertexCredentials: JSON.stringify(parsed) };
}

export function providerWriteHeaders(
  options: { observedVersion?: string; ifMatch?: string } = {},
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.CLASH_AGENT_MEMBER_ID?.trim()) {
    headers["x-clash-client-type"] = "agent";
  }
  if (options.observedVersion?.trim()) {
    const observed = options.observedVersion.trim();
    headers[observed.includes(":receipt:") ? "x-clash-if-match" : "x-clash-observed-version"] = observed;
  } else if (options.ifMatch?.trim()) {
    headers["x-clash-if-match"] = options.ifMatch.trim();
  }
  return headers;
}

export const modelsCommand = new Command("models")
  .description("Manage model catalog and provider routing");

modelsCommand
  .command("providers")
  .description("List configured model provider accounts")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<ModelProviderResponse>("/api/v1/model-providers");
    await recordAgentObservation({
      entityKind: "provider-accounts",
      entityId: "current",
      revision: data.readToken,
    });
    if (isJsonMode(options)) {
      printJson(publicProviderAccountsResult(data.providers));
      return;
    }
    if (data.providers.length === 0) {
      console.log("No model providers configured. Configure a local provider account with `clash models provider set <PROVIDER>`.");
      return;
    }
    for (const provider of data.providers) {
      const route = [provider.providerId, provider.upstreamId, provider.region].filter(Boolean).join("/");
      const vars = provider.availableVariables?.length ? provider.availableVariables.join(",") : "missing key";
      const weight = provider.weight === undefined ? "" : ` weight=${provider.weight}`;
      const status = provider.enabled === false ? "disabled" : "enabled";
      console.log(`  ${route.padEnd(28)} ${status.padEnd(8)} ${vars}${weight}`);
    }
  });

modelsCommand
  .command("provider")
  .description("Configure one model provider account")
  .command("set")
  .argument("<providerId>", "Provider account id: official, fal, kie, replicate")
  .option("--upstream <id>", "Internal upstream adapter, e.g. openai, google, fal, kie, replicate")
  .option("--region <region>", "Provider region/channel, e.g. global or cn")
  .option("--weight <number>", "Higher weight wins during auto routing")
  .option("--priority <number>", "Lower priority wins within equal weights")
  .option("--vertex-credentials-file <path>", "Read Google Vertex service-account JSON from a file")
  .option("--disable", "Disable this provider account")
  .option("--json", "Output as JSON")
  .action(async (providerId: string, options) => {
    const credentials = await providerCredentialsFromOptions(options);
    const provider = {
      ...providerPayloadFromOptions(providerId, options),
      ...(credentials ? { credentials } : {}),
    };
    const observedVersion = await requireAgentObservation({
      entityKind: "provider-accounts",
      entityId: "current",
    });
    const data = await apiJson<ModelProviderResponse>("/api/v1/model-providers", {
      method: "PATCH",
      headers: providerWriteHeaders({
        observedVersion,
      }),
      body: JSON.stringify({ providers: [provider] }),
    });
    await recordAgentObservation({
      entityKind: "provider-accounts",
      entityId: "current",
      revision: data.readToken,
    });
    if (isJsonMode(options)) {
      printJson(publicProviderAccountsResult(data.providers));
      return;
    }
    console.log(`Model provider configured: ${[provider.providerId, provider.upstreamId, provider.region].filter(Boolean).join("/")}`);
  });

modelsCommand
  .command("catalog")
  .description("List model catalog entries with availability tiers")
  .option("--tier <tier>", "Filter by tier: available, configured-provider, all")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<ModelCatalogResponse>("/api/v1/models/catalog");
    const models = typeof options.tier === "string"
      ? data.models.filter((entry) => entry.tier === options.tier)
      : data.models;
    if (isJsonMode(options)) {
      printJson(models);
      return;
    }
    for (const entry of models) {
      const route = entry.selectedRoute
        ? `${entry.selectedRoute.providerId ?? entry.selectedRoute.upstreamId}/${entry.selectedRoute.upstreamModel}`
        : entry.missingVariables.length
          ? `missing ${entry.missingVariables.join(",")}`
          : entry.candidateProviders.join(",");
      console.log(`  ${entry.model.kind.padEnd(5)} ${entry.model.id.padEnd(28)} ${entry.tier.padEnd(20)} ${route}`);
    }
  });
