# Plugin identity

A plugin id is `publisher.name`.

```
clash.google
clash.minimax
acme.video-tools
```

Two dot-separated segments. Each segment is lowercase letters, digits and hyphens, and starts with
a letter or digit. Nothing else is an id.

## Why a publisher segment

The same shape VS Code settled on — `ms-python.python`, `dbaeumer.vscode-eslint` — and for the same
reason. Without it, the first third party to publish a plugin called `google` collides with ours,
and a route bound to `google` silently starts resolving somewhere else.

The publisher segment is what makes two people's `google` plugin two plugins.

## The version is not part of the id

```json
{
  "id": "clash.google",
  "version": "1.4.0"
}
```

The version travels beside the id, never inside it. An updated plugin is the same plugin, which is
what lets a route bound to `clash.google` keep working across an upgrade.

The corollary is worth stating plainly: **an id is an identity, not a permission.** Whoever
publishes the next version publishes under the same name. What an id is good for is telling two
plugins apart — not deciding what one is allowed to do. The manifest declares contributions; the
Host uses their SDK shape to bind project and account-scoped dependencies. Ordinary process network,
filesystem, and library access is not a manifest permission surface; see
[Host-scoped SDK Context](./sdk-context.md).

## During development

You do not need a registered publisher to start. Use a placeholder:

```json
{
  "id": "local-dev.my-plugin",
  "version": "0.1.0"
}
```

Change it before you publish. The id is how installs, routes and activation receipts find each
other, so renaming later means re-binding every route that named the old one — decide the real name
early.

## The id is not the directory

```
plugins/hrhrng-hub/            ← directory on disk
  manifest.json                ← "id": "hrhrng.hub"
```

They are decoupled deliberately. The install location is keyed by id, the source tree is organised
however the author likes, and neither has to follow the other.

## Where it is enforced

One rule, in one place: `pluginIdSchema` in `@clash/shared-types`.

```ts
import { pluginIdSchema, parsePluginId } from "@clash/shared-types";

pluginIdSchema.parse("clash.google");        // ok
pluginIdSchema.parse("google");              // throws: needs a publisher
pluginIdSchema.parse("clash.google.image");  // throws: a plugin id is publisher.name
pluginIdSchema.parse("clash.google@1.2.0");  // throws: the version is not part of the id

parsePluginId("clash.google");               // { publisher: "clash", name: "google" }
```

`clash plugin create` validates through the same schema, so an id that will not install is
refused while you are still typing the command that made it — rather than at activation, as a regex
in a schema error, in a file you had not opened.
