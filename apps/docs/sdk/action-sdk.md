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
the code supplies exactly that id and kind before the first invocation.

## Executor context

The Host selects the provider account before invocation and injects typed,
already-scoped dependencies:

| API                            | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `context.store.get/put/remove` | Account credentials and settings                   |
| `context.reference(reference)` | Resolve a typed text/bytes/URL reference           |
| `context.upload(request)`      | Stream large bytes into Host-managed asset storage |
| typed media/value outputs      | Return canonical text and project assets           |

Store methods take a key, never an account id. Do not read credentials from
`invocation.input.values`; those values are user/model inputs and are not an
authorization channel.

## Direct I/O

Provider HTTP, uploads to vendor endpoints, downloads, retries, and error
parsing belong to the plugin. Use normal runtime libraries. The SDK does not
inject an HTTP client and the Host does not proxy vendor traffic.

For tests, stub the process-level client (`globalThis.fetch`) or run under the
external traffic recorder/replayer. Production plugin code stays unchanged.

## References and media

Resolve every Clash reference through `context.reference`. Adapt the returned
form according to the vendor API:

```ts
const resolved = await context.reference?.(invocation.input.references[0]);

if (resolved?.form === "bytes") {
  await uploadVendorFile(resolved.bytes, resolved.mediaType);
} else if (resolved?.form === "url") {
  await submitVendorUrl(resolved.url);
}
```

Return small results as typed media. Use `context.upload` for large bytes so
the stdio frame carries a handle rather than base64 payloads.

## Worker actions

Project-level HTTP worker actions still use `ActionRequest` and
`ActionResponse`:

```ts
import type { ActionRequest, ActionResponse } from "@clash/action-sdk";

export default {
  async fetch(request: Request): Promise<Response> {
    const input = (await request.json()) as ActionRequest;
    return Response.json({
      type: "text",
      content: `Received: ${input.prompt}`,
    } satisfies ActionResponse);
  },
};
```

This HTTP action surface is separate from the executable-plugin stdio
runtime.
