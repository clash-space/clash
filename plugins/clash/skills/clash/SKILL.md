---
name: clash
description: Operate a Clash video project through either the Clash CLI or its peer stdio MCP transport. Use when an agent needs to initialize a workspace, discover current commands or tools progressively, mutate product state, or verify a persisted result.
---

# Use Clash

Clash has two peer transports over the same product state: the `clash` CLI and
the Clash stdio MCP server. Choose the transport that is actually available in
the current agent session. Do not invoke one transport through a wrapper in the
other, and do not expect repository-level AGENTS instructions to provide the
product manual.

## Establish the collaboration runtime

Treat the Clash daemon as a prerequisite for product work, not as part of the
creative outcome. The normal CLI or MCP entry point owns the daemon probe and
start: invoke it normally, let it reuse a compatible daemon or start one when
none exists, and treat its readiness error as authoritative. Do not manually
launch an internal JavaScript entrypoint, a second daemon command, or a
background substitute.

Some headless environments establish the workspace binding and daemon before
the agent starts. When they provide a ready receipt, use that project as-is and
do not run init or start a daemon again. If readiness cannot be established,
stop with an infrastructure error. Never replace a failed product operation
with handwritten lookalike state, a direct FFmpeg render, or other
filesystem-only evidence.

## Confirm the workspace

Resolve the intended working directory before writing. Initialization creates
only the Clash project binding under `.clash/project.toml`; it must not replace
the repository's own instructions or source files.

- CLI: run `clash init --json`, or `clash init --project <id> --json` when the
  project identity is known.
- MCP: call `clash_workspace_init` with the absolute `cwd` and optional
  `projectId`.

Both entry points return the same initialization contract. Inspect the result:
`reused: false` means a new local project binding was created; `reused: true`
means the existing project binding was preserved. A conflicting requested
project identity must fail rather than overwrite `.clash/project.toml`.

Do not assume every working directory is new. If it is already bound, continue
with the returned `projectId`; if it is unbound, let init generate a local ID or
provide the explicitly intended ID. In a runner-managed headless workspace,
init is infrastructure-owned and should already be complete before the task is
handed to the agent.

## Navigate progressively

For CLI work, begin with the built-in command tree:

```text
clash --help
clash <command> --help
```

Common command groups include `canvas`, `timeline`, and `director`. Read the
current help before using an unfamiliar subcommand; use `--json` when the
command supports structured output.

For MCP work, use the root `clash` tool only for navigation. Call it without
arguments for the menu, then with `command` to receive the stable dispatcher:

- Use `clash_canvas` for Canvas operations.
- Use `clash_composition` for both temporal composition in Timeline and spatial
  composition in Director Stage. Pass `kind: "timeline"` for Timeline or
  `kind: "director-stage"` for Director Stage when revealing contracts or using
  a short operation.

Call the selected dispatcher without `operation` to reveal live contracts, then
call that dispatcher with `operation` and `arguments` to execute. Each contract
includes `operation`, the command-local short name such as `get`, and `name`,
the complete `clash_*` leaf name retained for compatibility. Prefer the short
name on the appropriate dispatcher. The advertised tool list does not change.
Use each operation's live description, schemas, structured result, and recovery
guidance; there are no `clash_cli_*` MCP namespace wrappers.

## Operate and verify

Read the smallest relevant state before changing it. Preserve returned IDs,
revisions, read proofs, and copy-on-write boundaries. If a guarded mutation is
stale, Clash will automatically pull the latest projection into the reported
`.clash/recovery` path while preserving the edited projection. Inspect both,
merge the intended change into the latest state, and retry through the same
guarded path. Clash will never automatically replay or resubmit a stale edit.
If a write says a read is required, read first and rebase; never force an
overwrite or manufacture a revision token. Treat an accepted render or
generation request as submission, not completion; follow the returned identity
and read product state again before claiming a finished artifact.

Files in the working tree are drafts and inputs. A claimed product outcome must
be persisted through Clash and read back from the same project. If the product
path is unavailable, report that limitation honestly instead of manufacturing
a substitute artifact outside Clash.

Use the specialist Director, Timeline, motion-graphics, or finishing skill for
creative judgment. This skill owns transport navigation and product evidence,
not the artistic recipe.
