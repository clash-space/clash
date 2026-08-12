# Local Setup

## Installation

```bash
npm install -g clash
clash --version
```

## Local host and project marker

Open Clash Desktop, then run:

```bash
clash host status --json
clash init --project <project-id> --json
```

The marker at `.clash/project.toml` links this cwd to the local Project Loro
replica. Local commands do not require a cloud credential.

### Optional cloud sync

```bash
clash auth login
```

OAuth is only for product-managed remote synchronization. It is not a local
setup step.

## Environment Variables

| Variable        | Description                                                             | Default                 |
| --------------- | ----------------------------------------------------------------------- | ----------------------- |
| `CLASH_API_KEY` | Optional remote/cloud credential override                               | unset                   |
| `CLASH_API_URL` | Local or cloud API URL                                                  | `http://localhost:8788` |
| `CLASH_HOME`    | Local Clash root for config, project workspaces, and local API defaults | `~/.clash`              |

## Troubleshooting

| Error                      | Fix                                                                 |
| -------------------------- | ------------------------------------------------------------------- |
| `Host: inactive`           | Open Clash Desktop or start the local-api host                      |
| Project cannot be resolved | Run `clash init --project <id>` in the cwd                          |
| Remote sync returns 401    | Run the optional `clash auth login` flow again                      |
| `ECONNREFUSED`             | Check that the local host is running and `CLASH_API_URL` is correct |
