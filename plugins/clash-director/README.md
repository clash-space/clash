# Clash Director Codex plugin

An installable, agent-first interface for Project Director Stages. It bundles
typed `clash_director_*` tools, a tokenized MCP App, a shell-free adapter to
`clash director`, and a workflow skill. Stage writes always read first and use
the CLI's normal projection/apply revision behavior.

AI panoramas use the existing Canvas `image-gen` workflow. Provider output is
requested at the closest native 21:9 ratio, normalized to a full-frame 2:1 WebP
(2048x1024 or 4096x2048), registered as a Project image asset, and bound to the
Stage by asset ID. Optional image references support scene-to-360 conversion.

```bash
pnpm test:package @clash/director-plugin
pnpm typecheck:package @clash/director-plugin
pnpm build:package @clash/director-plugin
```
