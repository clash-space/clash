---
name: setup
description: Verify or repair the current Clash project workspace
---

# Clash Setup

This managed workspace should already be initialized. Verify the standard
project marker first:

```bash
pwd
clash project status --json
```

If the marker is missing, repair it with the standard init command:

```bash
clash init --project "$CLASH_PROJECT_ID" --json
```

For an external directory that should point at an existing project, link it:

```bash
clash project link <project-id> --json
```

Then verify the main surfaces:

```bash
clash canvas list --json
clash room read --limit 20 --json
```

Authentication is injected by the Clash host. If auth looks broken, inspect
the environment and status rather than asking the user to paste a token:

```bash
env | grep '^CLASH_'
clash auth status
```
