import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";

import { definePlugin } from "./define-plugin";

/**
 * A plugin declares what it exports. It does not wire a dispatcher.
 *
 * Before the SDK, the entry file read stdin, parsed lines, matched `target.exportId` against a
 * table, split submit from poll, normalised the executor's step into a result, and wrote frames.
 * Three plugins each carried a version of that, and they had already drifted.
 *
 * None of it is the plugin's subject. What the author actually knows is which executors exist and
 * what each one does with a vendor's API, so that is all this takes.
 */
function run(plugin: ReturnType<typeof definePlugin>, lines: string[]) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdout.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  const started = plugin.start({ stdin, stdout });
  for (const line of lines) stdin.write(`${line}\n`);
  stdin.end();
  return { written, started };
}

const invocation = (exportId: string, operation = "submit", invocationId = "i-1") => JSON.stringify({
  protocol: "clash.plugin.invoke/v1",
  invocationId,
  taskId: "t-1",
  projectId: "p-1",
  nodeId: "n-1",
  target: {
    pluginId: "test.plugin",
    version: "1.0.0",
    schemaHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    exportId,
    kind: "provider-executor",
  },
  operation,
  input: { values: {}, references: [] },
  // The protocol requires a poll to carry the state the plugin returned when it accepted the work.
  // A poll without it names no task, which is the shape of a wait that can never end.
  ...(operation === "poll" ? { pollState: { taskId: "task-1" } } : {}),
  actor: { kind: "agent" },
});

describe("definePlugin", () => {
  it("takes executors and nothing else", async () => {
    const submit = vi.fn(async () => ({ status: "completed" as const, outputs: [] }));
    const plugin = definePlugin({ executors: { "x-execute": { submit } } });
    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(submit).toHaveBeenCalledOnce();
    expect(written.join("")).toContain("completed");
  });

  it("routes poll to the executor's poll", async () => {
    // The submit/poll split is the SDK's, because every asynchronous provider has the same one.
    const submit = vi.fn(async () => ({ status: "accepted" as const, pollState: { id: "1" } }));
    const poll = vi.fn(async () => ({ status: "completed" as const, outputs: [] }));
    const plugin = definePlugin({ executors: { "x-execute": { submit, poll } } });
    const { written, started } = run(plugin, [invocation("x-execute", "poll")]);
    await started;
    expect(poll).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(written.join("")).toContain("completed");
  });

  it("says so when asked to poll an executor that cannot", async () => {
    // A synchronous provider has nothing to poll. Answering "still running" would wait forever; the
    // host once accepted work from a plugin that declared no poll and could never collect it.
    const plugin = definePlugin({
      executors: { "x-execute": { submit: async () => ({ status: "completed" as const, outputs: [] }) } },
    });
    const { written, started } = run(plugin, [invocation("x-execute", "poll")]);
    await started;
    expect(written.join("")).toMatch(/poll/i);
    expect(written.join("")).toContain("failed");
  });

  it("names the exports it has when asked for one it does not", async () => {
    const plugin = definePlugin({
      executors: { "a-execute": { submit: async () => ({ status: "completed" as const, outputs: [] }) } },
    });
    const { written, started } = run(plugin, [invocation("b-execute")]);
    await started;
    expect(written.join("")).toContain("a-execute");
  });
});

/**
 * The store arrives as an argument, not as an import.
 *
 * An imported store would be ambient: initialised somewhere, addressed by a plugin id from
 * somewhere, and reachable by any code in the process. Handed in, it is already bound to this
 * plugin and this account, and the executor has no way to name another — the identity is not a
 * parameter it can pass, it is a property of the object it was given.
 *
 * The transport details that back this never appear in plugin code at all. The SDK owns them.
 */
