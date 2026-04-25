/**
 * Plugin surface for api-cf.
 *
 * Default OSS deployments register no plugins → all hooks are no-op,
 * behavior is identical to "no plugin system at all".
 *
 * Hosted (or any downstream) deployments register plugins (e.g. the
 * billing plugin in packages/billing) to inject pre/post-generation
 * checks, route extensions, key resolution, quota enforcement, etc.
 *
 * Hooks are resolved lazily via getPlugins() at call sites — see
 * registry.ts for the lookup mechanism. This keeps the plugin
 * indirection out of OSS hot paths when no plugins are registered.
 */
import type { Hono } from "hono";
import type { Env } from "../config";
import type { GenerationParams } from "../generation/params";

/** Identity + arbitrary plugin-attached metadata (plan, quota, etc.). */
export interface UserContext {
  userId: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

/** Result of resolving an API key for a provider call. */
export interface ResolvedKey {
  /** "byok" = user-supplied key (no managed billing).
   *  "env"  = system key (managed billing applies). */
  source: "byok" | "env";
  apiKey: string;
}

/** Shared shape passed to generation lifecycle hooks. */
export interface GenerationHookCtx {
  user?: UserContext;
  params: GenerationParams;
  env: Env;
}

/** Loose result shape — providers emit a superset; plugins read what they need. */
export type GenerationResult = Record<string, unknown>;

export interface Plugin {
  /** Stable identifier — appears in logs / errors. */
  name: string;

  auth?: {
    /** Enrich (or wholly resolve) a user identity from a request. Default: existing JWT/BetterAuth chain in loro/auth.ts. */
    resolveUser?: (req: Request, env: Env) => Promise<UserContext | null>;
  };

  generation?: {
    /** Pick which API key to use for `provider` (e.g. "fal", "google", "kling"). Returning null falls back to env vars. */
    resolveKey?: (provider: string, ctx: GenerationHookCtx) => Promise<ResolvedKey | null>;

    /** Called before provider.execute. Throw to reject the workflow. */
    beforeGenerate?: (ctx: GenerationHookCtx) => Promise<void>;

    /** Called after provider.execute succeeds. */
    afterGenerate?: (ctx: GenerationHookCtx, result: GenerationResult) => Promise<void>;

    /** Called when provider.execute throws. */
    onFailure?: (ctx: GenerationHookCtx, err: unknown) => Promise<void>;
  };

  assets?: {
    /** Called before bytes hit R2. Throw to reject (e.g. quota exceeded). */
    beforeUpload?: (input: {
      env: Env;
      projectId: string;
      sizeBytes: number;
      user?: UserContext;
    }) => Promise<void>;
  };

  routes?: {
    /** Mount additional routes on the Hono app at startup. */
    register?: (app: Hono<{ Bindings: Env }>) => void;
  };
}
