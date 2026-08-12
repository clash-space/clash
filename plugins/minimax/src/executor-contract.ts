/**
 * The executor shape, which comes from the SDK.
 *
 * A plugin used to declare its own `ExecutorContext`, `ExecutorStep` and `ProviderExecutor`. They
 * were the same concepts the SDK declares, written twice, and the two drifted the moment the SDK
 * gained an injected store: the plugin's own type had no `store` field, so an executor reaching for
 * one would not compile against the very context it receives at runtime.
 *
 * Only `valueOutput` stays, because it is a convenience for building an output, not a definition of
 * what an executor is. It is four lines, so each Provider plugin carries its own rather than the
 * split inventing a shared package for it.
 */

export type {
  Executor as ProviderExecutor,
  ExecutorContext,
  ExecutorStep,
  PluginStoreHandle,
} from "@clash/action-sdk";

import type {
  ExecutablePluginJsonValue,
  ExecutablePluginOutput,
} from "@clash/shared-types/executable-plugin";

export type ExecutorOutput = ExecutablePluginOutput;

/** A non-media result: the model's words, an id, a measurement. */
export function valueOutput(value: ExecutablePluginJsonValue, slot = "media"): ExecutorOutput[] {
  return [{ slot, kind: "value", value }] as ExecutorOutput[];
}
