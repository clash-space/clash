/**
 * The executor shape, from the SDK.
 *
 * Mirrors the same re-export in the Google and Hilo Hub plugins: `ExecutorContext`, `ExecutorStep`
 * and `Executor` are SDK-owned concepts, so a plugin-local redeclaration would drift the moment the
 * SDK's context gained a field this copy did not know about.
 */
export type {
  Executor as ProviderExecutor,
  ExecutorContext,
  ExecutorStep,
  PluginStoreHandle,
  ResolvedReference,
} from "@clash/action-sdk";
