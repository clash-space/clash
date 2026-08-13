import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutablePluginResultSchema } from "@clash/shared-types/executable-plugin";

import { assemblePlugin, defineExecutor, defineProjector } from "./assemble.js";

/**
 * The manifest declares; the module implements; the id is the only shared name.
 *
 * An export used to be named three times -- as `id` and again as `handler` in `manifest.json`, and
 * a third time as the key of a `PROJECTORS` or `EXECUTORS` table in code. The three drifted:
 * `google-execute` was written, tested and bound to thirteen routes while the installed manifest
 * never declared it, so the host answered "does not export provider-executor google-execute" and
 * the path stayed unreachable until a generation happened to hit it.
 *
 * The manifest keeps what the host must know without running anything -- the contribution ids and
 * their kinds. The implementation is keyed by the same id. No `handler` indirection: a
 * name that exists only to point at another name is a name that can point at nothing.
 */
function manifestDir(functions: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "assemble-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    id: "test.plugin",
    version: "0.1.0",
    contributes: { functions },
  }));
  return dir;
}

describe("assembling a plugin from its manifest", () => {
  it("wires an implementation to the export the manifest declares", async () => {
    const dir = manifestDir([{ id: "x-project", kind: "provider-projector", }]);
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: { "x-project": defineProjector(() => ({ endpoint: "vendor/model" })) },
    });
    const result = await plugin.invoke({
      invocationId: "i1",
      target: { exportId: "x-project", kind: "provider-projector" },
      input: { values: {}, references: [] },
    } as never);
    ExecutablePluginResultSchema.parse(result);
    expect(result.status).toBe("completed");
    expect((result as { outputs: { value: unknown }[] }).outputs[0]!.value)
      .toEqual({ endpoint: "vendor/model" });
  });

  it("refuses a declared export with no implementation", () => {
    // The failure that motivated this: a declared export with nothing behind it was only discovered
    // when a generation reached it, hours after activation reported success.
    const dir = manifestDir([{ id: "x-execute", kind: "provider-executor" }]);
    expect(() => assemblePlugin({ manifestDir: dir, contributes: {} }))
      .toThrow(/x-execute/);
  });

  it("refuses an implementation the manifest does not declare", () => {
    // The other direction, and the one that hid google-execute: code the host can never reach,
    // which passes its own tests and looks finished.
    const dir = manifestDir([]);
    expect(() => assemblePlugin({
      manifestDir: dir,
      contributes: { "x-execute": defineProjector(() => ({})) },
    })).toThrow(/x-execute/);
  });

  it("refuses an export whose kind disagrees with what the code defines", () => {
    // A projector that runs on the executor path would be handed credentials it never asked for.
    const dir = manifestDir([{ id: "x", kind: "provider-executor" }]);
    expect(() => assemblePlugin({
      manifestDir: dir,
      contributes: { x: defineProjector(() => ({})) },
    })).toThrow(/provider-executor/);
  });

  it("carries the submit and poll split for an executor", async () => {
    const dir = manifestDir([{
      id: "x-execute",
      kind: "provider-executor",
      operations: ["submit", "poll"],
    }]);
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-execute": defineExecutor({
          submit: async () => ({ status: "accepted" as const, pollState: { id: "job-1" } }),
          poll: async () => ({ status: "completed" as const, outputs: [] }),
        }),
      },
    });
    const accepted = await plugin.invoke({
      invocationId: "i1",
      operation: "submit",
      target: { exportId: "x-execute", kind: "provider-executor" },
      input: { values: {}, references: [] },
    } as never);
    ExecutablePluginResultSchema.parse(accepted);
    expect(accepted.status).toBe("accepted");
  });

  it("routes callback to the declared callback handler without submitting again", async () => {
    const dir = manifestDir([{
      id: "x-execute",
      kind: "provider-executor",
      operations: ["submit", "poll", "callback"],
    }]);
    let submissions = 0;
    let callbacks = 0;
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-execute": defineExecutor({
          submit: async () => {
            submissions += 1;
            return { status: "accepted" as const, pollState: { id: "job-1" } };
          },
          callback: async () => {
            callbacks += 1;
            return { status: "completed" as const, outputs: [] };
          },
        }),
      },
    });

    const result = await plugin.invoke({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "i-callback",
      taskId: "task-1",
      projectId: "project-1",
      operation: "callback",
      callbackPayload: { taskId: "job-1", status: "done" },
      target: {
        pluginId: "test.plugin",
        version: "0.1.0",
        exportId: "x-execute",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-executor",
      },
      input: { values: {}, references: [] },
      actor: { kind: "system", id: "host" },
    });

    expect(result.status).toBe("completed");
    expect(callbacks).toBe(1);
    expect(submissions).toBe(0);
  });

  it("preserves a structured executor failure", async () => {
    const dir = manifestDir([{ id: "x-execute", kind: "provider-executor" }]);
    const error = {
      code: "execution_failed" as const,
      message: "provider rejected the request",
      retryable: true,
      requestState: "rejected" as const,
      providerCode: "quota_exceeded",
      details: { limit: 10 },
    };
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-execute": defineExecutor({
          submit: async () => ({ status: "failed" as const, error }),
        }),
      },
    });

    await expect(plugin.invoke({
      invocationId: "i-failed",
      operation: "submit",
      target: { exportId: "x-execute", kind: "provider-executor" },
      input: { values: {}, references: [] },
    } as never)).resolves.toMatchObject({ status: "failed", error });
    ExecutablePluginResultSchema.parse(await plugin.invoke({
      invocationId: "i-failed-envelope",
      operation: "submit",
      target: { exportId: "x-execute", kind: "provider-executor" },
      input: { values: {}, references: [] },
    } as never));
  });
});

