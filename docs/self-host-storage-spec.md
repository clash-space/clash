# Self-Hosted Storage Contract

Status: Accepted

Last updated: 2026-07-26

## Root

Every self-hosted Clash process uses exactly one root:

```text
$CLASH_HOME/
```

`$CLASH_HOME` defaults to `~/.clash/`. Desktop installation is optional and
must not change this location. `~/Library/Application Support/Clash`, app
bundle resources, cwd-relative stores, and platform-specific config roots are
not alternate sources of truth.

## Ownership by Data Kind

```text
$CLASH_HOME/
  config.yaml
  credentials.json
  machine-id
  run/
  local-api/
    local.sqlite
    acp-bin/
    models/
    projects/
  desktop/
    user-data/
    session-data/
    crash-dumps/
  logs/
    desktop/
  assets/
  projects/
```

### `config.yaml`

`config.yaml` is the single user-editable, declarative configuration file. It
owns non-secret preferences for:

- server URL;
- enabled ACP harnesses and custom ACP server commands;
- local audio enablement, providers, and model selection;
- sync mode, remote URL, and admitted sync capabilities.

The application may update this file from Settings, but it must preserve
unknown keys. Runtime probes read the latest file and do not mirror its values
into SQLite.

### `credentials.json`

`credentials.json` is an opaque owner-only credential store, not a user
configuration surface. It owns user API credentials, machine/runtime
credentials, and secret sync tokens. Keeping it JSON is an implementation
detail so existing installations and non-interactive services remain
compatible; secrets must never be copied into `config.yaml`.

### `local-api/local.sqlite`

SQLite owns transactional and queryable product state:

- projects, recoverable deletion state, sessions, messages, and agent members;
- asset and text-revision metadata;
- provider accounts and encrypted OAuth state;
- mutation audit evidence and operational indexes;
- recent ACP run choices such as the last harness and per-harness config/mode
  values. These are observed run state, not declarative setup.

SQLite does **not** own declarative user preferences. In particular,
`local-sync-config`, `local-audio-config`, and `local-harness-config` are
legacy migration inputs only and are deleted after a successful import into
`config.yaml` and `credentials.json`. Recent run choices are intentionally not
written to `config.yaml`, so directly editing declarative setup cannot race with
ordinary composer selection changes.

### Files and Directories

Large or append-oriented data remains in purpose-specific files: Loro
snapshots/update logs, content-addressed media and text blobs, installed ACP
runtimes, models, caches, and ephemeral host discovery records. A generated
JSON discovery record under `run/` is a machine protocol artifact,
not a second configuration file.

Electron-owned browser state, session data, crash dumps, and application logs
live below `$CLASH_HOME/desktop/` and `$CLASH_HOME/logs/desktop/`; Desktop must
override Electron's platform defaults before app readiness. OS service
registration files such as a launchd plist remain in the directories scanned
by the operating system, but contain no product state and only point at the
canonical host.

## Precedence and Migration

At read time:

1. explicit environment overrides win;
2. `config.yaml` and `credentials.json` are the durable sources of truth;
3. legacy `config.json`, `local-api/harnesses.json`, and the three historical
   `local_config` rows are imported only when the corresponding new section is
   absent.

Migration is one-way. The new files are written atomically with owner-only
permissions before a legacy file or row is retired. After migration, normal
reads and writes never fall back to legacy storage.

## Security and Durability

- `$CLASH_HOME`, `config.yaml`, `credentials.json`, `machine-id`, and SQLite
  are owner-only.
- Configuration and credential writes use a temporary file plus atomic rename.
- Unknown YAML keys and unrelated credential fields survive product writes.
- Secret values are never returned by public configuration APIs.
