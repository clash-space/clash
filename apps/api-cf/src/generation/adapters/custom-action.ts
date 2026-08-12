/**
 * Custom Action pipeline — calls an author-deployed CF Worker via HTTP.
 * Injects user variables (secrets) at runtime.
 */
import { log } from "../../logger";
import { loadSecrets } from "../../services/user-variables";
import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginJsonValue,
  type ExecutablePluginResult,
} from "@clash/shared-types";
import type { GenerationContext } from "../context";
import type { GenerationAdapter } from "../adapter";

type CustomActionResult = {
  type?: string;
  url?: string;
  mimeType?: string;
  content?: string;
  description?: string;
  [k: string]: unknown;
};

function outputValue(result: ExecutablePluginResult, slot: string): ExecutablePluginJsonValue | undefined {
  if (result.status !== "completed") return undefined;
  const output = result.outputs.find((candidate) => candidate.kind === "value" && candidate.slot === slot);
  return output?.kind === "value" ? output.value : undefined;
}

function displayValue(value: ExecutablePluginJsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export const customActionAdapter: GenerationAdapter = {
  name: "custom-action",

  async execute(ctx) {
    const { params, env } = ctx;
    if (params.pluginBinding) {
      const invocation = ExecutablePluginInvocationSchema.parse({
        protocol: "clash.plugin.invoke/v1",
        invocationId: params.taskId,
        taskId: params.taskId,
        projectId: params.projectId,
        ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        target: { ...params.pluginBinding, kind: "action" },
        input: {
          values: {
            ...(params.customActionParams ?? {}),
            prompt: params.prompt ?? "",
          },
          references: params.pluginReferences ?? [],
        },
        actor: {
          kind: params.actorType,
          id: params.actorType === "agent"
            ? params.actorAgentId ?? params.actorUserId
            : params.actorUserId,
        },
      });
      const hostedHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Clash-Plugin-Protocol": invocation.protocol,
      };

      const result = await ctx.step<ExecutablePluginResult>(
        "execute-plugin",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
        async () => {
          log.info("Calling hosted executable plugin", {
            ...ctx.tag,
            workerUrl: params.workerUrl,
            pluginId: params.pluginBinding?.pluginId,
            pluginVersion: params.pluginBinding?.version,
          });
          const response = await fetch(params.workerUrl!, {
            method: "POST",
            headers: hostedHeaders,
            redirect: "manual",
            body: JSON.stringify(invocation),
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Executable plugin error ${response.status}: ${errorText}`);
          }
          const parsed = ExecutablePluginResultSchema.parse(await response.json());
          if (parsed.invocationId !== invocation.invocationId) {
            throw new Error(
              `Executable plugin returned invocationId=${parsed.invocationId}; expected ${invocation.invocationId}`,
            );
          }
          if (parsed.status === "failed") {
            const error = new Error(`${parsed.error.code}: ${parsed.error.message}`);
            Object.assign(error, { code: parsed.error.code, retryable: parsed.error.retryable });
            throw error;
          }
          return parsed;
        },
      );

      const assetOutput = result.status === "completed"
        ? result.outputs.find((output) => output.kind === "asset")
        : undefined;
      const firstValue = result.status === "completed"
        ? result.outputs.find((output) => output.kind === "value")
        : undefined;
      await ctx.notifyCompleted({
        ...(assetOutput?.kind === "asset" ? { assetId: assetOutput.asset.assetId } : {}),
        ...(displayValue(outputValue(result, "content") ?? (firstValue?.kind === "value" ? firstValue.value : undefined)) !== undefined
          ? { content: displayValue(outputValue(result, "content") ?? (firstValue?.kind === "value" ? firstValue.value : undefined)) }
          : {}),
        ...(displayValue(outputValue(result, "description")) !== undefined
          ? { description: displayValue(outputValue(result, "description")) }
          : {}),
      });
      return;
    }

    const declaredSecrets = Array.isArray(params.customActionSecrets)
      ? params.customActionSecrets.filter((secret) => secret && typeof secret.id === "string" && secret.id.length > 0)
      : [];
    const secretIds = [...new Set(declaredSecrets.map((secret) => secret.id))];

    const secrets = await ctx.step(
      "load-secrets",
      { timeout: "10 seconds" },
      async () => {
        if (secretIds.length === 0) return {};
        const requiredSecretIds = declaredSecrets
          .filter((secret) => secret.required !== false)
          .map((secret) => secret.id);
        if (!env.ACTION_SECRET_KEY) {
          if (requiredSecretIds.length === 0) return {};
          throw new Error("Server not configured for action secret decryption");
        }
        const loaded = await loadSecrets(env.DB, params.actorUserId, secretIds, env.ACTION_SECRET_KEY);
        const missingRequired = requiredSecretIds.filter((id) => !loaded[id]);
        if (missingRequired.length > 0) {
          throw new Error(`Missing required action secret: ${missingRequired.join(", ")}`);
        }
        return loaded;
      },
    );

    const result = await ctx.step<CustomActionResult>(
      "execute-action",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("Calling custom action worker", { ...ctx.tag, workerUrl: params.workerUrl });
        const resp = await fetch(params.workerUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: params.taskId,
            nodeId: params.nodeId,
            projectId: params.projectId,
            actionId: params.customActionId,
            model: params.customActionModel,
            prompt: params.prompt ?? "",
            params: params.customActionParams ?? {},
            refs: {
              image: params.referenceImageR2Keys ?? [],
              video: params.referenceVideoR2Keys ?? [],
              audio: params.referenceAudioR2Keys ?? [],
            },
            secrets,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Action worker error ${resp.status}: ${errText}`);
        }
        const data = (await resp.json()) as CustomActionResult;
        log.info("Custom action response", { ...ctx.tag, type: data.type });
        return data;
      },
    );

    let assetId: string | undefined;
    if ((result.type === "image" || result.type === "video" || result.type === "audio") && result.url) {
      const kind = result.type as "image" | "video" | "audio";
      const mime =
        result.mimeType ??
        (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png");

      const storageKey = await ctx.step(
        "upload-result",
        { retries: { limit: 2, delay: "2 seconds" }, timeout: "3 minutes" },
        async () => ctx.uploadFromUrl(result.url!, mime),
      );

      const probe = await ctx.step(
        "probe-custom-asset",
        { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
        async () => ctx.probe(kind, storageKey),
      );

      assetId = await ctx.step(
        "save-asset",
        { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
        async () =>
          ctx.createAsset({
            kind,
            srcR2Key: storageKey,
            coverR2Key: probe.coverR2Key,
            metadata: probe.metadata,
            sourceModel: params.customActionId,
            sourcePrompt: params.prompt,
          }),
      );
    }

    await ctx.notifyCompleted({
      ...(assetId ? { assetId } : {}),
      content: result.content ?? undefined,
      description: result.description ?? undefined,
    });
  },
};
