import { executorContextFrom, type ExecutorContext } from "./define-plugin.js";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  ExecutablePluginInvocationSchema,
  type ExecutablePluginInvocation,
  type ExecutablePluginOutput,
  type ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

/**
 * The stdio transport, so a plugin author does not write one.
 *
 * `defineHostedExecutablePlugin` has been here all along: a hosted author writes a handler and the
 * SDK does the framing. A stdio author had no counterpart and hand-wrote the same loop each time --
 * `createInterface`, `JSON.parse(line)`, `process.stdout.write(JSON.stringify(result) + "\n")`.
 *
 * Three copies existed, and they had already drifted. first-party-media answers malformed input by
 * building a sentinel object and passing it to the handler; codex-imagegen writes a failure frame
 * directly. Neither is wrong, and that is the point: framing was a decision each author had to make,
 * repeatedly, about something that is not their plugin.
 *
 * What is left to the author is the whole of their job: take an invocation, call the vendor,
 * translate the answer. Submit and poll, nothing else.
 */

export type StdioExecutablePluginHandler = (
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
) => Promise<ExecutablePluginResult | ExecutablePluginOutput[]>;

export interface StdioExecutablePluginOptions {
  stdin?: Readable;
  stdout?: Writable;
  /** How a handler reaches the host for account-scoped state and assets. */
  context?: Partial<ExecutorContext>;
  /** How long to wait for one Host dependency response. Defaults to 30s. */
  hostRequestTimeoutMs?: number;
}

export interface StdioExecutablePlugin {
  /** Resolves when the input stream ends and every in-flight invocation has answered. */
  readonly done: Promise<void>;
}

function failure(
  invocationId: string,
  message: string,
): ExecutablePluginResult {
  return {
    invocationId,
    status: "failed",
    error: { code: "execution_failed", message, retryable: false },
  } as ExecutablePluginResult;
}

