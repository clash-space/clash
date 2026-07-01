import {
  listModelCatalogEntries,
  listProviderModelSupport,
  MODEL_CARDS,
  ProviderOAuthIdSchema,
  type ProviderOAuthId,
} from "@clash/shared-types";
import { Hono } from "hono";
import type { Env } from "../../config";
import {
  listProviderAccounts,
  normalizeProviderAccountInput,
  upsertProviderAccounts,
  type ProviderAccountInput,
} from "../../services/provider-accounts";
import {
  applyProviderOAuth,
  deleteProviderOAuthRecord,
  listProviderOAuthRecords,
  publicProviderOAuth,
} from "../../services/provider-oauth";

export const modelProviderRoutes = new Hono<{ Bindings: Env }>();

function sameProviderAccount(
  a: Pick<ProviderAccountInput, "id" | "providerId" | "upstreamId" | "region">,
  b: Pick<ProviderAccountInput, "id" | "providerId" | "upstreamId" | "region">,
): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.providerId === b.providerId &&
    (a.upstreamId ?? "") === (b.upstreamId ?? "") &&
    (a.region ?? "") === (b.region ?? "");
}

function displayModelName(modelId: string): string {
  return MODEL_CARDS.find((model) => model.id === modelId)?.name ?? modelId;
}

function displayProviderName(provider: Pick<ProviderAccountInput, "providerId" | "upstreamId">): string {
  if (provider.providerId === "mock") return "Mock provider";
  if (provider.providerId === "official" && provider.upstreamId) {
    if (provider.upstreamId === "openai") return "OpenAI";
    if (provider.upstreamId === "anthropic") return "Anthropic";
    if (provider.upstreamId === "google") return "Google";
    return provider.upstreamId;
  }
  const names: Record<string, string> = {
    fal: "fal.ai",
    kie: "KIE",
    replicate: "Replicate",
    kling: "Kling",
    minimax: "MiniMax",
    jimeng: "Dreamina",
    volcengine: "Volcengine",
    elevenlabs: "ElevenLabs",
  };
  if (names[provider.providerId]) return names[provider.providerId];
  return provider.upstreamId && provider.upstreamId !== provider.providerId
    ? `${provider.providerId}/${provider.upstreamId}`
    : provider.providerId;
}

function parseProviderOAuthId(value: unknown): ProviderOAuthId | null {
  const parsed = ProviderOAuthIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function listProviderAccountsWithOAuth(env: Env, userId: string) {
  const [accounts, oauthRecords] = await Promise.all([
    listProviderAccounts(env.DB, userId),
    listProviderOAuthRecords(env.DB, userId),
  ]);
  return applyProviderOAuth(accounts, oauthRecords);
}

modelProviderRoutes.get("/model-providers", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ providers: await listProviderAccountsWithOAuth(c.env, userId) });
});

modelProviderRoutes.patch("/model-providers", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { providers?: unknown };
  const providers = Array.isArray(body.providers)
    ? body.providers.map(normalizeProviderAccountInput)
    : [];
  if (providers.length === 0 || providers.some((provider) => !provider)) {
    return c.json({ error: "Invalid providers" }, 400);
  }
  const saved = await upsertProviderAccounts(c.env, userId, providers.filter((provider) => !!provider));
  const oauthRecords = await listProviderOAuthRecords(c.env.DB, userId);
  return c.json({ providers: applyProviderOAuth(saved, oauthRecords) });
});

modelProviderRoutes.post("/model-providers/test", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { provider?: unknown; modelId?: unknown };
  const provider = normalizeProviderAccountInput(body.provider);
  const modelId = typeof body.modelId === "string" && body.modelId.trim() ? body.modelId.trim() : "";
  if (!provider || !modelId) return c.json({ error: "provider and modelId are required" }, 400);

  const accounts = await listProviderAccountsWithOAuth(c.env, userId);
  const stored = accounts.find((account) => sameProviderAccount(provider, account));
  const configuredCredentials = new Set([
    ...(stored?.configuredCredentials ?? []),
    ...Object.keys(provider.credentials ?? {}).filter((key) => provider.credentials?.[key]?.trim()),
  ]);
  const support = listProviderModelSupport({ includeMock: provider.providerId === "mock" }).find((row) =>
    row.providerId === provider.providerId &&
    row.upstreamId === provider.upstreamId &&
    (row.region ?? "") === (provider.region ?? "")
  );
  const modelName = displayModelName(modelId);
  const baseResult = {
    providerId: provider.providerId,
    ...(provider.upstreamId ? { upstreamId: provider.upstreamId } : {}),
    ...(provider.region ? { region: provider.region } : {}),
    modelId,
  };
  if (!support || !support.models.some((model) => model.id === modelId)) {
    return c.json({
      ok: false,
      ...baseResult,
      unsupported: true,
      message: `${displayProviderName(provider)} does not support ${modelName}.`,
    });
  }
  const supportedModelIds = provider.supportedModelIds ?? stored?.supportedModelIds;
  if (supportedModelIds?.length && !supportedModelIds.includes(modelId)) {
    return c.json({
      ok: false,
      ...baseResult,
      unsupported: true,
      message: `${displayProviderName(provider)} is not enabled for ${modelName}.`,
    });
  }
  const missingCredentials = support.requiredCredentials.filter((credential) => !configuredCredentials.has(credential));
  if (missingCredentials.length > 0) {
    return c.json({
      ok: false,
      ...baseResult,
      missingCredentials,
      message: `${displayProviderName(provider)} is missing required credentials for ${modelName}.`,
    });
  }
  const availableOAuth = new Set(stored?.availableOAuth ?? []);
  const missingOAuth = support.requiredOAuth.filter((providerId) => !availableOAuth.has(providerId));
  if (missingOAuth.length > 0) {
    return c.json({
      ok: false,
      ...baseResult,
      missingOAuth,
      message: `${displayProviderName(provider)} needs authorization before testing ${modelName}.`,
    });
  }
  const providerName = displayProviderName(provider);
  return c.json({
    ok: true,
    ...baseResult,
    message: provider.providerId === "mock"
      ? `Mock provider can run ${modelName}.`
      : `${providerName} configuration is ready for ${modelName}.`,
  });
});

modelProviderRoutes.get("/models/catalog", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providers = await listProviderAccountsWithOAuth(c.env, userId);
  return c.json({
    models: listModelCatalogEntries({ configuredProviders: providers }),
  });
});

modelProviderRoutes.get("/provider-oauth", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providers = await listProviderOAuthRecords(c.env.DB, userId);
  return c.json({ providers: providers.map(publicProviderOAuth) });
});

modelProviderRoutes.post("/provider-oauth/:providerId/start", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providerId = parseProviderOAuthId(c.req.param("providerId"));
  if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
  return c.json({ error: `${providerId} OAuth is available through the local desktop runtime.` }, 501);
});

modelProviderRoutes.post("/provider-oauth/:providerId/complete", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providerId = parseProviderOAuthId(c.req.param("providerId"));
  if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
  return c.json({ error: `${providerId} OAuth completion is available through the local desktop runtime.` }, 501);
});

modelProviderRoutes.delete("/provider-oauth/:providerId", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const providerId = parseProviderOAuthId(c.req.param("providerId"));
  if (!providerId) return c.json({ error: "Unsupported OAuth provider" }, 404);
  await deleteProviderOAuthRecord(c.env.DB, userId, providerId, stringField(c.req.query("accountId")));
  return new Response(null, { status: 204 });
});
