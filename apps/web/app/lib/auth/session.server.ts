import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { createAuth, type AuthBindings } from "./better-auth.server";

export const DEV_USER_ID = "dev-user";

export interface SessionEnv extends AuthBindings {
  NODE_ENV?: string;
  SKIP_LOGIN?: string;
}

export async function getUserIdFromRequest(
  request: Request,
  env: SessionEnv,
  cf?: IncomingRequestCfProperties,
): Promise<string | null> {
  if (env.SKIP_LOGIN === "true") return DEV_USER_ID;
  const auth = createAuth(env, cf);
  try {
    const session = await auth.api.getSession({
      headers: new Headers(request.headers),
    });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function getUserIdOrDev(
  request: Request,
  env: SessionEnv,
  cf?: IncomingRequestCfProperties,
): Promise<string> {
  const userId = await getUserIdFromRequest(request, env, cf);
  if (userId) return userId;
  if (env.NODE_ENV === "development" && env.SKIP_LOGIN === "true") {
    return DEV_USER_ID;
  }
  throw new Response("Unauthorized", { status: 401 });
}

export async function requireUserId(
  request: Request,
  env: SessionEnv,
  cf?: IncomingRequestCfProperties,
): Promise<string> {
  const userId = await getUserIdFromRequest(request, env, cf);
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return userId;
}
