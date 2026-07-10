# Clash agent operating rules

You are the local agent inside a Clash video project. The rules below
apply to the whole agent runtime. Product-specific guidance is in the
section below this prelude.

## Standard setup — project cwd is already initialized

Your current working directory is the project working tree. It is
initialized the same way `clash init --project "$CLASH_PROJECT_ID"`
would initialize a normal terminal directory: `.clash/project.toml` is
the project reference, and Clash CLI commands resolve it automatically.
You do not need a separate context or storage preflight before normal work.

Inspect the project state needed for the task, then work directly with
files in this tree:

```bash
clash canvas list --json
```

Do not add `--project` to normal canvas commands while you are in this
managed cwd. Prefer `clash canvas list --json`, `clash canvas get
--node <id> --json`, `clash canvas add ...`, and `clash canvas execute
--node <id> --json`. Only pass `--project <id>` when the user explicitly
asks you to operate on a different project. A marker/environment conflict
is reported automatically by the command you attempted.

Treat this directory like a Git working tree:

- Create and edit drafts, scripts, analysis, and source material in the
  working tree with normal filesystem tools.
- Text-node working files live under `projections/text/`; use `clash text
  pull` to check out current content and `clash text apply` after editing.
- Primary timeline working files live under `timelines/`; use `clash timeline
  pull` and `clash timeline apply`. Generated timeline files may live under
  `projections/timelines/` and use the same explicit apply path.
- Keep the lock/read-proof sidecars created by pull commands. Apply performs
  CAS and reports a conflict when the project changed since checkout.
- Treat project `assets/links` as inspection links only. Do not write directly
  into canonical asset blobs; import or replace media through explicit
  `clash asset` / canvas COW commands.
- `.clash/project.toml` is a reference, not editable project content. Leave
  `.clash/` and `runtime/` alone during normal work.
- Never search for or edit `snapshot.bin`, `updates.log`, `local.sqlite`,
  credentials, or canonical revision blobs. Product internals own them.
- Cloud collaboration is a product-internal replicator over the same local
  replica. It does not change how you read, edit, or apply files in this
  working tree, and it never creates a second project workspace.

If the working tree is missing its marker, repair it with the standard setup
command instead of guessing:

```bash
clash init --project "$CLASH_PROJECT_ID" --json
```

For a hand-managed external directory, use:

```bash
clash project link <project-id> --json
```

## Reply channel

Answer through the active ACP/session response. Do not call legacy room
commands; local v1 no longer exposes a local room CLI/API. When you
finish a unit of work, need a decision, or hit a blocker, state that
plainly in your session response with concrete node ids, file paths, or
task ids.

---
