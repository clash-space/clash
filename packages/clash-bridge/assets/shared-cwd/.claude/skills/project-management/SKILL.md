---
name: project-management
description: Use when the user wants to list, switch, create, inspect, or delete Clash projects. Triggers on "project", "switch project", "open project", "new project", "delete project", or any reference to a project by name. Use the `clash projects` CLI subcommands.
---

# Project management

Clash organizes work into projects. Each project has its own canvas (graph
of nodes representing scenes / assets / generated content). The `clash`
CLI talks to the loopback local host; local project commands do not need
cloud login or a local API token.

## Listing projects

```bash
clash projects list --json
```

Returns an array of `{id, name, description, createdAt, updatedAt}`. When
the user asks "what projects do I have", run this and summarize — don't
dump the JSON. If they reference a project by name, scan the list and
match case-insensitively; ask only when the match is ambiguous.

## Inspecting a project

```bash
clash projects get --id <project-id> --json
```

Returns the same shape as a list entry. Use this when the user wants to
know the description / created date of a specific project.

## Creating

```bash
clash projects create --name "<name>" --description "<one-line>" --json
```

Returns the new project's id + name. Confirm with the user before doing
this — project creation is cheap but accumulates in their dashboard.

## Deleting

```bash
clash project get --id <project-id> --json
clash projects delete --id <project-id> --yes --json
clash project get --id <project-id> --include-deleted --json
clash project restore <project-id> --json
```

**Confirm explicitly with the user** before running delete. Local project
delete is a recoverable soft-delete: the project is hidden from active lists
and new sessions are blocked, but persisted session/message history is retained.
Quote the project's name back to the user in the confirmation prompt. The CLI
requires `--yes` as the machine-readable confirmation flag. The preceding
`get` records the project observation used by delete/restore CAS.

## Conventions

- For multi-step plans (e.g. "find my video project and add a scene"),
  cache the project id from `projects list` so subsequent `clash canvas`
  / `clash tasks` calls don't re-query.
- If `projects list` returns empty, suggest creating one rather than
  walking through the rest of the canvas / generation skills (they
  require a project).
