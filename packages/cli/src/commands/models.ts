import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";
import {
  publicAgentCommandResult,
  recordAgentObservation,
  requireAgentObservation,
} from "../lib/agent-worktree-observation";
import {
  listLocalSpeechModelCards,
  listModelCatalogEntries,
  resolveLocalSpeechModelId,
  type LocalSpeechCatalogEntry,
  type LocalSpeechModelCard,
} from "@clash/shared-types";

interface ProviderAccountPayload {
  providerId: string;
  upstreamId?: string;
  region?: string;
  enabled: boolean;
  weight?: number;
  priority?: number;
  credentials?: {
    serviceAccountKey?: string;
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
    runtimeReadiness?: {
      capability: LocalSpeechCapability;
      model: string;
      readiness: "ready" | "not-installed";
      executable: boolean;
      message?: string;
    };
  }>;
}

export type LocalSpeechCapability = "speech-to-text" | "text-to-speech";

interface LocalAudioModelStatusResponse extends Record<string, unknown> {
  capability: LocalSpeechCapability;
  model: string;
  available: boolean;
  readiness: "ready" | "not-installed";
  message?: string;
  readToken?: string;
}

type LocalAudioObservation = {
  entityKind: string;
  entityId: string;
  revision?: unknown;
};

export type LocalAudioModelCommandDependencies = {
  apiJson(
    path: string,
    options?: RequestInit,
  ): Promise<Record<string, unknown>>;
  recordObservation(
    observation: LocalAudioObservation & { revision: unknown },
  ): Promise<void>;
  requireObservation(
    observation: Omit<LocalAudioObservation, "revision">,
  ): Promise<string | undefined>;
  env: Record<string, string | undefined>;
};

const defaultLocalAudioModelDependencies: LocalAudioModelCommandDependencies = {
  apiJson: (path, options) => apiJson<Record<string, unknown>>(path, options),
  recordObservation: recordAgentObservation,
  requireObservation: requireAgentObservation,
  env: process.env,
};

function normalizeLocalSpeechCapability(value: unknown): LocalSpeechCapability {
  if (value === "speech-to-text" || value === "text-to-speech") return value;
  throw new Error("capability must be speech-to-text or text-to-speech");
}

function normalizeLocalModelId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error("model must be a non-empty model id");
}

export type ConfiguredLocalAudioModel = {
  capability: LocalSpeechCapability;
  model: string;
  ready: boolean;
  setupStatus: string;
  /** The command that would make this capability usable, when it is not yet. */
  nextStep?: string;
};

/**
 * Answer "what local ASR do I have, and is it usable" without the caller having
 * to already know a model id. Knowing the id is the thing you do not have when
 * you are asking the question.
 */
export async function resolveConfiguredLocalAudioModel(
  capability: LocalSpeechCapability,
  dependencies: LocalAudioModelCommandDependencies = defaultLocalAudioModelDependencies,
): Promise<ConfiguredLocalAudioModel> {
  const normalized = normalizeLocalSpeechCapability(capability);
  const config = await dependencies.apiJson("/api/v1/local/audio");
  const section = (normalized === "speech-to-text" ? config.asr : config.tts) as
    | { model?: unknown; ready?: unknown; setup?: { status?: unknown } }
    | undefined;
  const model = normalizeLocalModelId(section?.model);
  const ready = section?.ready === true;
  const setupStatus = typeof section?.setup?.status === "string"
    ? section.setup.status
    : ready ? "ready" : "unknown";
  return {
    capability: normalized,
    model,
    ready,
    setupStatus,
    ...(ready
      ? {}
      : {
          nextStep: `clash models local install --capability ${normalized} --model ${model}`,
        }),
  };
}

async function resolveLocalAudioModelId(
  input: { capability: LocalSpeechCapability; model?: string },
  dependencies: LocalAudioModelCommandDependencies,
): Promise<string> {
  if (input.model === undefined) {
    const configured = await resolveConfiguredLocalAudioModel(input.capability, dependencies);
    return configured.model;
  }
  const requested = normalizeLocalModelId(input.model);
  // Accept a catalog card id (`whisper-small-asr`) as readily as the runtime id,
  // resolved through the same selectors the GUI uses.
  return (
    resolveLocalSpeechModelId(localSpeechCatalogEntries(), input.capability, requested)
    ?? requested
  );
}

function localSpeechCatalogEntries() {
  return listModelCatalogEntries({}) as unknown as LocalSpeechCatalogEntry[];
}

/** Every local speech model this build ships, with the provider info to choose by. */
export function listLocalAudioModelCatalog(
  capability?: LocalSpeechCapability,
): LocalSpeechModelCard[] {
  return listLocalSpeechModelCards(
    localSpeechCatalogEntries(),
    capability === undefined ? undefined : normalizeLocalSpeechCapability(capability),
  );
}

export function publicLocalAudioModelResult<T extends Record<string, unknown>>(
  result: T,
): Record<string, unknown> {
  return publicAgentCommandResult(result);
}

