import type { ModelUpstreamRoute, ProviderAccountId } from "@clash/shared-types";
import { getProviderCredentials } from "../../services/provider-accounts";
import type { GoogleServiceAccount } from "../../services/google-gen";
import type { GenerationContext } from "../context";

export async function credentialsForRoute(
  ctx: GenerationContext,
  route: Pick<ModelUpstreamRoute, "accountId" | "modelCode" | "providerId" | "upstreamId" | "region" | "requiredCredentials">,
): Promise<Record<string, string>> {
  return getProviderCredentials(ctx.env, ctx.params.actorUserId, {
    accountId: route.accountId,
    providerId: route.providerId ?? (route.upstreamId as ProviderAccountId),
    upstreamId: route.upstreamId,
    region: route.region,
    modelCode: route.modelCode,
    requiredCredentials: route.requiredCredentials,
  });
}

export async function credentialsForProvider(
  ctx: GenerationContext,
  providerId: ProviderAccountId,
  requiredCredentials: string[],
  options: { upstreamId?: ModelUpstreamRoute["upstreamId"]; region?: string; modelCode?: string } = {},
): Promise<Record<string, string>> {
  return getProviderCredentials(ctx.env, ctx.params.actorUserId, {
    providerId,
    upstreamId: options.upstreamId,
    region: options.region,
    modelCode: options.modelCode,
    requiredCredentials,
  });
}

export function googleServiceAccountFromProvider(credentials: Record<string, string>): GoogleServiceAccount {
  const raw = credentials.serviceAccountKey?.trim();
  if (!raw) throw new Error("Google Cloud Agent Platform provider account is missing service account credentials.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Google Cloud Agent Platform credentials must be a service account JSON object.");
  }
  const clientEmail = typeof parsed.clientEmail === "string"
    ? parsed.clientEmail
    : typeof parsed.client_email === "string"
      ? parsed.client_email
      : "";
  const privateKey = typeof parsed.privateKey === "string"
    ? parsed.privateKey
    : typeof parsed.private_key === "string"
      ? parsed.private_key
      : "";
  const project = typeof parsed.project === "string"
    ? parsed.project
    : typeof parsed.project_id === "string"
      ? parsed.project_id
      : "";
  const location = typeof parsed.location === "string" && parsed.location.trim()
    ? parsed.location.trim()
    : "global";
  if (!clientEmail || !privateKey || !project) {
    throw new Error("Google Cloud Agent Platform credentials must include clientEmail/privateKey/project.");
  }
  return { clientEmail, privateKey, project, location };
}
