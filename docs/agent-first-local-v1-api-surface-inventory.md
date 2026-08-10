# Agent-First Local v1 API Surface

Status: Current

Last updated: 2026-07-11

## Local Bootstrap

```bash
clash host status --json
clash init --project <project-id> --json
clash canvas connect
```

`clash init` writes `.clash/project.toml` in the current directory. The local
host and Canvas/Timeline commands require no cloud credential. `clash auth
login` is optional cloud-sync setup.

## Project and Diagnostics

```bash
clash project status --json
clash doctor storage --json
clash doctor storage --repair --json
clash projects get --id <id> --json
clash projects delete --id <id> --yes --json
clash project get --id <id> --include-deleted --json
clash project restore <id> --json
clash project purge <id> --yes --json
```

Project mutations use implicit cwd observations. Status is optional and
diagnostic. Purge is recovery-window controlled by the host.

## Canvas Registry

```bash
clash canvases list --json
clash canvases create --id <id> --name <name> --json
clash canvases rename --canvas <id> --name <name> --json
clash canvases delete --canvas <id> --yes --json
```

A Project may have multiple Canvases. Canvas IDs scope node and graph commands.

## Canvas Nodes and Graph

```bash
clash canvas list [--canvas <id>] --json
clash canvas get --node <id> [--canvas <id>] --json
clash canvas edges [--canvas <id>] --json
clash canvas add --type <type> ... --json
clash canvas update --node <id> ... --json
clash canvas copy --node <id> --json
clash canvas replace-asset --node <id> --asset <asset-id> --json
clash canvas delete-plan --node <id>... --json
clash canvas delete-batch --node <id>... --yes --json
```

Reads record observations. Writes use them internally and return structured
`READ_REQUIRED`, `STALE_READ`, or `IMMUTABLE_NODE` conflicts. Public output is
sanitized and does not expose receipts.

## Project Timeline

```bash
clash timeline list --json
clash timeline create --id <id> --name <name> --json
clash timeline attach --timeline <id> --canvas <id> --node <action-node-id> --json
clash timeline detach --timeline <id> --json
clash timeline copy --timeline <id> --canvas <id> --new-timeline <id> --new-node <id> --json
clash timeline pull --timeline <id> --file timelines/<id>.timeline.yaml --json
clash timeline apply --timeline <id> --file timelines/<id>.timeline.yaml --json
```

Timeline is a Project entity. `pull` writes YAML into the marker cwd and
records the current Project Timeline observation. `apply` parses the file and
atomically advances the Loro Timeline revision. There are no public Timeline
history/content/restore commands because Loro owns its history and the product
owns visual recovery.

Any export that claims applied provenance must verify that the YAML semantic
hash matches the current Project Timeline state before recording
`sourceTimelineRevisionId`. An export without a Timeline identity is explicitly
marked `draft-file`.

## Text Projections

```bash
clash text pull --node <id> --file projections/text/<id>.md --json
clash text apply --node <id> --file projections/text/<id>.md --json
clash text replace --node <id> --file projections/text/<id>.md --json
clash text history --node <id> --json
clash text content --revision <id> --out <file> --json
clash text restore --node <id> --revision <id> --json
```

Text uses immutable applied revisions because text content can be a referenced
asset-like input. `apply` is in-place only when the node is mutable; `replace`
and restore use copy-on-write when references must remain pinned.

## Assets

```bash
clash asset import --file <path> --kind <kind> --json
clash asset link --asset <id> [--name <name>] --json
clash asset get --asset <id> --json
clash asset refs --asset <id> --json
clash asset ref get --asset <id> --project <id> --json
clash asset ref delete --asset <id> --project <id> --yes --json
clash asset gc --dry-run --json
```

Import stores one content-addressed global blob and creates a read-only link in
the marker cwd. Project membership and Canvas references are SQLite rows, not
copied media.

## Host-Only Storage APIs

The local API owns:

- Project Loro replica load/save and WebSocket sync;
- SQLite project, session, asset, reference, text revision, provider, and audit
  tables;
- immutable media and text revision blobs;
- CAS receipt minting and verification;
- mutation audit persistence;
- optional cloud replication configuration.

These are not agent file APIs. Loopback local API use does not require cloud
Authorization. Remote API use follows the standard OAuth/token path.

## Cloud Admission

Cloud collaboration remains product-internal. `SettingsClient` owns the
`Cloud mirror readiness`, `Canvas mirror ready`, `Asset metadata mirror ready`,
and `Revision content mirror ready` controls used by Share/Open-in-Web gates.
These switches are never read from cwd files and never gate local Project
commands.

## Removed Surfaces

- broad mutable JSON database persistence;
- local `vars`/`variables` CLI storage;
- local room read/write/sync endpoints;
- node-owned Timeline mutation commands;
- Timeline lock/revision sidecars;
- Timeline revision SQLite/blob REST APIs;
- public compare-token arguments and mutation override options.
