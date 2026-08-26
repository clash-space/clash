/**
 * The executor shape, which comes from the SDK.
 *
 * A plugin used to declare its own `ExecutorContext`, `ExecutorStep` and `ProviderExecutor`. They
 * were the same concepts the SDK declares, written twice, and the two drifted the moment the SDK
 * gained an injected store: the plugin's own type had no `store` field, so an executor reaching for
 * one would not compile against the very context it receives at runtime.
 */

export type {
  Executor as ProviderExecutor,
  ExecutablePluginInvocation,
  ExecutablePluginReference,
  ExecutorContext,
  ExecutorStep,
  PluginStoreHandle,
  ResolvedReference,
} from "@clash/action-sdk";
