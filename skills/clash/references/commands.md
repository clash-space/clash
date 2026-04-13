# Command Reference

Always use `--json` for machine-readable output. Run `clash <command> -h` for the latest options.

## auth

```bash
clash auth login              # Configure API token (interactive)
clash auth status             # Verify connection
clash auth logout             # Remove saved token
```

## projects

```bash
clash projects list --json
clash projects create --name "Name" --description "..." --json
clash projects get --id <project-id> --json
clash projects delete --id <project-id>
```

## canvas

### Connection management

```bash
clash canvas connect --project <id>     # Start daemon (persistent WebSocket)
clash canvas disconnect --project <id>  # Stop daemon
```

### Reading

```bash
clash canvas list --project <id> --json                  # All nodes
clash canvas list --project <id> --type text --json      # Filter by type
clash canvas get --project <id> --node <node-id> --json  # Single node
clash canvas search --project <id> --query "sunset" --json
clash canvas search --project <id> --query "hero" --type image_gen,video_gen --json
```

### Writing

```bash
# Add nodes
clash canvas add --project <id> --type text --label "Script" --content "..." --json
clash canvas add --project <id> --type group --label "Scene 1" --json
clash canvas add --project <id> --type text --label "Prompt" --content "..." --parent <group-id> --json
clash canvas add --project <id> --type image_gen --label "Hero Shot" --parent <group-id> --json

# Update
clash canvas update --project <id> --node <id> --label "New Label" --content "New content" --json

# Delete
clash canvas delete --project <id> --node <id> --json

# Execute generation
clash canvas execute --project <id> --node <action-badge-id> --json
```

## tasks

```bash
clash tasks status --task-id <id> --json
clash tasks wait --task-id <id> --timeout 120 --json
```

## actions

```bash
clash action list --json           # List installed actions
clash action search --query "..." --json
clash action install --id <id>
clash action uninstall --id <id>
```

## vars

```bash
clash vars list --json
clash vars set --key API_KEY --value "..." 
clash vars delete --key API_KEY
```
