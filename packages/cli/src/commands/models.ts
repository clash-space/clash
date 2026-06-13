import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";

interface ProviderAccountPayload {
  providerId: string;
  upstreamId?: string;
  region?: string;
  enabled: boolean;
  weight?: number;
  priority?: number;
}

interface ModelProviderResponse {
  providers: Array<ProviderAccountPayload & { availableVariables?: string[] }>;
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

export const modelsCommand = new Command("models")
  .description("Manage model catalog and provider routing");

modelsCommand
  .command("providers")
  .description("List configured model provider accounts")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<ModelProviderResponse>("/api/v1/model-providers");
    if (isJsonMode(options)) {
      printJson(data.providers);
      return;
    }
    if (data.providers.length === 0) {
      console.log("No model providers configured. Set keys with `clash vars set <KEY>` or configure one with `clash models provider set <PROVIDER>`.");
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
  .option("--disable", "Disable this provider account")
  .option("--json", "Output as JSON")
  .action(async (providerId: string, options) => {
    const provider = providerPayloadFromOptions(providerId, options);
    const data = await apiJson<ModelProviderResponse>("/api/v1/model-providers", {
      method: "PATCH",
      body: JSON.stringify({ providers: [provider] }),
    });
    if (isJsonMode(options)) {
      printJson(data.providers);
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
