/**
 * Wire-protocol types for the Clash custom-action SDK.
 *
 * Mirrors the Python SDK at `packages/clash-sdk/python/clash_sdk/models.py`.
 * The server treats both SDKs as interchangeable — wire shape is identical,
 * only the host language differs.
 */

export type Modality = 'image' | 'video' | 'audio' | 'text';

export type ActionProvider =
  | 'fal'
  | 'replicate'
  | 'kie'
  | 'official'
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'elevenlabs';

export interface ActionModel {
  /** Provider-facing model id, e.g. `fal-ai/flux-pro` or `gpt-image-1`. */
  id: string;
  /** Common MaaS / official provider preset. */
  provider: ActionProvider | string;
  name?: string;
  /** Override the provider preset key name. */
  secretId?: string;
  baseUrl?: string;
  endpoint?: string;
  [key: string]: unknown;
}

export interface ActionSecret {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface ActionContext {
  taskId: string;
  nodeId: string;
  projectId: string;
  actionId: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  model?: ActionModel;
  /** Decrypted variables for worker-runtime actions. Local-runtime tasks
   *  receive an empty object; local handlers should read provider keys
   *  from their process env. */
  secrets: Record<string, string>;
  outputType: Modality;
  /** R2 storage keys for assets wired upstream of the action-badge by
   *  the user (canvas edges → executor partitions by modality). Empty
   *  arrays when nothing's attached. Handlers fetch bytes via
   *  `ctx.fetchAsset(key)`. */
  referenceImageR2Keys: string[];
  referenceVideoR2Keys: string[];
  referenceAudioR2Keys: string[];
  /** Pull bytes for a referenced asset. Hits `/assets/sign?key=...`
   *  then GETs the resulting signed URL — same path the Python SDK
   *  takes. */
  fetchAsset(r2Key: string): Promise<Buffer>;
}

export interface AssetOutput {
  type: Modality;
  /** Binary payload for image/video/audio. */
  data?: Buffer | Uint8Array;
  /** Text payload for `type: 'text'`. Mutually exclusive with `data`. */
  content?: string;
  /** Defaults: image/png, video/mp4, audio/mpeg. Set explicitly when
   *  the actual format diverges (e.g. JPEG output). */
  mimeType?: string;
  /** Display label on the resulting canvas node. Multi-output actions
   *  should set distinct labels ("tile 1/4", "tile 2/4", …) so users
   *  can tell siblings apart. */
  label?: string;
}

/**
 * 0..N outputs per task.
 *
 * Single-output actions can use the convenience factories below;
 * multi-output uses `actionResult.many([...])` or the bare object.
 *
 * Server-side: the first output lands on the pending action-badge
 * child that was spawned at execute time; outputs 2..N spawn sibling
 * asset nodes adjacent to the first, sharing the same lineage edges.
 */
export interface ActionResult {
  outputs: AssetOutput[];
  description?: string;
}

export interface ActionDefinition {
  id: string;
  name: string;
  description?: string;
  outputType: Modality;
  parameters?: Array<Record<string, unknown>>;
  /** Optional MaaS / official model binding. The platform uses this to
   *  surface the right API key in Settings and to pass model metadata
   *  into worker/local task contexts. */
  model?: ActionModel;
  /** Extra required variables. Provider model bindings auto-add the
   *  provider key on the server, so most actions do not need this. */
  secrets?: ActionSecret[];
  icon?: string;
  color?: string;
  /** Modalities the action accepts inline in the prompt editor — drives
   *  which @-mention chips show up. Default ["text"] (prompt-only).
   *  Actions consuming reference images/video/audio MUST declare them. */
  promptModalities?: Modality[];
  handler: (ctx: ActionContext) => Promise<ActionResult>;
}

/** Convenience constructors that mirror Python's ActionResult.image/video/audio/text/many. */
export const actionResult = {
  image(
    data: Buffer | Uint8Array,
    opts: { description?: string; mimeType?: string; label?: string } = {},
  ): ActionResult {
    return {
      outputs: [{ type: 'image', data, mimeType: opts.mimeType ?? 'image/png', label: opts.label }],
      description: opts.description,
    };
  },
  video(
    data: Buffer | Uint8Array,
    opts: { description?: string; mimeType?: string; label?: string } = {},
  ): ActionResult {
    return {
      outputs: [{ type: 'video', data, mimeType: opts.mimeType ?? 'video/mp4', label: opts.label }],
      description: opts.description,
    };
  },
  audio(
    data: Buffer | Uint8Array,
    opts: { description?: string; mimeType?: string; label?: string } = {},
  ): ActionResult {
    return {
      outputs: [{ type: 'audio', data, mimeType: opts.mimeType ?? 'audio/mpeg', label: opts.label }],
      description: opts.description,
    };
  },
  text(
    content: string,
    opts: { description?: string; label?: string } = {},
  ): ActionResult {
    return {
      outputs: [{ type: 'text', content, label: opts.label }],
      description: opts.description,
    };
  },
  many(outputs: AssetOutput[], opts: { description?: string } = {}): ActionResult {
    return { outputs, description: opts.description };
  },
};

/** Identity helper that constrains the input type. Useful for
 *  IDE autocomplete in handler bodies — wrap your definition in
 *  `defineAction({...})` to get type errors on misshapen manifests. */
export function defineAction(def: ActionDefinition): ActionDefinition {
  return def;
}

export interface RunOptions {
  /** Server WS URL (ws://host[:port]) or HTTP URL (http(s)://...).
   *  We convert internally for the WS handshake. */
  serverUrl: string;
  projectId: string;
  /** Same `agentApiKey` the bridge daemon uses (or any API token
   *  bound to the user). Forwarded as `Authorization: Bearer ...`
   *  on the WS upgrade. */
  apiKey: string;
  /** Runtime row id from `~/.clash/credentials.json#runtimeId`.
   *  Forwarded as `x-runtime-id` header — server rejects
   *  registrations without it. Required since the "option C"
   *  gating landed. */
  runtimeId: string;
  actions: ActionDefinition[];
}
