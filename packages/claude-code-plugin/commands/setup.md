---
name: setup
description: Set up the local Clash CLI, project marker, and host connection
---

# Local Clash Setup

Follow these steps to set up the Clash CLI:

## 1. Check if CLI is installed

```bash
which clash || echo "Not installed. Run: npm install -g @clash-space/cli"
```

## 2. Start the local host

Open Clash Desktop, then verify host discovery:

```bash
clash host status --json
```

Local project and canvas commands do not require a cloud API token.

## 3. Link the current working directory

```bash
clash init --project <project-id> --json
```

This writes `.clash/project.toml`. Project state remains in the local Project
Loro replica; files in this working directory are drafts and editable
projections.

## 4. Verify the local Project

```bash
clash timeline list --json
clash canvas list --json
```

The marker resolves the project automatically. Do not require `project status`
as a mutation preflight.

## Optional cloud sync

```bash
clash auth login
```

Cloud OAuth enables product-managed remote sync. It is not required for the
local host, Project replica, canvas, Timeline, assets, or file apply workflows.
