import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ExecutablePluginInvocation,
  ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

import { defineStdioExecutablePlugin, type StdioExecutablePluginOptions } from "./stdio-plugin.js";
import { outputsFor, type Executor, type ExecutorContext , ExecutorStep, executorContextFrom} from "./define-plugin.js";

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

export type ProjectorFn = (invocation: ExecutablePluginInvocation) => unknown;

/** Pure arithmetic on an invocation: no network, no credentials, no host calls. */
export function defineProjector(project: ProjectorFn): ProjectorFn {
  return Object.assign(project, { [KIND]: "provider-projector" as const });
}

/** Talks to a vendor. Receives credentials and a host context; may split submit from poll. */
export function defineExecutor(executor: Executor): Executor {
  return Object.assign(executor, { [KIND]: "provider-executor" as const });
}

export interface Action {
  run: (invocation: ExecutablePluginInvocation, context: ExecutorContext) => Promise<ExecutorStep>;
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
 * `run` rather than `submit`/`poll`, because the split exists to model a vendor that answers later,
 * and an action the plugin performs itself has no such seam. It returns the same declarative media
 * an executor returns, so there is one idiom for handing back a file rather than one per kind.
 */
export function defineAction(action: Action): Action {
  return Object.assign(action, { [KIND]: "action" as const });
}

interface ManifestFunction {
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
  context?: ExecutorContext;
}

export interface AssembledPlugin {
  /**
   * @param hostContext dependencies scoped by the host for this invocation.
   */
  invoke(
    invocation: ExecutablePluginInvocation,
    hostContext?: Partial<ExecutorContext>,
  ): Promise<ExecutablePluginResult>;
  contributes: ManifestFunction[];
  /** Read invocations from stdin and write result frames to stdout until the stream ends. */
  start(options?: StdioExecutablePluginOptions): Promise<void>;
}

export function assemblePlugin(options: AssembleOptions): AssembledPlugin {
  const manifest = JSON.parse(
    readFileSync(join(options.manifestDir, "manifest.json"), "utf8"),
  ) as { contributes?: { functions?: ManifestFunction[] } };
  const declared = manifest.contributes?.functions ?? [];

  const wired = new Map<string, { declaration: ManifestFunction; bean: unknown }>();
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
        `${declaration.id} is declared ${declaration.kind} in the manifest `
        + `but defined as ${definedKind} in code.`,
      );
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

  const plugin: AssembledPlugin = {
    contributes: declared,
    start: (stdioOptions) =>
      defineStdioExecutablePlugin(
        Object.fromEntries(
          // The second argument is the typed Host context the stdio layer builds per invocation.
          // Dropping it -- which this did, by taking only `invocation` -- meant every assembled
          // executor ran with no Host dependencies, and hrhrng.hub then reported "This MiniMax Hub
          // account has no accessToken stored" for an account that was configured and a host that
          // was ready to answer. The frame was never sent.
          [...wired.keys()].map((id) => [id, (
            invocation: ExecutablePluginInvocation,
            hostContext: unknown,
          ) => plugin.invoke(invocation, hostContext as ExecutorContext)]),
        ),
        stdioOptions,
      ).done,
    async invoke(invocation, hostContext) {
      const entry = wired.get(invocation.target.exportId);
      if (!entry) {
        throw new Error(
          `No export ${invocation.target.exportId}. This plugin declares: `
          + `${[...wired.keys()].join(", ") || "nothing"}.`,
        );
      }

      // The Host context comes first, then whatever the plugin declared statically for testing.
       // Dropping the per-invocation context -- which this did, by taking `options.context ?? {}` -- left an
       // assembled executor with no `context.store` at all.
       //
       // hrhrng.hub failed exactly here, reporting "This MiniMax Hub account has no accessToken
       // stored. Sign in, or paste a token". The account was configured; the plugin had no way to
       // read it. A message about the user's configuration for a
       // fault in our wiring is the expensive kind of wrong.
      const context = executorContextFrom(
        { ...hostContext, ...options.context } as ExecutorContext,
      );

      if (entry.declaration.kind === "action") {
        const step = await (entry.bean as Action).run(invocation, context);
        return normalise(invocation, step, context);
      }

      if (entry.declaration.kind === "provider-projector") {
        return {
          invocationId: invocation.invocationId,
          status: "completed",
          outputs: [{
            slot: "projection",
            kind: "value",
            value: (entry.bean as ProjectorFn)(invocation),
          }],
        } as ExecutablePluginResult;
      }

      const executor = entry.bean as Executor;
      const step = invocation.operation === "poll"
        ? await requirePoll(entry.declaration, executor)(invocation, context)
        : await executor.submit(invocation, context);
      return normalise(invocation, step, context);
    },
  };

  return plugin;
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
      invocationId: invocation.invocationId,
      status: "accepted",
      pollState: step.pollState,
      ...(step.retryAfterMs === undefined ? {} : { retryAfterMs: step.retryAfterMs }),
    } as ExecutablePluginResult;
  }
  return {
    invocationId: invocation.invocationId,
    status: "completed",
    // A media step names its files and the SDK stores them. This used to read
    // `"outputs" in step ? step.outputs : []`, which answered `[]` for exactly that shape: the
    // frame said completed, carried nothing, and the upload never happened.
    outputs: "media" in step ? await outputsFor(step.media, context) : step.outputs,
  } as ExecutablePluginResult;
}

function manifestName(manifest: unknown): string {
  const id = (manifest as { id?: string }).id;
  return id ? `Plugin ${id}` : "The manifest";
}
