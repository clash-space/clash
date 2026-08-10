---
layout: home

hero:
  name: Clash Developer Docs
  text: Local-first AI video production
  tagline: Model cards, provider plugins, and SDKs — documented from the code that ships.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Build a Provider Plugin
      link: /plugins/overview

features:
  - title: One Card, Many Providers
    details: A model card is the provider-neutral contract for one model. Providers attach through implementations or plugin bindings, with per-provider parameter overrides.
  - title: Sandboxed Executable Plugins
    details: Plugin code runs with no direct network access. Every outbound call goes through the capability broker with credential handles, domain allowlists, and audit records.
  - title: Record & Replay
    details: Provider HTTP traffic — including plugin broker traffic — records to JSONL and replays offline without re-billing upstreams.
---
