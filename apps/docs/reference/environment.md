# Environment Variables

## Core

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLASH_HOME` | `~/.clash` | Clash home directory |
| `CLASH_API_URL` | `http://localhost:8788` | Local or cloud API URL for the CLI |
| `CLASH_PROFILE` | `prod` | Runtime profile (`dev` / `prod`) |
| `CLASH_PROJECT_ID` | — | Project override when no cwd marker exists |
| `CLASH_CANVAS_ID` | — | Canvas scope for canvas node commands |
| `CLASH_API_KEY` | — | Remote/cloud credential override (not needed locally) |
| `CLASH_LOCAL_DATA_DIR` | `$CLASH_HOME/local-api` | Host data directory |

## Provider traffic

| Variable | Purpose |
| --- | --- |
| `CLASH_PROVIDER_TEST_RECORDING_PATH` | Provider conformance-script recording path. Plugin traffic recording/replay is injected by the test harness at the process boundary; it is not a production runtime switch. |

## Plugin broker

| Variable | Default | Purpose |
| --- | --- | --- |

## Web/desktop dev

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` / `API_CF_PORT` / `RENDER_PORT` | Dev server ports (defaults 3000 / 8789 / 8080) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Optional proxy for make targets (off by default) |
