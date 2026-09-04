---
name: clash
description: Operate every Clash project workflow through the Clash MCP or peer CLI, including Canvas, Assets, Project media generation or editing, background Generator runs, Timeline, and Director Stage. Use this skill whenever the current workspace is a Clash project or the user asks Clash to create, generate, edit, import, arrange, or verify an image, video, audio, or other project artifact; product-owned media must not escape to a global generation tool.
---

# Use Clash

Clash has two peer interfaces over the same product state: the `clash` CLI and
the plugin stdio MCP surface. They expose the same capabilities and semantics,
so choose one interface from the capabilities already available in the current
agent session. When a Clash MCP dispatcher is present, use it directly without
probing the CLI first. Use CLI help when CLI is the selected interface, and
switch interfaces only when the selected one is unavailable. Both call the
discovered `local-api` host directly; do not invoke one through the other or
recreate product behavior, Project state, or daemon ownership in either
interface. Do not expect repository-level AGENTS instructions to provide the
product manual.

## Establish the collaboration runtime

Treat the Clash daemon as a prerequisite for product work, not as part of the
creative outcome. The normal CLI or plugin MCP bootstrap owns host discovery:
invoke it normally, let it reuse a compatible `local-api` host or start the
bundled host when none exists, and treat its readiness error as authoritative.
Do not manually launch an internal JavaScript entrypoint, a second daemon
command, or a background substitute.

Some headless environments establish the workspace binding and daemon before
the agent starts. When they provide a ready receipt, use that project as-is and
do not run init or start a daemon again. If readiness cannot be established,
stop with an infrastructure error. Never replace a failed product operation
with handwritten lookalike state, a direct FFmpeg render, or other
filesystem-only evidence.

An MCP startup, CLI startup, or transport error is not evidence that a
workspace is unbound or uninitialized. Preserve any existing project binding;
report or recover the runtime failure through the selected interface, and
switch to the peer interface only when the first interface is unavailable. Do
not respond to a transport failure by running init.

## Confirm the workspace

Resolve the intended working directory before writing. An existing
`.clash/project.toml` is the workspace binding: use it immediately and do not
run `clash init` or call `clash_workspace_init`. The first product action in a
bound project should be the narrowest relevant read or operation. A
runner-provided ready receipt has the same meaning and also skips init.

Only run `clash init` or call `clash_workspace_init` when the user explicitly
asks to create or bind a Clash workspace and `.clash/project.toml` is missing.
Initialization creates only that project binding; it must not replace the
repository's own instructions or source files:

- CLI: use `clash init --json`, or `clash init --project <id> --json` when the
  project identity is known.
- MCP: use `clash_workspace_init` with the absolute `cwd` and optional
  `projectId`.

Both entry points return the same initialization contract. Inspect the result:
`reused: false` means a new local project binding was created; `reused: true`
means the existing project binding was preserved. A conflicting requested
project identity must fail rather than overwrite `.clash/project.toml`.

Do not assume every working directory is new or backed by Git. If it is already
bound, continue with the marker's `projectId`; if it is unbound and binding was
explicitly requested, let init generate a local ID or provide the intended ID.
In a runner-managed headless workspace, init is infrastructure-owned and should
already be complete before the task is handed to the agent.

## Navigate progressively

For CLI work, navigate from the narrowest level already named by the task. If
the task already names a command group, skip the root help. If it also names
the needed operations, skip the group menu and read only unfamiliar leaf help
for argument shapes. Use the built-in command tree when the group or operation
is actually unknown:

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

Call the selected dispatcher without `operation` to reveal its lightweight
operation index when the needed operation names are not already known. Keep
that index for the task; never request the same index twice. Before one
unfamiliar call, request its full live contract with
`contract: "<operation>"`. When the task needs several unfamiliar operations,
request their contracts together in one ordered
`contracts: ["<operation>", "<operation>"]` call. Then execute each operation
with `operation` and `arguments`. Each index entry and contract includes
`operation`, the command-local short name such as `get`, and `name`, the
complete `clash_*` leaf name retained for compatibility. Prefer the short name
on the appropriate dispatcher. The advertised tool list does not change. Use
the selected operation's live description, schemas, structured result, and
recovery guidance; there are no `clash_cli_*` MCP namespace wrappers.

For the common Asset workflow, a task that already names Asset `import`,
`list`, and `get` does not need the index first: use `clash_assets` and request
the `import_file`, `list`, and `get` contracts together, then execute those
short operations. Use the index when the required Asset operation is not
already identified.

## Route project media generation through Clash

In a Clash project, generated or edited media is product state: the request,
background run, immutable output, and Canvas relationship must remain visible
to Clash. Use the `clash_generators` dispatcher for Project media generation
instead of calling a global `imagegen`, `image_gen`, video-generation, or other
standalone media tool. A global generator may be an implementation detail used
inside a Clash plugin, but the agent-facing turn must enter through Clash so
the output is persisted as a Project Asset rather than returned as an orphaned
file.

Use the live Generator contracts rather than guessing a provider-specific
payload:

1. Discover the matching definition with `definitions_list` and read the exact
   one with `definition_get` when it is not already known.
2. Create or read the Project Generator with `create` or `get`, preserving its
   returned Generator and Revision identities.
3. Submit the requested Action against that exact Revision with
   `action_run_submit`. Submission starts a background task; it is not proof of
   a finished asset.
4. Poll the returned Action Run with `action_run_get` until it reaches a
   terminal state, then read each persisted output through
   `output_commit_get`.
5. Use `clash_assets` or `clash_canvas` only for the next product operation,
   such as reading the committed Asset or placing/connecting it on Canvas.

If a required Generator definition or action is unavailable, report the Clash
capability gap. Do not silently fall back to a global media skill, write a
lookalike file, or claim that an external tool result belongs to the Project.

## Fill plugin Views as structured Project drafts

A plugin View is a `plugin-view` Canvas node, normally on the implicit `main`
Canvas. Read it with `clash_canvas_get` before changing it. For the Storyboard
View, preserve all four top-level groups: `keyElements`, `shots`,
`audioLayers`, and `uncategorized`. An element, shot, or audio entry owns
material slots; each slot owns zero or more Project Asset candidates and an
optional `selectedCandidateId`. Shot descriptions may contain structured
`entity-reference` parts rather than flattened display text.

Apply the complete draft through `clash_canvas_update` using `viewState`, or
edit a workspace JSON draft and pass `viewStateFile`. The Host validates the
whole View state under the node read receipt, so preserve entries you did not
intend to change and re-read after applying. Never patch the immutable View
definition reference.

When filling a material slot through generation, follow the native Generator
workflow above first. After `output_commit_get`, add the committed Project Asset
as a candidate and retain `generatorId`, `generatorRevisionId`, `actionRunId`,
`outputCommitId`, and `outputSlot` in `generatedBy`. Selecting a final candidate
is a separate View update; the View plugin itself contributes no Generator.

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
a substitute artifact outside Clash. When a headless runner announces that it
will perform independent trusted byte readback, do not duplicate that check by
calling internal Host HTTP routes or writing verification copies outside the
workspace; use public Clash reads to confirm semantic state and let the runner
verify delivered bytes. Do not run Git commands merely to check completion when
the workspace has no `.git` repository.

Use the specialist Director, Timeline, motion-graphics, or finishing skill for
creative judgment. This skill owns transport navigation and product evidence,
not the artistic recipe.
