# @clash/action-sdk

`@clash/action-sdk` provides the typed invocation/result ABI and Host-scoped
dependencies for executable plugins.

```sh
pnpm add @clash/action-sdk
```

## Provider executor

```ts
import { assemblePlugin, defineExecutor } from "@clash/action-sdk";

const acmeExecutor = defineExecutor({
  async submit(invocation, context) {
    const apiKey = await context.store?.get("apiKey");
    if (!apiKey) throw new Error("This Acme account has no apiKey stored.");

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
    if (!response.ok) throw new Error(`Acme returned HTTP ${response.status}.`);
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

await plugin.start();
```

The manifest contributes the `acme-execute` function. Assembly verifies that
the code supplies exactly that id and kind before the first invocation. There
is deliberately no `context` assembly option: only the Host invocation may
inject account/project-scoped SDK implementations.

## Executor context

The Host selects the provider account before invocation and injects typed,
already-scoped dependencies:

| API                            | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `context.store.get/put/remove` | Account credentials and settings                   |
| `context.reference(reference)` | Resolve typed text, decoded bytes, or a Provider URL |
| `context.asset(request)`       | Persist a small typed Asset output                 |
| `context.upload(request)`      | Persist bytes or an upstream URL outside the stdio frame |
| typed media/value outputs      | Return canonical text and project assets           |

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

For tests, stub the process-level client (`globalThis.fetch`) or run under the
external traffic recorder/replayer. Production plugin code stays unchanged.

## References and media

Resolve every Clash reference through `context.reference`. Adapt the returned
form according to the vendor API:

```ts
const resolved = await context.reference(invocation.input.references[0]);

if (resolved.form === "bytes") {
  await uploadVendorFile(resolved.bytes, resolved.mediaType);
} else if (resolved.form === "provider-url") {
  await submitVendorUrl(resolved.providerUrl);
} else {
  await submitVendorText(resolved.text);
}
```

The broker wire uses `bytesBase64`; the SDK decodes it before plugin business
code sees the `bytes` form. There is no public `url`/`forwardable` reference
shape and no second `resolveAssetReference` helper. Return small results as
typed media or with `context.asset`. Use `context.upload` for large bytes or an
upstream result URL so the stdio result carries a handle rather than the media
payload.

The retired Project-level HTTP Worker action protocol is not part of this SDK.
There is one executable-plugin invocation/result ABI; a future Cloud Host must
adapt that same ABI and inject the same scoped context instead of introducing a
second `ActionRequest`/`ActionResponse` surface.
