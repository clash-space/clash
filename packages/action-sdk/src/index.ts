/**
 * @clash/action-sdk — Executable-plugin ABI and authoring helpers.
 *
 * Plugins contribute actions, projectors, and Provider executors. The Host
 * supplies invocation-scoped SDK implementations for account state, Asset
 * references, uploads, and Host tools.
 *
 * @example
 * ```typescript
 * import { assemblePlugin, defineExecutor } from '@clash/action-sdk';
 * const executor = defineExecutor({ async submit(invocation, context) { ... } });
 * await assemblePlugin({ manifestDir, contributes: { execute: executor } }).start();
 * ```
 */

export {
  ProviderExecutionError,
  providerHttpError,
  providerHttpFailure,
  type ProviderHttpFailureInput,
} from "./executable-failure.js";

export type {
  AssetKind,
  ExecutablePluginAssetHandle,
  ExecutablePluginBinding,
  ExecutablePluginInvocation,
  ExecutablePluginOutput,
  ExecutablePluginReference,
  ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

export {
  defineStdioExecutablePlugin,
  type StdioExecutablePlugin,
  type StdioExecutablePluginHandler,
  type StdioExecutablePluginOptions,
} from "./stdio-plugin.js";

export {
  definePlugin,
  type DefinedPlugin,
  type Executor,
  type ExecutorContext,
  type ExecutorStep,
  type ResolvedReference,
  type AssetUploadRequest,
  type AssetWriteRequest,
  type CodexImageGenerateRequest,
  type PluginDefinition,
  type PluginHostTools,
  type PluginStoreHandle,
} from "./define-plugin.js";

export {
  assemblePlugin,
  defineExecutor,
  defineProjector,
  type AssembleOptions,
  type AssembledPlugin,
  type ProjectorFn,
} from "./assemble.js";