describe("store is injected", () => {
  it("reaches the executor through its context", async () => {
    const store = { get: vi.fn(async () => "sk-test"), put: vi.fn(), remove: vi.fn() };
    let seen: string | undefined;

    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => {
            seen = await context.store!.get("apiKey");
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: { store },
    });

    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(seen).toBe("sk-test");
    expect(store.get).toHaveBeenCalledWith("apiKey");
  });

  it("takes a key and nothing that could address another plugin", async () => {
    // If `get` accepted a plugin id, isolation would be a naming convention.
    const store = { get: vi.fn(async () => undefined), put: vi.fn(), remove: vi.fn() };
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => {
            await context.store!.get("apiKey");
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: { store },
    });

    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(store.get).toHaveBeenCalledWith("apiKey");
    expect(store.get.mock.calls[0]).toHaveLength(1);
  });
});

/**
 * Bytes become an asset before they become an output.
 *
 * The protocol's output is a handle -- `{ assetId, uri: "clash-asset://…", kind, mediaType }` -- and
 * every executor here was returning `{ kind: "inline", dataBase64 }` instead. It type-checked only
 * because the plugin had declared its own looser contract; against the real one it does not compile,
 * which is the same break the runtime would have had.
 *
 * So the SDK offers the step that was missing: hand it bytes, get back the handle the protocol
 * wants. The host writes them to content-addressed storage on the way past.
 */
describe("asset outputs", () => {
  it("turns bytes into a handle through the typed asset context", async () => {
    const asset = vi.fn(async (request: { slot: string }) => ({
      slot: request.slot,
      kind: "asset" as const,
      asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image" as const,
        mediaType: "image/png",
      },
    }));

    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.asset!({
              slot: "media",
              kind: "image",
              mediaType: "image/png",
              dataBase64: "AAAA",
            })],
          }),
        },
      },
      context: { asset },
    });

    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;

    expect(asset).toHaveBeenCalledWith(expect.objectContaining({ slot: "media" }));
    const frame = JSON.parse(written.join("").trim()) as { outputs: { asset: { uri: string } }[] };
    expect(frame.outputs[0]?.asset.uri).toBe("clash-asset://asset-1");
  });

  it("does not put the bytes in the answer", async () => {
    // The frame carries a handle. Returning the base64 as well would send the payload twice.
    const asset = vi.fn(async (request: { slot: string }) => ({
      slot: request.slot,
      kind: "asset" as const,
      asset: { assetId: "a", uri: "clash-asset://a", kind: "image" as const, mediaType: "image/png" },
    }));
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.asset!({
              slot: "media", kind: "image", mediaType: "image/png", dataBase64: "SECRETBYTES",
            })],
          }),
        },
      },
      context: { asset },
    });
    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(written.join("")).not.toContain("SECRETBYTES");
  });
});

/**
 * Large results are uploaded, not enclosed.
 *
 * `asset.write` with `dataBase64` puts the whole payload inside a JSON frame. One 30-second video
 * from Gemini Omni is 3,470,456 characters that way, and the plugin, the pipe and the host each hold
 * a copy while the frame is parsed.
 *
 * An upload slot moves the bytes out of the protocol: the host names a place, the plugin streams to
 * it, and the frame carries only the handle. It is the same shape a hosted deployment already needs
 * — there the URL is presigned object storage instead of a loopback port — so this is not a local
 * shortcut.
 *
 * Inline stays for small results. A 2 KB thumbnail does not need a round trip.
 */
