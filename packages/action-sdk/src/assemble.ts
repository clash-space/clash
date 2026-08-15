import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ExecutablePluginInvocation,
  ExecutablePluginJsonValue,
  ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

import {
  defineStdioExecutablePlugin,
  type StdioExecutablePlugin,
  type StdioExecutablePluginOptions,
} from "./stdio-plugin.js";
import {
  outputsFor,
  type Executor,
  type ExecutorContext,
  type ExecutorContextOverrides,
  ExecutorStep,
  executorContextFrom,
} from "./define-plugin.js";
import { unsupportedAcceptedOperation } from "./executable-failure.js";

/**
 * Assembling a plugin from what its manifest already declares.
 *
 * A plugin used to state each contribution three times: in `manifest.json` as `{id, kind, handler}`, in a
 * table keyed by id, and as the function itself. The tables drifted -- `google-execute` was built,
 * tested and bound to thirteen routes while the installed manifest never declared it, so the host
 * answered "does not export provider-executor google-execute" and the path was unreachable for as
 * long as nobody ran a generation through it.
 *
 * The manifest is the configuration and the module is the beans. Assembly connects them and fails
 * at startup, not at the first generation, when they disagree.
 */

const KIND = Symbol.for("clash.plugin.kind");
const ACTION_MODE = Symbol.for("clash.plugin.action-mode");

export type ProjectorFn = (
  invocation: ExecutablePluginInvocation,
) => ExecutablePluginJsonValue;

/** Pure arithmetic on an invocation: no network, no credentials, no host calls. */
export function defineProjector(project: ProjectorFn): ProjectorFn {
  return Object.assign(project, { [KIND]: "provider-projector" as const });
}

/** Talks to a vendor. Receives credentials and a host context; may split submit from poll. */
export function defineExecutor(executor: Executor): Executor {
  return Object.assign(executor, { [KIND]: "provider-executor" as const });
}

export interface Action {
  run: (
    invocation: ExecutablePluginInvocation,
    context: ExecutorContext,
  ) => Promise<ExecutorStep>;
}

/**
 * An operation the plugin brings itself, rather than a vendor's way of performing one that exists.
 *
 * The four AIGC actions are performed by models, so a plugin adds to them by shipping a provider:
 * the action is already there and an executor only routes it to a vendor. Rendering a timeline is
 * not that -- no model produces it, it has no model cards, and nothing about it is chosen by
 * picking a provider.
 *
 * `kind: "action"` had been in the manifest schema all along with no way to implement it: the two
 * tags were executor and projector, so declaring an action and writing code for it failed assembly
 * with "declared action in the manifest but defined as provider-executor in code".
 *
 * `run` is the legacy submit-only sugar for work that completes in one invocation. A Generator
 * Action that may answer later uses `defineActionExecutor`, keeping submit/poll in the same Host
 * durable loop without changing its semantic `kind: "action"` identity.
 */
export function defineAction(action: Action): Action {
  return Object.assign(action, {
    [KIND]: "action" as const,
    [ACTION_MODE]: "run" as const,
  });
}

/**
 * A Generator Action executor that may hand durable work back to the Host.
 *
 * It shares the exact invocation/result/context ABI with Provider executors, but remains an
 * `action` contribution: the Generator definition owns the operation, while submit/poll is only
 * how the Host executes one ActionRun without blocking the GUI.
 */
export function defineActionExecutor(executor: Executor): Executor {
  return Object.assign(executor, {
    [KIND]: "action" as const,
    [ACTION_MODE]: "executor" as const,
  });
}

export interface ManifestFunction {
  id: string;
  kind: string;
  operations?: string[];
}

export interface AssembleOptions {
  manifestDir: string;
  /**
   * Keyed by the contribution id the manifest declares.
   *
   * There is no `handler` name in between. A name whose only job is to point at another name is a
   * name that can point at nothing, and that is what happened: the manifest, a table in code, and
   * the function each carried a spelling, and `google-execute` went missing from one of them for
   * long enough to be built, tested and bound to thirteen routes.
   */
  contributes: Record<string, unknown>;
}

