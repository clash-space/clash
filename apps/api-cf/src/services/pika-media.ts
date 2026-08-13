import {
  buildPikaMediaRequest,
  createPikaMediaJob,
  fetchPikaCatalogQuote,
  getPikaMediaContent,
  pikaBillingBasis,
  waitForPikaMediaJob,
} from "@clash/shared-runtime";
import type { ModelKind, ModelUpstreamRoute } from "@clash/shared-types";

export interface PikaMediaGenerationInput {
  taskId: string;
  kind: ModelKind;
  route: ModelUpstreamRoute;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
  modelParams?: Record<string, unknown>;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onUsageEvent?: (event: PikaUsageLifecycleEvent) => Promise<void>;
}

export interface PikaUsageLifecycleEvent {
  status: "submitted" | "completed" | "failed";
  operation: string;
  providerRequestId?: string;
  idempotencyKey: string;
  estimatedCostMicroUsd?: number;
  estimateComplete: boolean;
  pricingSource: "pika-catalog" | "unavailable";
  billingBasis: Record<string, unknown>;
  errorMessage?: string;
  occurredAt: string;
}

export async function generatePikaMedia(
  apiKey: string,
  input: PikaMediaGenerationInput,
): Promise<{ url: string; requestId: string; operation: string }> {
  const request = buildPikaMediaRequest({
    modelId: input.route.modelCode,
    kind: input.kind,
    upstreamModel: input.route.upstreamModel,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    modelParams: input.modelParams,
    startFrameUrl: input.startFrameUrl,
    endFrameUrl: input.endFrameUrl,
    referenceImageUrls: input.referenceImageUrls,
    referenceVideoUrls: input.referenceVideoUrls,
    referenceAudioUrls: input.referenceAudioUrls,
  });
  const selectedOperation = request.operation;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const idempotencyKey = input.taskId;
  const body = request.body;
  const quote = await fetchPikaCatalogQuote({
    operation: selectedOperation,
    input: body,
    baseUrl: input.baseUrl,
    fetch: fetchImpl,
  });
  const billingBasis = pikaBillingBasis(body);
  const emit = async (
    status: PikaUsageLifecycleEvent["status"],
    providerRequestId?: string,
    error?: unknown,
  ) => input.onUsageEvent?.({
    status,
    operation: selectedOperation,
    ...(providerRequestId ? { providerRequestId } : {}),
    idempotencyKey,
    ...(quote.estimatedCostMicroUsd !== undefined
      ? { estimatedCostMicroUsd: quote.estimatedCostMicroUsd }
      : {}),
    estimateComplete: quote.complete,
    pricingSource: quote.pricingSource,
    billingBasis,
    ...(error ? { errorMessage: error instanceof Error ? error.message : String(error) } : {}),
    occurredAt: new Date().toISOString(),
  });

  let created;
  try {
    created = await createPikaMediaJob({
      apiKey,
      operation: selectedOperation,
      input: body,
      idempotencyKey,
      baseUrl: input.baseUrl,
      fetch: fetchImpl,
    });
  } catch (error) {
    await emit("failed", undefined, error);
    throw error;
  }
  await emit("submitted", created.id);
  try {
    const completed = created.status === "completed"
      ? created
      : await waitForPikaMediaJob({
          apiKey,
          jobId: created.id,
          baseUrl: input.baseUrl,
          fetch: fetchImpl,
        });
    const content = await getPikaMediaContent({
      apiKey,
      jobId: completed.id,
      baseUrl: input.baseUrl,
      fetch: fetchImpl,
    });
    await emit("completed", completed.id);
    return { url: content.url, requestId: completed.id, operation: selectedOperation };
  } catch (error) {
    await emit("failed", created.id, error);
    throw error;
  }
}
