---
name: setup
description: Set up Clash CLI authentication and verify connection
---

# Clash Setup

Follow these steps to set up the Clash CLI:

## 1. Check if CLI is installed

```bash
which clash || echo "Not installed. Run: npm install -g @clash/cli"
```

## 2. Configure your API token

Get your API token from the Clash dashboard at **Settings > API Tokens**, then:

```bash
export CLASH_API_KEY=clsh_your_token_here
```

Or save it permanently:

```bash
clash auth login
```

## 3. Verify

```bash
clash auth status
```

You should see your authentication status and project count.

## 4. Test

```bash
clash projects list --json
```

If you see your projects, you're all set!