export function defineStdioExecutablePlugin(
  handlers: Record<string, StdioExecutablePluginHandler>,
  options: StdioExecutablePluginOptions = {},
): StdioExecutablePlugin {
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;

  /**
   * Calls the host is waiting on, keyed by the id it will answer with.
   *
   * Raw protocol calls stay here. Handlers receive only the typed context built below.
   */
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  let hostRequestSeq = 0;
  const hostRequestTimeoutMs = options.hostRequestTimeoutMs ?? 30_000;

  /**
   * Bind the Host channel to one invocation.
   *
   * A process can serve several lines concurrently. The Host resolves the account and task from
   * the invocation id on each request, so this cannot read a process-global "current" id: a slower
   * first handler may call the Host after a second line has started. A closure makes the identity
   * immutable for the lifetime of the handler that received it.
   */
  const hostRequestFor = (
    invocationId: string,
  ): NonNullable<Parameters<typeof executorContextFrom>[1]> =>
    (async (operation: unknown): Promise<unknown> => {
      const requestId = `b-${++hostRequestSeq}`;
      return await new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        writeFrame({
          protocol: "clash.plugin.broker-request/v1",
          requestId,
          invocationId,
          operation,
        });

        // A host that never answers must not hold the invocation open forever. The host has its own
        // timeout, but it names the plugin -- "contract:... timed out" -- while this names the call
        // that went unanswered, which is the difference between looking at the plugin and looking at
        // the wiring between them.
        const timer = setTimeout(() => {
          if (!pending.delete(requestId)) return;
          reject(
            new Error(
              `The host did not answer ${(operation as { kind?: string })?.kind ?? "a dependency request"} ` +
                `within ${hostRequestTimeoutMs}ms.`,
            ),
          );
        }, hostRequestTimeoutMs);
        timer.unref?.();
      });
    }) as NonNullable<Parameters<typeof executorContextFrom>[1]>;

  /**
   * Build the contribution-shaped context a handler sees. The operation request function remains
   * private to this transport closure and cannot be called by plugin business code.
   */
  const handlerContextFor = (
    invocationId: string,
  ): ExecutorContext =>
    executorContextFrom(options.context, hostRequestFor(invocationId));

  const lines = createInterface({ input, crlfDelay: Infinity });
  const inFlight: Promise<void>[] = [];

  /**
   * Write a frame exactly as given.
   *
   * `write` below stamps the result protocol onto everything it sends, which is right for results
   * and wrong for a broker request -- one stamped `clash.plugin.result/v1` is read by the host as an
   * answer to an invocation nobody made.
   */
  const writeFrame = (frame: unknown): void => {
    output.write(`${JSON.stringify(frame)}\n`);
  };

  const write = (result: unknown): void => {
    // One reply per line. Serialising the promise instead of the value writes `{}` and leaves the
    // host waiting on a plugin that has already answered.
    // Every frame names the protocol it speaks. The host dispatches on it -- a frame without one
    // matches neither the result branch nor the broker branch and is dropped in silence, so a
    // correct answer that arrived on time surfaces minutes later as an invocation timeout.
    //
    // Set here rather than at each construction site, because it is a property of writing a frame
    // and not of any one result. The hand-written entry this SDK replaced set it inline, and losing
    // it during the rewrite made every executor and projector unreachable at once.
    output.write(
      `${JSON.stringify({
        protocol: "clash.plugin.result/v1",
        ...(result as object),
      })}\n`,
    );
  };

  lines.on("line", (line) => {
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      // Not a crash. A plugin that dies on one malformed line takes every queued generation with it.
      write(
        failure(
          "unknown",
          `Plugin received malformed JSON: ${(error as Error).message}`,
        ),
      );
      return;
    }

    // A broker answer belongs to a call this plugin is already waiting on, not to a new invocation.
    // Falling through to invocation parsing would report "invalid invocation" for a perfectly good
    // reply and leave the original call pending forever.
    const protocol = (parsed as { protocol?: unknown })?.protocol;
    if (protocol === "clash.plugin.broker-response/v1") {
      const answer = parsed as {
        requestId?: string;
        status?: string;
        result?: unknown;
        error?: { code?: string; message?: string };
      };
      const waiting = answer.requestId
        ? pending.get(answer.requestId)
        : undefined;
      if (!waiting) return;
      pending.delete(answer.requestId!);
      if (answer.status === "error") {
        // A refusal is an answer. Leaving the promise pending would stall the invocation until the
        // host's own timeout, which names the plugin rather than the refusal.
        waiting.reject(
          new Error(
            `${answer.error?.code ?? "host_dependency_error"}: ${answer.error?.message ?? "the host refused"}`,
          ),
        );
      } else {
        waiting.resolve(answer.result);
      }
      return;
    }

    const invocationId = (parsed as { invocationId?: unknown })?.invocationId;
    const id =
      typeof invocationId === "string" && invocationId
        ? invocationId
        : "unknown";

    let invocation: ExecutablePluginInvocation;
    try {
      invocation = ExecutablePluginInvocationSchema.parse(parsed);
    } catch (error) {
      write(
        failure(
          id,
          `Plugin received an invalid invocation: ${(error as Error).message}`,
        ),
      );
      return;
    }

    const handler = handlers[invocation.target.exportId];
    if (!handler) {
      // Naming the export and what is registered turns "nothing happened" into one line of reading.
      write(
        failure(
          id,
          `No handler is registered for ${invocation.target.exportId}. ` +
            `This plugin exports: ${Object.keys(handlers).join(", ") || "nothing"}.`,
        ),
      );
      return;
    }

    inFlight.push(
      handler(invocation, handlerContextFor(invocation.invocationId) as never)
        .then((result) => {
          // A handler may return just outputs, or a whole result. Either way the answer carries the
          // id of the line it answers -- a reply the host cannot match is a hung invocation.
          const value = Array.isArray(result)
            ? { invocationId: id, status: "completed", outputs: result }
            : { ...result, invocationId: result.invocationId ?? id };
          write(value);
        })
        .catch((error: unknown) => {
          // One failed invocation is not a failed plugin; the next line still gets an answer.
          // Where it was thrown goes to stderr, not into the message. A plugin failure crosses a
          // process boundary as a string, and without a location the host reports something like
          // "Cannot read properties of undefined (reading 'byteLength')" with no indication of
          // which layer produced it -- four rounds of guessing, in one case. But contract tests
          // compare the message word for word, so appending a file and line to it makes every
          // expectation depend on the shape of a bundle.
          const frame = (error as Error)?.stack?.split("\n")[1]?.trim();
          if (frame)
            console.error(`[plugin] ${(error as Error)?.message} ${frame}`);
          write(failure(id, (error as Error)?.message ?? String(error)));
        }),
    );
  });

  const done = new Promise<void>((resolve) => {
    lines.on("close", () => {
      void Promise.allSettled(inFlight).then(() => resolve());
    });
  });

  return { done };
}