/** A plugin's executable contract without choosing how the Host reaches it. */
export interface PluginModule {
  /**
   * @param hostContext dependencies scoped by the host for this invocation.
   */
  invoke(
    invocation: ExecutablePluginInvocation,
    hostContext?: ExecutorContextOverrides,
  ): Promise<ExecutablePluginResult>;
  contributes: ManifestFunction[];
}

/** Compatibility authoring surface for packages that still serve themselves over stdio. */
export interface AssembledPlugin extends PluginModule {
  /** Read invocations from stdin and write result frames to stdout until the stream ends. */
  start(options?: StdioExecutablePluginOptions): Promise<void>;
}

/**
 * Assemble a transport-neutral module for an in-process Host.
 *
 * The compatibility `assemblePlugin()` API below also exposes `start()`. Returning only the module
 * contract here makes importing first-party code inert: choosing stdio remains a Host/package
 * concern rather than part of the executable definition.
 */
export function assemblePluginModule(options: AssembleOptions): PluginModule {
  return assemblePluginDefinition(options);
}

/** Serve one already-assembled module through the stdio transport. */
export function servePluginStdio(
  module: PluginModule,
  options?: StdioExecutablePluginOptions,
): StdioExecutablePlugin {
  return defineStdioExecutablePlugin(
    Object.fromEntries(
      module.contributes.map(({ id }) => [
        id,
        (
          invocation: ExecutablePluginInvocation,
          hostContext: ExecutorContext,
        ) => module.invoke(invocation, hostContext),
      ]),
    ),
    options,
  );
}

export function assemblePlugin(options: AssembleOptions): AssembledPlugin {
  const module = assemblePluginModule(options);
  return {
    ...module,
    start: (stdioOptions) => servePluginStdio(module, stdioOptions).done,
  };
}

function assemblePluginDefinition(options: AssembleOptions): PluginModule {
  const manifest = JSON.parse(
    readFileSync(join(options.manifestDir, "manifest.json"), "utf8"),
  ) as { contributes?: { functions?: ManifestFunction[] } };
  const declared = manifest.contributes?.functions ?? [];

  const wired = new Map<
    string,
    { declaration: ManifestFunction; bean: unknown }
  >();
  for (const declaration of declared) {
    const bean = options.contributes[declaration.id];
    if (bean === undefined) {
      // Discovered at assembly rather than at the first generation, which is where it used to
      // surface -- hours after activation reported success.
      throw new Error(
        `${manifestName(manifest)} declares ${declaration.id}, but nothing implements it.`,
      );
    }
    const definedKind = (bean as Record<symbol, string>)[KIND];
    if (definedKind && definedKind !== declaration.kind) {
      // A projector reached through the executor path would be handed credentials it never asked
      // for, and an executor reached as a projector would be called without any.
      throw new Error(
        `${declaration.id} is declared ${declaration.kind} in the manifest ` +
          `but defined as ${definedKind} in code.`,
      );
    }
    if (declaration.kind === "action") {
      const mode = (bean as Record<symbol, string>)[ACTION_MODE];
      if (
        mode === "run" &&
        declaration.operations?.some((op) => op !== "submit")
      ) {
        throw new Error(
          `${declaration.id} is a run-only Action but declares a durable poll or callback operation.`,
        );
      }
      if (mode === "executor") {
        const executor = bean as Executor;
        if (declaration.operations?.includes("poll") && !executor.poll) {
          throw new Error(
            `${declaration.id} declares poll but its Action executor implements no poll operation.`,
          );
        }
        if (
          declaration.operations?.includes("callback") &&
          !executor.callback
        ) {
          throw new Error(
            `${declaration.id} declares callback but its Action executor implements no callback operation.`,
          );
        }
      }
    }
    wired.set(declaration.id, { declaration, bean });
  }

  // The other direction. Code the host can never reach still passes its own tests and still looks
  // finished, which is exactly how google-execute stayed invisible.
  for (const id of Object.keys(options.contributes)) {
    if (!wired.has(id)) {
      throw new Error(
        `${manifestName(manifest)} implements ${id}, but the manifest does not declare it.`,
      );
    }
  }

  const plugin: PluginModule = {
    contributes: declared,
    async invoke(invocation, hostContext) {
      const entry = wired.get(invocation.target.exportId);
      if (!entry) {
        throw new Error(
          `No export ${invocation.target.exportId}. This plugin declares: ` +
            `${[...wired.keys()].join(", ") || "nothing"}.`,
        );
      }

      // Dependencies are scoped by the Host for this invocation. A plugin only contributes its
      // implementation; it cannot replace `store`, `reference`, `upload`, or `hostTools` with a
      // static object at assembly time. Besides making account scope ambiguous, a static override
      // would bypass the one process boundary where the Host can authorize and instrument access.
      const context = executorContextFrom(hostContext);

      if (entry.declaration.kind === "action") {
        const actionMode = (entry.bean as Record<symbol, string>)[ACTION_MODE];
        const step =
          actionMode === "executor"
            ? await actionExecutorStep(
                entry.declaration,
                entry.bean as Executor,
                invocation,
                context,
              )
            : await (entry.bean as Action).run(invocation, context);
        return normalise(invocation, step, context);
      }

      if (entry.declaration.kind === "provider-projector") {
        return {
          protocol: "clash.plugin.result/v1",
          invocationId: invocation.invocationId,
          status: "completed",
          outputs: [
            {
              slot: "projection",
              kind: "value",
              value: (entry.bean as ProjectorFn)(invocation),
            },
          ],
        } satisfies ExecutablePluginResult;
      }

      const executor = entry.bean as Executor;
      const step =
        invocation.operation === "poll"
          ? await requirePoll(entry.declaration, executor)(invocation, context)
          : invocation.operation === "callback"
            ? executor.callback
              ? await executor.callback(invocation, context)
              : {
                  status: "failed" as const,
                  error: unsupportedAcceptedOperation(
                    entry.declaration.id,
                    "callback",
                  ),
                }
            : await executor.submit(invocation, context);
      return normalise(invocation, step, context);
    },
  };

  return plugin;
}

