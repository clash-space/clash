# @clash/action-sdk

`@clash/action-sdk` provides the transport-neutral typed invocation/result ABI
and Host-scoped dependencies for executable plugins.

```sh
pnpm add @clash/action-sdk
```

## One module, Host-selected realm

Assemble an inert `PluginModule` once. A trusted first-party package can be
invoked directly by the Local Host, while a distributable third-party
entrypoint serves the same module over stdio:

```ts
import {
  assemblePluginModule,
  defineAction,
  servePluginStdio,
} from "@clash/action-sdk";

export const pluginModule = assemblePluginModule({
  manifestDir: new URL("..", import.meta.url).pathname,
  contributes: {
    "make-preview": defineAction({
      async run(invocation, context) {
        return {
          status: "completed",
          outputs: [{ slot: "text", kind: "value", value: "preview ready" }],
        };
      },
    }),
  },
});

// Only the package's stdio entrypoint does this:
await servePluginStdio(pluginModule).done;
```

`assemblePlugin` remains compatibility sugar for a self-serving stdio package.
Module/process placement does not enter a plugin binding, Generator Definition,
or Action Run. A process is fault isolation, not a security sandbox.

## Generator Action executor

`defineAction` is submit-only sugar for work that completes in one invocation.
Use `defineActionExecutor` when an Action must return a Provider task and be
polled by the Host durable loop:

```ts
import { defineActionExecutor } from "@clash/action-sdk";

const analyze = defineActionExecutor({
  async submit(invocation, context) {
    const taskId = await startAnalysis(invocation, context);
    return { status: "accepted", pollState: { taskId } };
  },
  async poll(invocation, context) {
    const result = await readAnalysis(invocation.pollState, context);
    if (!result.done) {
      return { status: "accepted", pollState: invocation.pollState };
    }
    return {
      status: "completed",
      outputs: [
        await context.document({
          slot: "transcript",
          documentKind: "media.transcript",
          schemaVersion: 1,
          body: result.transcript,
        }),
      ],
    };
  },
});
```

Both helpers contribute semantic `kind: "action"`; submit/poll is private Task
execution, not a different Action kind. A Generator may register multiple
Actions, but the current Action profile declares exactly one output Asset per
Run. The shared ABI retains `value` for legacy/synchronous plugin results, but a
native Generator output contract accepts only a declared Media or Document
Asset.

## Provider executor

```ts
import {
  assemblePlugin,
  defineExecutor,
  ProviderExecutionError,
  providerHttpError,
} from "@clash/action-sdk";

const acmeExecutor = defineExecutor({
  async submit(invocation, context) {
    const apiKey = await context.store?.get("apiKey");
    if (!apiKey) {
      throw new ProviderExecutionError({
        code: "authentication_failed",
        message: "This Acme account has no apiKey stored.",
        retryable: false,
        requestState: "rejected",
      });
    }

    const response = await globalThis.fetch(
      "https://api.acme.example/v1/generations",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: invocation.input.values.prompt }),
      },
    );
    if (!response.ok) {
      throw providerHttpError({
        status: response.status,
        message: `Acme returned HTTP ${response.status}.`,
        operation: "submit",
      });
    }
    const body = (await response.json()) as { taskId: string };
    return { status: "accepted", pollState: { taskId: body.taskId } };
  },

  async poll(invocation, context) {
    // Read the same selected account from context.store, then poll with normal HTTP.
    return { status: "accepted", pollState: invocation.pollState as object };
  },
});

export const plugin = assemblePlugin({
  manifestDir: new URL("..", import.meta.url).pathname,
  contributes: { "acme-execute": acmeExecutor },
});

await plugin.start(); // Third-party process/stdio entrypoint.
```

The manifest contributes the `acme-execute` function. Assembly verifies that
the code supplies exactly that id and kind before the first invocation. There
is deliberately no `context` assembly option: only the Host invocation may
inject account/project-scoped SDK implementations.

## Executor context

The Host selects the provider account before invocation and injects typed,
already-scoped dependencies:

| API                            | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `context.store.get/put/remove` | Account credentials and settings                               |
| `context.reference(reference)` | Resolve typed text, Document, decoded bytes, or a Provider URL |
| `context.asset(request)`       | Persist a small typed Asset output                             |
| `context.upload(request)`      | Persist bytes or an upstream URL outside the result frame      |
| `context.document(request)`    | Return a typed Document output                                 |
| typed Asset/value outputs      | Return canonical values, Media Assets, or Documents            |

Store methods take a key, never an account id. Do not read credentials from
`invocation.input.values`; those values are user/model inputs and are not an
authorization channel.

## Direct I/O

Provider HTTP, uploads to vendor endpoints, downloads, and vendor error parsing
belong to the plugin. One invocation performs one semantic `submit` or `poll`;
retry policy, polling cadence, total lifetime, persistence, and restart
recovery belong to the Host Durable Run Engine. Use normal runtime libraries.
The SDK does not inject an HTTP client and the Host does not proxy vendor
traffic.

Known Provider verdicts must not be thrown as a plain `Error`. That erases the
HTTP status and request-boundary facts, leaving the Host with only a generic
`execution_failed` result. Use `providerHttpError` for HTTP responses and
`ProviderExecutionError` for validated Provider or contract failures so
`code`, `retryable`, and `requestState` remain explicit.

For tests, stub the runtime-level client (`globalThis.fetch`) or run under the
external traffic recorder/replayer. Production plugin code stays unchanged.

## References and Assets: delivery v0

Asset delivery is permanently named `v0`; it is not a temporary version label.
Compatible changes extend that same contract. The canonical forms are `bytes`,
`provider-url`, `text`, and `document`; the retired `url + reach` dialect is
not a second version.

Resolve every Clash reference through `context.reference`. Adapt the returned
form according to the vendor API:

```ts
const resolved = await context.reference(invocation.input.references[0]);

if (resolved.form === "bytes") {
  await uploadVendorFile(resolved.bytes, resolved.mediaType);
} else if (resolved.form === "provider-url") {
  await submitVendorUrl(resolved.providerUrl);
} else if (resolved.form === "document") {
  await submitStructuredInput(resolved.body, {
    kind: resolved.documentKind,
    schemaVersion: resolved.schemaVersion,
  });
} else {
  await submitVendorText(resolved.text);
}
```

The broker wire uses `bytesBase64`; the SDK decodes it before plugin business
code sees the `bytes` form. Provider URLs use the explicit `provider-url`
discriminant, and `context.reference` is the only resolution API. Return small
results as typed media or with `context.asset`. Use `context.upload` for large
bytes or an upstream result URL so the result carries a handle rather than the
media payload. Use `context.document` only for a declared Document output; the
Host validates its kind and schema version before publication.

Provider executors return media only as
`{ slot: "media", kind: "asset", asset: handle }`. They return synchronous text
as `{ slot: "text", kind: "value", value: string }`. A free-form media object in
the value channel is not a compatibility path; ingest or upload it first and
return the Host-issued handle.

The retired Project-level HTTP Worker action protocol is not part of this SDK.
There is one executable-plugin invocation/result ABI; a future Cloud Host must
adapt that same ABI and inject the same scoped context instead of introducing a
second `ActionRequest`/`ActionResponse` surface.

See [Asset + Generator Model](/guide/asset-generator-model) and
[Document Assets](/guide/document-assets) for the semantic contracts and their
current product-delivery boundary.
