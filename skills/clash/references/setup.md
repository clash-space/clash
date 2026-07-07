# Setup & Authentication

## Installation

```bash
npm install -g @clash-space/cli
clash --version
```

## Authentication

### For humans (browser OAuth)

```bash
clash auth login
```

Opens browser → click "Authorize" → done. Token saved to
`$CLASH_HOME/config.json`, or `~/.clash/config.json` by default.

### For agents / CI (environment variable)

```bash
export CLASH_API_KEY=clsh_...
export CLASH_API_URL=https://your-instance.com  # optional, defaults to http://localhost:8788
export CLASH_HOME=~/.clash                    # optional local Clash root
```

Create a token in the Clash web app: avatar → Settings → API Tokens → Create.

### Verify

```bash
clash auth status
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLASH_API_KEY` | API token (`clsh_...`) — overrides config file | from `$CLASH_HOME/config.json` or `~/.clash/config.json` |
| `CLASH_API_URL` | Server URL | `http://localhost:8788` |
| `CLASH_HOME` | Local Clash root for config, project workspaces, and local API defaults | `~/.clash` |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `No API key configured` | `clash auth login` or set `CLASH_API_KEY` |
| `API error 401` | Token invalid or expired — create a new one |
| `Cannot reach server` | Check `CLASH_API_URL` / server running |
| `ECONNREFUSED` | Server not running or wrong URL |