describe("upload slots", () => {
  it("preserves the storage projection when the host ingests a provider url", async () => {
    const upload = vi.fn(async (request: { slot: string }) => ({
      slot: request.slot,
      kind: "asset" as const,
      asset: {
        assetId: "asset-provider-url",
        uri: "clash-asset://asset-provider-url",
        kind: "video" as const,
        mediaType: "video/mp4",
        url: "http://127.0.0.1:8787/assets/projects/p/plugins/out.mp4",
        reach: "private" as const,
      },
    }));
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.upload!({
              slot: "media",
              kind: "video",
              mediaType: "video/mp4",
              url: "https://provider.example/out.mp4",
            } as never)],
          }),
        },
      },
      context: { upload },
    });

    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    const frame = JSON.parse(written.join("").trim()) as {
      outputs: Array<{ asset: { url?: string; reach?: string } }>;
    };
    expect(frame.outputs[0]?.asset).toMatchObject({
      url: "http://127.0.0.1:8787/assets/projects/p/plugins/out.mp4",
      reach: "private",
    });
  });

  it("hands bytes to the typed upload context and returns only the handle", async () => {
    const upload = vi.fn(async (request: { slot: string }) => ({
      slot: request.slot,
      kind: "asset" as const,
      asset: { assetId: "asset-9", uri: "clash-asset://asset-9", kind: "video" as const, mediaType: "video/mp4" },
    }));

    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.upload!({
              slot: "media",
              kind: "video",
              mediaType: "video/mp4",
              bytes: Buffer.from("a video"),
            })],
          }),
        },
      },
      context: { upload },
    });

    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;

    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      slot: "media",
      bytes: Buffer.from("a video"),
    }));
    const frame = JSON.parse(written.join("").trim()) as { outputs: { asset: { uri: string } }[] };
    expect(frame.outputs[0]?.asset.uri).toBe("clash-asset://asset-9");
  });

  it("does not put the bytes in the frame", async () => {
    const upload = vi.fn(async (request: { slot: string }) => ({
      slot: request.slot,
      kind: "asset" as const,
      asset: { assetId: "a", uri: "clash-asset://a", kind: "video" as const, mediaType: "video/mp4" },
    }));

    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.upload!({
              slot: "media", kind: "video", mediaType: "video/mp4",
              bytes: Buffer.from("RECOGNISABLE"),
            })],
          }),
        },
      },
      context: { upload },
    });
    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(written.join("")).not.toContain("RECOGNISABLE");
  });

  it("fails loudly when the upload is rejected", async () => {
    // A refused upload with a completed-looking result would attach an empty asset and close the
    // task as though it had worked.
    const upload = vi.fn(async () => {
      throw new Error("Uploading media failed: 507 Insufficient Storage.");
    });

    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, context) => ({
            status: "completed" as const,
            outputs: [await context.upload!({
              slot: "media", kind: "video", bytes: Buffer.from("x"),
            })],
          }),
        },
      },
      context: { upload },
    });
    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(written.join("")).toContain("failed");
    expect(written.join("")).toMatch(/507|Insufficient/);
  });
});

/**
 * An executor returns data. The SDK does the I/O.
 *
 * Calling `context.upload()` was still a request the author had to remember to make, in the right
 * order, with the right slot. Returning the files instead makes the executor a function from an
 * invocation to a result — which is what it is — and leaves uploading, handles and output shape to
 * the one place that should know about them.
 *
 * Three forms, because that is what vendors return: Google answers `:generateContent` with base64,
 * fal publishes a url, and an SDK client hands back bytes. A plugin that had to normalise these
 * would be converting a url into bytes by downloading it — paying for a round trip to satisfy a
 * shape.
 */
