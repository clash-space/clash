import type { GeneratorClient } from "./generator-client.js";

export type NativeMediaReadback = {
  actionRunId: string;
  outputSlot: string;
  projectAssetId: string;
  asset: { metadata?: { contentType?: string; width?: number; height?: number }; url?: string };
  bytes: Uint8Array;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Generator authority returned an invalid response");
  return value as Record<string, unknown>;
}

/** Poll one exact native ActionRun and resolve its immutable media OutputCommit and public Asset bytes. */
export async function readNativeMediaActionRun(options: {
  generator: Pick<GeneratorClient, "getActionRun" | "getOutputCommit">;
  projectId: string;
  actionRunId: string;
  getAsset: (projectAssetId: string) => Promise<{ metadata?: { contentType?: string; width?: number; height?: number }; url?: string }>;
  downloadAsset: (asset: { url?: string }) => Promise<Uint8Array>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<NativeMediaReadback> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let run: Record<string, unknown>;
  for (;;) {
    const response = record(await options.generator.getActionRun(options.projectId, options.actionRunId));
    run = record(response.run);
    if (run.status === "succeeded") break;
    if (run.status === "failed") {
      const outcome = run.outcome && typeof run.outcome === "object" ? JSON.stringify(run.outcome) : "no failure details";
      throw new Error(`ActionRun ${options.actionRunId} failed: ${outcome}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ActionRun ${options.actionRunId}`);
    await sleep(options.pollIntervalMs ?? 250);
  }
  const outputs = run.outputContract;
  if (!Array.isArray(outputs) || outputs.length !== 1) throw new Error(`ActionRun ${options.actionRunId} must freeze exactly one output slot`);
  const outputSlot = record(outputs[0]).slot;
  if (typeof outputSlot !== "string" || !outputSlot.trim()) throw new Error(`ActionRun ${options.actionRunId} has an invalid output slot`);
  const commitResponse = record(await options.generator.getOutputCommit(options.projectId, options.actionRunId, outputSlot));
  const commit = record(commitResponse.commit);
  const assetRef = record(commit.asset);
  if (assetRef.kind !== "media" || typeof assetRef.projectAssetId !== "string") throw new Error(`ActionRun ${options.actionRunId} has no media OutputCommit`);
  const asset = await options.getAsset(assetRef.projectAssetId);
  const bytes = await options.downloadAsset(asset);
  if (!bytes.byteLength) throw new Error(`Project Asset ${assetRef.projectAssetId} is empty`);
  return { actionRunId: options.actionRunId, outputSlot, projectAssetId: assetRef.projectAssetId, asset, bytes };
}