export async function getLocalAudioModelStatus(
  input: { capability: LocalSpeechCapability; model?: string },
  dependencies: LocalAudioModelCommandDependencies = defaultLocalAudioModelDependencies,
): Promise<Omit<LocalAudioModelStatusResponse, "readToken">> {
  const capability = normalizeLocalSpeechCapability(input.capability);
  const model = await resolveLocalAudioModelId({ capability, model: input.model }, dependencies);
  const query = new URLSearchParams({ capability, model });
  const data = (await dependencies.apiJson(
    `/api/v1/local/audio/models/status?${query.toString()}`,
  )) as LocalAudioModelStatusResponse;
  await dependencies.recordObservation({
    entityKind: "local-config",
    entityId: "audio",
    revision: data.readToken,
  });
  return publicLocalAudioModelResult(data) as Omit<
    LocalAudioModelStatusResponse,
    "readToken"
  >;
}

export async function mutateLocalAudioModel(
  operation: "install" | "remove",
  input: { capability: LocalSpeechCapability; model?: string },
  dependencies: LocalAudioModelCommandDependencies = defaultLocalAudioModelDependencies,
): Promise<Record<string, unknown>> {
  const capability = normalizeLocalSpeechCapability(input.capability);
  const model = await resolveLocalAudioModelId({ capability, model: input.model }, dependencies);
  const observedVersion = await dependencies.requireObservation({
    entityKind: "local-config",
    entityId: "audio",
  });
  const data = await dependencies.apiJson(`/api/v1/local/audio/${operation}`, {
    method: "POST",
    headers: providerWriteHeaders({ observedVersion }, dependencies.env),
    body: JSON.stringify({ capability, model }),
  });
  await dependencies.recordObservation({
    entityKind: "local-config",
    entityId: "audio",
    revision: data.readToken,
  });
  return publicLocalAudioModelResult(data);
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
  if (typeof options.serviceAccountKeyFile !== "string" || !options.serviceAccountKeyFile.trim()) {
    return undefined;
  }
  const contents = await readFile(options.serviceAccountKeyFile.trim(), "utf8");
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Service-account key file must contain a JSON object");
  }
  return { serviceAccountKey: JSON.stringify(parsed) };
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
  .description("Manage model catalog, provider routing, and local audio runtimes");

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
  .option("--vertex-credentials-file <path>", "Read a Google service-account JSON key from a file")
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
      const readiness = entry.runtimeReadiness
        ? ` runtime=${entry.runtimeReadiness.readiness}`
        : "";
      console.log(`  ${entry.model.kind.padEnd(5)} ${entry.model.id.padEnd(28)} ${entry.tier.padEnd(20)} ${route}${readiness}`);
    }
  });

const localModelsCommand = modelsCommand
  .command("local")
  .description("Inspect and manage downloadable local ASR and TTS models");

localModelsCommand
  .command("catalog")
  .description("List the local ASR and TTS models this build can download")
  .option("--capability <text-to-speech|speech-to-text>", "Filter by capability")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const cards = listLocalAudioModelCatalog(options.capability);
    if (isJsonMode(options)) {
      printJson(cards);
      return;
    }
    for (const card of cards) {
      console.log(`${card.cardId}  ${card.name ?? ""}${card.provider ? ` (${card.provider})` : ""}`);
      console.log(`  model: ${card.model}`);
      if (card.description) console.log(`  ${card.description}`);
    }
    if (cards.length === 0) console.log("No local speech models in this build.");
  });

localModelsCommand
  .command("status")
  .description("Read whether one local audio model is installed and executable")
  .requiredOption(
    "--capability <text-to-speech|speech-to-text>",
    "Capability: speech-to-text or text-to-speech",
  )
  .option("--model <id>", "Catalog card id or runtime model id; defaults to the configured model")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const result = await getLocalAudioModelStatus({
      capability: options.capability,
      ...(options.model === undefined ? {} : { model: options.model }),
    });
    if (isJsonMode(options)) {
      printJson(result);
      return;
    }
    const suffix = result.message ? ` — ${result.message}` : "";
    console.log(
      `${result.capability} ${result.model}: ${result.readiness}${suffix}`,
    );
  });

for (const operation of ["install", "remove"] as const) {
  localModelsCommand
    .command(operation)
    .description(
      `${operation === "install" ? "Download and install" : "Remove"} one local audio model after a status read`,
    )
    .requiredOption(
      "--capability <text-to-speech|speech-to-text>",
      "Capability: speech-to-text or text-to-speech",
    )
    .option("--model <id>", "Catalog card id or runtime model id; defaults to the configured model")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const result = await mutateLocalAudioModel(operation, {
        capability: options.capability,
        ...(options.model === undefined ? {} : { model: options.model }),
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      const verb = operation === "install" ? "installed" : "removed";
      console.log(
        `Local ${options.capability} model ${verb}: ${options.model}`,
      );
    });
}