describe("declared media", () => {
  function uploadingContext() {
    const uploaded: { slot: string; bytes?: Uint8Array; url?: string }[] = [];
    return {
      uploaded,
      context: {
        upload: async (request: { slot: string; bytes?: Uint8Array; url?: string; mediaType?: string }) => {
          uploaded.push({ slot: request.slot, bytes: request.bytes, url: request.url });
          return {
            slot: request.slot,
            kind: "asset",
            asset: {
              assetId: request.slot,
              uri: `clash-asset://${request.slot}`,
              kind: "image",
              mediaType: request.mediaType,
            },
          };
        },
      } as never,
    };
  }

  it("uploads bytes a plugin returned", async () => {
    const { context, uploaded } = uploadingContext();
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: { "image-1": { bytes: Buffer.from("PNGDATA"), mediaType: "image/png" } },
          }),
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(uploaded).toHaveLength(1);
    expect(Buffer.from(uploaded[0]!.bytes!).toString()).toBe("PNGDATA");
  });

  it("decodes base64 a plugin returned", async () => {
    const { context, uploaded } = uploadingContext();
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: {
              "image-1": { base64: Buffer.from("PNGDATA").toString("base64"), mediaType: "image/png" },
            },
          }),
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(Buffer.from(uploaded[0]!.bytes!).toString()).toBe("PNGDATA");
  });

  it("passes a url through without fetching it", async () => {
    // The bytes never enter the plugin. Downloading them to satisfy a shape would pay for a round
    // trip the host can make itself, or skip entirely if it only needs the address.
    const { context, uploaded } = uploadingContext();
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: { "image-1": { url: "https://example.test/a.png", mediaType: "image/png" } },
          }),
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(uploaded[0]!.url).toBe("https://example.test/a.png");
    expect(uploaded[0]!.bytes).toBeUndefined();
  });

  it("keeps several files, named by the plugin", async () => {
    const { context, uploaded } = uploadingContext();
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: {
              "frame-1": { base64: "AAAA", mediaType: "image/png" },
              "frame-2": { base64: "BBBB", mediaType: "image/png" },
            },
          }),
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(uploaded.map((entry) => entry.slot)).toEqual(["frame-1", "frame-2"]);
  });

  it("refuses a file that states none of the three", async () => {
    // A name with nothing behind it would upload an empty asset and report success.
    const { context } = uploadingContext();
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: { "image-1": { mediaType: "image/png" } as never },
          }),
        },
      },
      context,
    });
    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(written.join("")).toContain("failed");
    expect(written.join("")).toMatch(/image-1/);
  });
});

/**
 * The store arrives in the context; a plugin never builds a transport frame.
 *
 * `await context.store.get("apiKey")` is the whole surface. The plugin knows which keys it wrote,
 * because it wrote them, and the host does not know what a vendor's auth looks like -- Google wants
 * an api key on one surface and a bearer token on another, kling wants an access key and a secret.
 *
 * Injected rather than imported, so a test drives the whole executor without a database, and so a
 * hosted deployment can back the same two calls with something else entirely.
 */
describe("store", () => {
  function storeContext(values: Record<string, string>) {
    const store = {
      get: async (key: string) => values[key],
      put: async (key: string, value: string) => {
        values[key] = value;
      },
      remove: async (key: string) => {
        delete values[key];
      },
    };
    return { values, context: { store } };
  }

  it("reads a value by key", async () => {
    let seen: string | undefined;
    const { context } = storeContext({ apiKey: "AIza-secret" });
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, ctx) => {
            seen = await ctx.store!.get("apiKey");
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(seen).toBe("AIza-secret");
  });

  it("writes one back, which is how a plugin renews its own token", async () => {
    const { values, context } = storeContext({});
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, ctx) => {
            await ctx.store!.put("accessToken", "ya29-fresh", { secret: true });
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(values.accessToken).toBe("ya29-fresh");
  });

  it("answers undefined for a key that was never stored", async () => {
    // Distinguishable from an empty string, which is what a missing credential used to become on
    // its way to a vendor -- producing a 401 that named the wrong problem.
    let seen: string | undefined = "unset";
    const { context } = storeContext({});
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (_invocation, ctx) => {
            seen = await ctx.store!.get("apiKey");
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context,
    });
    const { started } = run(plugin, [invocation("x-execute")]);
    await started;
    expect(seen).toBeUndefined();
  });
});

