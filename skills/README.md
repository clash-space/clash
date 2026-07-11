# Clash Skill Marketplace

This folder contains first-party Clash skills that can be installed or loaded by
agent runtimes. The registry is intentionally checked into the repository so the
marketplace can be reviewed, versioned, and tested like product code.

## Files

- `registry.json`: first-party marketplace entries.
- `registry.schema.json`: JSON schema for registry shape.
- `skill-market.test.mjs`: local integrity test for registry and `SKILL.md`
  files.
- `video-production/`: production skills for common video and image workflows.

## Design Rules

- A skill is a portable workflow and artifact contract. It should be useful from
  an agent's working directory even when Clash is not the execution runtime.
- Portable execution means an agent can follow the skill from its own cwd and
  produce readable files, manifests, metadata, and generated assets without
  depending on Clash internals.
- Clash is the collaboration and management layer: project state, asset registry,
  metadata fill, provenance, review gates, timeline CAS apply, and canvas/timeline
  projections.
- Skills depend on host capability contracts, not Clash private storage or UI
  internals. Clash is one host implementation for collaboration, permissioning,
  project state, and apply/review management.
- `actions` in `registry.json` are host bindings for discoverable local CLI
  production primitives. They do not make a skill Clash-only; they describe how
  Clash can trigger the same portable workflow, which artifacts it expects, and
  where explicit apply commands and cwd-observation CAS are required.
- Each action should also name the contract tests that prove the trigger command
  and produced artifacts are real, so the marketplace cannot drift away from
  executable system capability.
- Managed execution means Clash hosts or coordinates the same workflow as
  project-state changes with permissions, review, provenance, and CAS protection.
- Architecture skills define system shape, storage, safety, and QA gates.
- Detail skills define one production workflow such as short drama, MV, 口播,
  TVC/reference remix, or image storyboard consistency.
- Skills can ask agents to edit files, but product state enters canvas/timeline
  through explicit CLI or host APIs with CAS.
- `requiredSystemCapabilities` is a compatibility field for Clash-native
  automation bindings. It is not a gate for running a skill as a local
  file/artifact workflow.
- Missing Clash-native automation coverage must be declared in `registry.json`
  instead of hidden inside prose. A `blocked-by-system-gap` skill is blocked for
  fully managed Clash execution, not for portable drafting or artifact emission.
- Third-party projects are tracked as references in `thirdPartyReferences`.
  Research sources are not vendored by default. Code, model, or prompt reuse
  requires matching the upstream license, preserving required notices, and
  passing review for AGPL, noncommercial, custom, or unverified licenses.
