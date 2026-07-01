import type { ModelUpstreamRoute, ProviderAccountId } from "@clash/shared-types";
import { getProviderCredentials } from "../../services/provider-accounts";
import type { VertexCredentials } from "../../services/google-gen";
import type { GenerationContext } from "../context";

export async function credentialsForRoute(
  ctx: GenerationContext,
  route: Pick<ModelUpstreamRoute, "modelCode" | "providerId" | "upstreamId" | "region" | "requiredCredentials">,
): Promise<Record<string, string>> {
  return getProviderCredentials(ctx.env, ctx.params.actorUserId, {
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

export function vertexCredentialsFromProvider(credentials: Record<string, string>): VertexCredentials {
  const raw = credentials.vertexCredentials?.trim();
  if (!raw) throw new Error("Google Vertex provider account is missing vertexCredentials.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Google Vertex vertexCredentials must be a service account JSON object.");
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
    throw new Error("Google Vertex vertexCredentials must include clientEmail/privateKey/project.");
  }
  return { clientEmail, privateKey, project, location };
}