async function actionExecutorStep(
  declaration: ManifestFunction,
  executor: Executor,
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  if (invocation.operation === "poll") {
    return requirePoll(declaration, executor)(invocation, context);
  }
  if (invocation.operation === "callback") {
    return executor.callback
      ? executor.callback(invocation, context)
      : {
          status: "failed",
          error: unsupportedAcceptedOperation(declaration.id, "callback"),
        };
  }
  return executor.submit(invocation, context);
}

function requirePoll(declaration: ManifestFunction, executor: Executor) {
  if (!executor.poll) {
    // Answering "still running" would wait forever: the host has already recorded an acceptance
    // this executor never returns from, which once left a paid-for generation uncollectable.
    throw new Error(
      `${declaration.id} answers at once and has no poll operation, but the host asked it to poll.`,
    );
  }
  return executor.poll.bind(executor);
}

async function normalise(
  invocation: ExecutablePluginInvocation,
  step: Awaited<ReturnType<Executor["submit"]>>,
  context: ExecutorContext,
): Promise<ExecutablePluginResult> {
  if (step.status === "accepted") {
    return {
      protocol: "clash.plugin.result/v1",
      invocationId: invocation.invocationId,
      status: "accepted",
      pollState: step.pollState,
      ...(step.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: step.retryAfterMs }),
    } satisfies ExecutablePluginResult;
  }
  if (step.status === "failed") {
    return {
      protocol: "clash.plugin.result/v1",
      invocationId: invocation.invocationId,
      status: "failed",
      error: step.error,
    } satisfies ExecutablePluginResult;
  }
  return {
    protocol: "clash.plugin.result/v1",
    invocationId: invocation.invocationId,
    status: "completed",
    // A media step names its files and the SDK stores them. This used to read
    // `"outputs" in step ? step.outputs : []`, which answered `[]` for exactly that shape: the
    // frame said completed, carried nothing, and the upload never happened.
    outputs:
      "media" in step ? await outputsFor(step.media, context) : step.outputs,
  } satisfies ExecutablePluginResult;
}

function manifestName(manifest: unknown): string {
  const id = (manifest as { id?: string }).id;
  return id ? `Plugin ${id}` : "The manifest";
}
