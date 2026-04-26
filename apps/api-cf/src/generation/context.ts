/**
 * GenerationContext — shared primitives for generation workflows.
 *
 * Each provider receives a context and calls `ctx.step(name, fn)` for each
 * durable checkpoint it needs. The platform doesn't prescribe a fixed
 * step graph — that's the provider's concern (DIP).
 */
import type { WorkflowStep } from "cloudflare:workers";
import { Buffer } from "node:buffer";

import type { Env } from "../config";
import { log } from "../logger";
import { Status } from "../domain/canvas";
import { createAsset, getProjectOwner, type AssetMetadata, type CreateAssetParams } from "../services/assets";
import { probeAsset, type ProbeOptions } from "../services/asset-probe";
import { uploadBytes, uploadFromUrl } from "../services/r2";
import type { GenerationParams } from "./params";

export interface StepOpts {
  retries?: { limit: number; delay: string; backoff?: "exponential" | "linear" };
  timeout?: string;
}

const DEFAULT_STEP_OPTS: StepOpts = {
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

export class GenerationContext {
  constructor(
    public readonly params: GenerationParams,
    private readonly stepHandle: WorkflowStep,
    public readonly env: Env,
  ) {}

  get tag() {
    return { taskId: this.params.taskId, nodeId: this.params.nodeId };
  }

  // ─── Durable step wrapper ───────────────────────────────

  /** Thin wrapper over `step.do` with sensible defaults.
   *  Caller owns serialization — return values land in CF Workflow DO state,
   *  so keep them small + JSON-safe (no Uint8Array / class instances). */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  step<T>(name: string, opts: StepOpts, fn: () => Promise<T>): Promise<T>;
  step<T>(name: string, optsOrFn: StepOpts | (() => Promise<T>), maybeFn?: () => Promise<T>): Promise<T> {
    const [opts, fn] = typeof optsOrFn === "function" ? [DEFAULT_STEP_OPTS, optsOrFn] : [
      { ...DEFAULT_STEP_OPTS, ...optsOrFn },
      maybeFn!,
    ];
    // CF's step.do types the callback return as `Serializable<T>`; our wrapper
    // is looser by design (providers type their own step payloads).
    return this.stepHandle.do(name, opts as any, fn as any) as Promise<T>;
  }

  // ─── R2 helpers ─────────────────────────────────────────

  /** Read an R2 object and return as base64 (native C++ via Buffer). */
  async readR2Base64(key: string): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
    const obj = await this.env.R2_BUCKET.get(key);
    if (!obj) throw new Error(`R2 object not found: ${key}`);
    const mimeType = obj.httpMetadata?.contentType || "application/octet-stream";
    const buf = await obj.arrayBuffer();
    return { bytesBase64Encoded: Buffer.from(buf).toString("base64"), mimeType };
  }

  /** Read R2 object as `data:` URI (for models that accept data URLs). */
  async readR2DataUri(key: string): Promise<string> {
    const { bytesBase64Encoded, mimeType } = await this.readR2Base64(key);
    return `data:${mimeType};base64,${bytesBase64Encoded}`;
  }

  /** Upload raw bytes to R2 under projects/{projectId}/uploads/{taskId}… */
  async uploadBytes(data: Uint8Array | ArrayBuffer, mimeType: string, suffix = ""): Promise<string> {
    return uploadBytes(
      this.env.R2_BUCKET,
      data as Uint8Array,
      this.params.projectId,
      `${this.params.taskId}${suffix}`,
      mimeType,
    );
  }

  /** Download from URL and upload to R2. */
  async uploadFromUrl(url: string, mimeType: string, suffix = ""): Promise<string> {
    return uploadFromUrl(
      this.env.R2_BUCKET,
      url,
      this.params.projectId,
      `${this.params.taskId}${suffix}`,
      mimeType,
    );
  }

  // ─── Probe (dimensions / duration / peaks etc.) ────────

  async probe(
    kind: "image" | "video" | "audio",
    storageKey: string,
    opts?: ProbeOptions,
  ): Promise<{ metadata: AssetMetadata; coverR2Key?: string }> {
    return probeAsset(this.env, kind, storageKey, this.params.projectId, opts);
  }

  // ─── D1 asset row ───────────────────────────────────────

  async createAsset(input: Omit<CreateAssetParams, "id" | "userId" | "projectId" | "sourceTaskId"> & {
    userId?: string;
  }): Promise<string> {
    const userId = input.userId ?? (await getProjectOwner(this.env.DB, this.params.projectId)) ?? "";
    // Pull lineage from the workflow params unless the caller passed its own.
    // Centralizing here means every provider (image / video / audio / custom)
    // gets `sources` without each one having to thread the field through.
    const sources = input.sources ?? this.params.sources;
    const { id } = await createAsset(this.env.DB, {
      id: this.params.taskId,            // deterministic on workflow retry
      userId,
      projectId: this.params.projectId,
      sourceTaskId: this.params.taskId,
      ...input,
      sources,
    });
    log.info("Asset saved to D1", { ...this.tag, assetId: id, kind: input.kind });
    return id;
  }

  // ─── Loro notification ──────────────────────────────────

  /** POST to ProjectRoom DO's /update-node. If `logEntry` is given it's
   *  appended to node.data._log (visible in the node's audit log overlay).
   *
   *  `undefined` values mean "clear this field"; we serialize them as
   *  explicit `null` so they survive JSON.stringify (which drops undefined
   *  silently) — the DO-side updateNodeData treats null as a delete. */
  async notify(updates: Record<string, unknown>, logEntry?: string): Promise<void> {
    const wireUpdates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      wireUpdates[k] = v === undefined ? null : v;
    }
    try {
      const roomId = this.env.ROOM.idFromName(this.params.projectId);
      const stub = this.env.ROOM.get(roomId);
      const resp = await stub.fetch(
        new Request(`https://do/sync/${this.params.projectId}/update-node`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: this.params.nodeId,
            updates: wireUpdates,
            ...(logEntry ? { log: logEntry } : {}),
          }),
        }),
      );
      await resp.text();
    } catch (e) {
      log.error("Failed to notify ProjectRoom", {
        projectId: this.params.projectId,
        nodeId: this.params.nodeId,
        error: String(e),
      });
    }
  }

  async notifyCompleted(extra: Record<string, unknown> = {}): Promise<void> {
    // Clear audit log on success — stale entries from earlier attempts would
    // otherwise linger on the now-successful node.
    await this.notify({
      pendingTask: undefined,
      status: Status.Completed,
      _log: undefined,
      ...extra,
    });
  }

  async notifyFailed(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    // Keep existing log entries (don't clear) and append a FAILED line so
    // users see why in the node's audit log overlay.
    await this.notify(
      {
        pendingTask: undefined,
        status: Status.Failed,
        errorMessage: message,
      },
      `FAILED: ${message.slice(0, 500)}`,
    );
  }
}
