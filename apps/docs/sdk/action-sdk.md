# @clash-space/action-sdk

Types and adapters for action authors — both remote worker actions and
agent-authored **hosted executable plugins**.

```sh
pnpm add @clash-space/action-sdk
```

## Worker actions (request/response)

A worker action is an HTTP endpoint that receives an `ActionRequest` and
returns an `ActionResponse`:

```ts
import type { ActionRequest, ActionResponse } from "@clash-space/action-sdk";

export default {
  async fetch(request: Request): Promise<Response> {
    const req: ActionRequest = await request.json();
    // req.prompt, req.params, req.inputs (ActionInputNode[]), req.model?
    return Response.json({ type: "image", url: "…" } satisfies ActionResponse);
  },
};
```

Register it to a project:

```sh
clash action install --project <id> --repo owner/repo
```

`ActionManifest` / `ActionManifestParameter` / `ActionManifestSecret` type the
manifest the repo exposes.

## Hosted executable plugins

`defineHostedExecutablePlugin(handlers)` adapts a FaaS endpoint to the **same
invocation/result ABI as a local stdio plugin**. It takes a **map keyed by
`exportId`** (dispatch uses `invocation.target.exportId`) and returns a
`{ fetch }` worker:

```ts
import { defineHostedExecutablePlugin } from "@clash-space/action-sdk";

export default defineHostedExecutablePlugin({
  "my-gateway-execute": async (invocation, context) => {
    // identical shape to a local plugin's invoke:
    //   invocation.input.values / references, invocation.target, …
    const credential = await context.broker({
      kind: "credential.handle",
      secretId: "provider:my-gateway",
    });
    const response = await context.broker({
      kind: "network.fetch",
      url: "https://gateway.example/generate",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { prompt: invocation.input.values.prompt },
      credentialHandle: (credential as { handle: string }).handle,
    });
    return [{ slot: "media", kind: "value", value: { url: "…", contentType: "image/png" } }];
  },
});
```

A handler registered under the wrong key fails at runtime with
`No hosted plugin handler is registered for <exportId>.` — the key must equal
the `executorExportId` your provider/binding declares.

The handler reaches external capabilities **only** through the broker
advertised by request headers — the same security model as local plugins,
kernel-side.

All ABI types re-export from `@clash/shared-types`:
`ExecutablePluginInvocation`, `ExecutablePluginResult`,
`ExecutablePluginOutput`, `ExecutablePluginBrokerOperation`, …
