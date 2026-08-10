# Asset metadata fixtures

A worked example of the open metadata surface: a workspace declares its own
kind, attaches it to an asset, edits the projection, and applies it back under
CAS.

`--kind` is a parameter, not a command. Declaring `team.shot-notes` below adds
zero CLI surface — the same six verbs serve every kind.

## Files

| Path | Role |
| --- | --- |
| `.clash/metadata-kinds/shot-notes.json` | Workspace kind declaration + JSON Schema |
| `assets/manifest.json` | The asset the metadata attaches to |
| `shot-notes.json` | The metadata document to attach |

## Run

Copy this directory somewhere writable first — the flow writes `projections/`
and updates the manifest in place.

```bash
cp -R examples/asset-metadata /tmp/md-example && cd /tmp/md-example

# The workspace kind is now declared alongside the product's own kinds.
clash assets metadata kinds --json

# Attach. Keep the returned CAS token.
clash assets metadata set --asset asset-interview --kind team.shot-notes \
  --metadata shot-notes.json --json

# Edit projections/metadata/asset-interview.team.shot-notes.json, then spend
# the token. Outside a linked agent worktree this is how you prove the read.
clash assets metadata apply --file projections/metadata/asset-interview.team.shot-notes.json \
  --expect-version <token-from-set> --json

clash assets metadata list --asset asset-interview --json
```

An undeclared kind is refused everywhere. Delete
`.clash/metadata-kinds/shot-notes.json` and rerun `set` to see the refusal.