/**
 * Every frame names the protocol it speaks.
 *
 * The host dispatches on it: `protocol === "clash.plugin.result/v1"` selects the result path, and a
 * frame without one falls through both branches and is dropped in silence. The plugin had answered
 * correctly and the host had received the bytes -- the only symptom was the invocation timing out
 * minutes later, naming the invocation rather than the missing field.
 *
 * The hand-written entry this SDK replaced set it. Losing it during that rewrite made every
 * executor and projector unreachable at once, and no test caught it because each side was tested
 * against itself.
 */
describe("result frames", () => {
  function frames(written: string[]) {
    return written.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  it("names the protocol on a completed result", async () => {
    const dir = manifestDir([{ id: "x-project", kind: "provider-projector" }]);
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: { "x-project": defineProjector(() => ({ endpoint: "vendor/model" })) },
    });
    const written: string[] = [];
    await plugin.start({
      stdin: Readable.from([JSON.stringify({
          protocol: "clash.plugin.invoke/v1",
          invocationId: "i1",
          projectId: "p",
          taskId: "t",
          operation: "submit",
          target: {
            pluginId: "test.plugin",
            version: "0.1.0",
            schemaHash: `sha256:${"0".repeat(64)}`,
            exportId: "x-project",
            kind: "provider-projector",
          },
          input: { values: {}, references: [] },
          actor: { kind: "system", id: "test" },
        }) + "\n"]) as never,
      stdout: { write: (chunk: string) => { written.push(chunk); return true; } } as never,
    });
    expect(frames(written)[0]).toMatchObject({
      protocol: "clash.plugin.result/v1",
      status: "completed",
    });
  });

  it("names it on a failure too, which is how a host learns the work is over", async () => {
    // A failure frame the host drops leaves the invocation pending until it times out, reporting a
    // timeout for work that already failed for a stated reason.
    const dir = manifestDir([{ id: "x-project", kind: "provider-projector" }]);
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-project": defineProjector(() => { throw new Error("bad parameters"); }),
      },
    });
    const written: string[] = [];
    await plugin.start({
      stdin: Readable.from(["not json\n"]) as never,
      stdout: { write: (chunk: string) => { written.push(chunk); return true; } } as never,
    });
    expect(frames(written)[0]).toMatchObject({ protocol: "clash.plugin.result/v1", status: "failed" });
  });
});

/**
 * A declarative media step has to reach the host.
 *
 * `definePlugin` grew `media` -- an executor names its files and the SDK uploads them -- but
 * `assemblePlugin` normalised results with `"outputs" in step ? step.outputs : []`, and a media step
 * has no `outputs` key. So it returned an empty array: no upload was attempted, and the frame
 * reported `completed` with nothing in it.
 *
 * Nothing failed. The generation was paid for upstream, the host recorded success, and the node
 * ended up with no asset. Both first-party Providers reach the host this way.
 */
