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
  - title: Contribution-defined Plugins
    details: Plugins declare the cards, providers, model bindings, and functions they add. Local executors use ordinary language libraries, with host context reserved for assets, account-scoped store values, and declared tools.
  - title: Record & Replay
    details: Provider HTTP traffic records at the process boundary to JSONL and replays offline without re-billing upstreams.
---
