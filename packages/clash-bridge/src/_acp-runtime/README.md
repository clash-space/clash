# Vendored copy of @open-managed-agents/acp-runtime

This directory is a verbatim copy of `packages/acp-runtime/src/` from the
[open-managed-agents](https://github.com/open-ma/open-managed-agents) repo.

It's vendored here only because that package isn't yet published to npm and
we need clash-bridge to be `npm publish`-able as a single self-contained
package. **Do not edit files in this directory** — change the upstream
package and re-vendor:

```bash
# from clash repo root
rm -rf packages/clash-bridge/src/_acp-runtime
cp -r ../open-managed-agents/packages/acp-runtime/src \
      packages/clash-bridge/src/_acp-runtime
```

When acp-runtime ships to npm, replace this directory with a normal
`@open-managed-agents/acp-runtime` dependency in package.json and import
paths (`./_acp-runtime/...` → `@open-managed-agents/acp-runtime`).