describe("a completed step that names media", () => {
  it("uploads the files and returns the outputs the host stores", async () => {
    const dir = manifestDir([{ id: "x-execute", kind: "provider-executor" }]);
    const uploaded: { slot: string; kind: string; mediaType?: string; bytes?: Uint8Array }[] = [];
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-execute": defineExecutor({
          submit: async () => ({
            status: "completed" as const,
            media: {
              media: { base64: Buffer.from("PNG").toString("base64"), mediaType: "image/png" },
            },
          }),
        }),
      },
    });

    const result = await plugin.invoke({
      invocationId: "i1",
      target: { exportId: "x-execute", kind: "provider-executor" },
      input: { values: {}, references: [] },
    } as never, {
      upload: async (request: { slot: string; kind: string }) => {
        uploaded.push(request as never);
        return {
          slot: request.slot,
          kind: "asset",
          asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" },
        };
      },
    } as never);

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.kind).toBe("image");
    expect(Buffer.from(uploaded[0]!.bytes!).toString()).toBe("PNG");
    expect((result as { outputs: unknown[] }).outputs).toHaveLength(1);
  });

  it("still returns hand-built outputs untouched", async () => {
    const dir = manifestDir([{ id: "x-execute", kind: "provider-executor" }]);
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "x-execute": defineExecutor({
          submit: async () => ({
            status: "completed" as const,
            outputs: [{ slot: "media", kind: "value", value: { text: "hi" } }] as never,
          }),
        }),
      },
    });
    const result = await plugin.invoke({
      invocationId: "i1",
      target: { exportId: "x-execute", kind: "provider-executor" },
      input: { values: {}, references: [] },
    } as never);
    expect((result as { outputs: { value: unknown }[] }).outputs[0]!.value).toEqual({ text: "hi" });
  });
});

/**
 * A manifest may declare three kinds; the SDK defines two.
 *
 * `exports.functions` carries `action`, `provider-projector` and `provider-executor`, and real
 * plugins use all three -- `clash.codex-imagegen` exports an action, `clash.media` exports both
 * projectors and executors. But `defineExecutor` and `defineProjector` are the only two tags, and
 * dispatch tests for `provider-projector` and treats everything else as an executor.
 *
 * So an action falls into the executor branch and is asked for `.submit`, which it does not have.
 * The failure arrives as a property access on undefined, at invocation time, naming neither the
 * export nor its kind.
 *
 * The assembly-time check is the one that matters: it is the same argument that made assemblePlugin
 * refuse an undeclared implementation, after `google-execute` stayed invisible for exactly as long
 * as nothing compared the two lists.
 */
describe("declared kinds the SDK does not define", () => {
  it("refuses an action at assembly, not at invocation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "assemble-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.actions",
      version: "0.1.0",
      name: "test",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs", args: [] },
      contributes: { functions: [{ id: "generate-image", kind: "action" }] },
    }));

    // Tagged as an executor because that is the only tag available for something that runs. The
    // manifest says `action`, and the mismatch has to be named rather than silently accepted.
    expect(() => assemblePlugin({
      manifestDir: dir,
      contributes: { "generate-image": defineExecutor({ submit: async () => ({ status: "completed", outputs: [] }) }) },
    })).toThrow(/declared action in the manifest but defined as provider-executor/);
  });
});

/**
 * An assembled plugin gets the same context a defined one gets.
 *
 * `definePlugin` receives typed Host dependencies per invocation. `assemblePlugin` once dropped
 * that context and left an assembled executor with no `context.store` at all.
 *
 * hrhrng.hub failed on exactly this, and the failure said "This MiniMax Hub account has no
 * accessToken stored. Sign in, or paste a token", which describes an unconfigured account. The
 * account was configured; the plugin had no way to read it.
 * A message about the user's configuration for a fault in the wiring is the expensive kind.
 */
describe("assembled context", () => {
  it("gives the executor the Host-scoped store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "assemble-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      apiVersion: "clash.plugin/v1",
      id: "test.ctx",
      version: "0.1.0",
      name: "test",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs", args: [] },
      contributes: { functions: [{ id: "needs-a-key", kind: "provider-executor" }] },
    }));

    let seen: string | undefined;
    const plugin = assemblePlugin({
      manifestDir: dir,
      contributes: {
        "needs-a-key": defineExecutor({
          submit: async (_invocation, context) => {
            seen = await context.store?.get("apiKey");
            return { status: "completed", outputs: [] };
          },
        }),
      },
    });

    await plugin.invoke({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "i-1", taskId: "t-1", projectId: "p-1",
      target: {
        pluginId: "test.ctx", version: "0.1.0",
        schemaHash: `sha256:${"0".repeat(64)}`,
        exportId: "needs-a-key", kind: "provider-executor",
      },
      input: { values: {}, references: [] },
      actor: { kind: "system", id: "test" },
    } as never, {
      store: {
        get: async (key: string) => key === "apiKey" ? "key-from-the-host" : undefined,
        put: async () => undefined,
        remove: async () => undefined,
      },
    });

    expect(seen).toBe("key-from-the-host");
  });
});