/**
 * Input arrives the same way output leaves.
 *
 * An executor returns `{ media: { name: { base64 | bytes | url } } }` and the SDK stores it. But a
 * reference arrived as a handle the plugin had to resolve itself, by sending a raw frame -- so
 * one plugin had two idioms: return data, but fetch data.
 *
 * The asymmetry is not cosmetic. `resolveAssetReference` had to be imported and remembered, and an
 * executor that forgot produced a request carrying `clash-asset://...` where a vendor expected an
 * image. Handing the same three forms in as come out means neither side has an idiom to learn.
 */
describe("references", () => {
  function referenceContext(resolved: Record<string, unknown>) {
    return {
      reference: async (input: unknown) => {
        const reference = input as {
          text?: { value?: string };
          asset?: { assetId?: string; url?: string; reach?: string; kind?: string; mediaType?: string };
        };
        if (reference.text) return { form: "text", text: reference.text.value ?? "" };
        if (reference.asset?.url && reference.asset.reach === "public") {
          return { form: "url", url: reference.asset.url, kind: reference.asset.kind };
        }
        const answer = resolved[reference.asset?.assetId ?? ""] as {
          dataBase64?: string; kind?: string; mediaType?: string;
        } | undefined;
        // Loud rather than undefined: an unstubbed read used to surface as "expected undefined to
        // be bytes", which names the assertion and not the missing fixture.
        if (!answer?.dataBase64) throw new Error(`no bytes for asset ${reference.asset?.assetId}`);
        return {
          form: "bytes",
          bytes: Uint8Array.from(Buffer.from(answer.dataBase64, "base64")),
          kind: answer.kind,
          mediaType: answer.mediaType,
        };
      },
    } as never;
  }

  // `invocation()` returns a JSON string, so a reference is spliced into the parsed object and
  // re-serialised rather than spread over it.
  function withReferences(references: unknown[]): string {
    const parsed = JSON.parse(invocation("x-execute")) as { input: unknown };
    parsed.input = { values: {}, references };
    return JSON.stringify(parsed);
  }

  function invocationWithReference(asset: Record<string, unknown>): string {
    return withReferences([{ slot: "image", index: 0, asset }]);
  }

  it("hands a public url straight through, without fetching it", async () => {
    // The bytes never enter the plugin. Downloading them to hand a vendor a URL it could have
    // fetched itself pays for a round trip twice.
    let seen: unknown;
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (inv, ctx) => {
            seen = await ctx.reference!(inv.input.references[0]!);
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: referenceContext({}),
    });
    const { started } = run(plugin, [invocationWithReference({
      assetId: "a1", uri: "clash-asset://a1", kind: "image",
      url: "https://cdn.example.test/a.png", reach: "public",
    })]);
    await started;
    expect(seen).toMatchObject({ form: "url", url: "https://cdn.example.test/a.png" });
  });

  it("reads the bytes when only the host can reach them", async () => {
    // A private asset's URL is useless to a vendor: it answers 403, and the generation fails for a
    // reason naming the vendor rather than the reach.
    let seen: { form: string; bytes?: Uint8Array } | undefined;
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (inv, ctx) => {
            seen = await ctx.reference!(inv.input.references[0]!) as never;
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: referenceContext({
        a1: { kind: "image", mediaType: "image/png", dataBase64: Buffer.from("PNGDATA").toString("base64") },
      }),
    });
    const { written, started } = run(plugin, [invocationWithReference({
      assetId: "a1", uri: "clash-asset://a1", kind: "image",
    })]);
    await started;

    // Read the frame before the value. A rejected handle or a throw inside submit comes back as a
    // `failed` frame carrying the reason; asserting on `seen` alone reported "expected undefined to
    // be bytes", which names the assertion and hides the cause.
    const frame = JSON.parse(written.join("")) as { status: string; error?: { message?: string } };
    expect(frame.error?.message ?? frame.status).toBe("completed");
    expect(seen?.form).toBe("bytes");
    expect(Buffer.from(seen!.bytes!).toString()).toBe("PNGDATA");
  });

  it("does not forward a url the vendor cannot reach", async () => {
    // Caught by mutation: widening the reach check to accept anything still passed every test,
    // because no case held a handle that had a url AND was private. That is the dangerous shape --
    // an address that looks usable and answers 403 from the vendor's side.
    let seen: { form: string } | undefined;
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (inv, ctx) => {
            seen = await ctx.reference!(inv.input.references[0]!) as never;
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: referenceContext({
        a1: { kind: "image", mediaType: "image/png", dataBase64: Buffer.from("PRIVATE").toString("base64") },
      }),
    });
    const { started } = run(plugin, [invocationWithReference({
      assetId: "a1", uri: "clash-asset://a1", kind: "image",
      url: "http://127.0.0.1:8788/assets/a1.png", reach: "private",
    })]);
    await started;
    expect(seen?.form).toBe("bytes");
  });

  it("says so when the host returns no bytes", async () => {
    // Caught by mutation: returning an empty Uint8Array instead of throwing passed everything.
    // Empty bytes reach the vendor and come back as a decode error attributed to the image, which
    // sends the reader to the wrong end of the chain.
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (inv, ctx) => {
            await ctx.reference!(inv.input.references[0]!);
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: referenceContext({ a1: { kind: "image", mediaType: "image/png" } }),
    });
    const { written, started } = run(plugin, [invocationWithReference({
      assetId: "a1", uri: "clash-asset://a1", kind: "image",
    })]);
    await started;
    const frame = JSON.parse(written.join("")) as { status: string; error?: { message?: string } };
    expect(frame.status).toBe("failed");
    expect(frame.error?.message).toContain("a1");
  });

  it("hands text through as text, not as an asset to fetch", async () => {
    let seen: unknown;
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async (inv, ctx) => {
            seen = await ctx.reference!(inv.input.references[0]!);
            return { status: "completed" as const, outputs: [] };
          },
        },
      },
      context: referenceContext({}),
    });
    const { started } = run(plugin, [
      withReferences([{ slot: "prompt", index: 0, text: { nodeId: "n1", value: "a leaf" } }]),
    ]);
    await started;
    expect(seen).toMatchObject({ form: "text", text: "a leaf" });
  });
});

