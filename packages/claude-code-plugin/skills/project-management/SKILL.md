---
name: project-management
description: >
  Manage Clash projects via the CLI. Create, list, get details, and delete projects.
allowed-tools:
  - Bash
metadata:
  author: clash
  version: 0.1.0
  category: video-production
  tags: [project, management, crud]
---

# Project Management

Use the `clash` CLI to manage video production projects.

## Commands

### List all projects

```bash
clash projects list --json
```

### Create a new project

```bash
clash projects create --name "Project Name" --description "Optional description" --json
```

### Get project details

```bash
clash projects get --id <project-id> --json
```

### Delete a project

```bash
clash projects delete --id <project-id>
```

## Notes

- Always use `--json` flag for structured output you can parse.
- Project IDs are UUIDs. Use `clash projects list --json` to discover them.
- Creating a project returns the new project ID immediately.