/**
 * A vendor that answers with a URL never hands over bytes.
 *
 * `outputsFor` passes the three declared media forms to `upload`, but `upload` opened a slot by
 * announcing `request.bytes.byteLength` unconditionally -- so the url form died on
 * "Cannot read properties of undefined (reading 'byteLength')", which names neither the slot nor
 * the form.
 *
 * It survived because every test used bytes or base64. hrhrng.hub is the first executor here whose
 * vendor replies with a link, and it failed after a real generation had already completed
 * upstream: the work was done and paid for, and the result was dropped on the way home.
 *
 * A URL is passed through rather than fetched. Downloading it to hand the host something it could
 * fetch itself pays for the transfer twice, and the host is the side that knows whether it wants a
 * copy.
 */
describe("uploading a url", () => {
  it("hands the typed upload context an address without a byte count", async () => {
    let asked: Record<string, unknown> | undefined;
    const plugin = definePlugin({
      executors: {
        "x-execute": {
          submit: async () => ({
            status: "completed" as const,
            media: { media: { url: "https://cdn.example.test/out.png", mediaType: "image/png" } },
          }),
        },
      },
      context: {
        upload: async (request) => {
          asked = { ...request };
          return {
            slot: request.slot,
            kind: "asset",
            asset: { assetId: "a-1", uri: "clash-asset://a-1", kind: "image", mediaType: "image/png" },
          } as never;
        },
      },
    });

    const { written, started } = run(plugin, [invocation("x-execute")]);
    await started;

    const frame = JSON.parse(written.join("").trim()) as { status: string; error?: { message: string } };
    expect(frame.error?.message ?? frame.status).toBe("completed");
    // Nothing was downloaded, so there is no byte count to announce.
    expect(asked?.byteLength).toBeUndefined();
  });
});
