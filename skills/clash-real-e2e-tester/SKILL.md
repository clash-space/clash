---
name: clash-real-e2e-tester
description: Test Clash desktop Copilot/ACP flows with subagents using agent-browser. Use this skill whenever the user asks for real desktop E2E, ACP agent verification, Codex/Claude/Gemini harness testing, session history persistence checks, or screenshots from a user-perspective Electron run. It prevents mock-only tests from being mistaken for real E2E.
---

# Clash Real E2E Tester

Use this skill to hand a Clash desktop/Copilot test task to a subagent or to run it directly. The goal is to verify the product from a user's point of view, not to prove that mocks can pass.

## Test Levels

Always name the level being run:

1. **Static startup**
   - Command: `pnpm --filter @master-clash/desktop test:startup:static`
   - Verifies bundled/local harness setup and registry invariants.
   - No UI claim is allowed from this level.

2. **Stub UI smoke**
   - Command: `pnpm --filter @master-clash/desktop test:startup:ui`
   - Starts Electron and a stub ACP agent.
   - Useful for deterministic UI regressions.
   - Must be reported as stub/mock, never as real agent validation.

3. **Real Codex desktop E2E**
   - Command: `pnpm test:startup:real-codex`
   - Starts desktop dev, uses the bundled `codex-acp`, and drives Electron with `agent-browser`.
   - This is the minimum acceptable test when the user asks whether real Codex/Copilot works.

## Subagent Prompt

When delegating, use this prompt shape:

```text
You are testing Clash desktop Copilot as a real user.

Use /Users/xiaoyang/Proj/clash-space/clash as the repo.

Rules:
- Use agent-browser against the Electron dev window, not the previously installed app.
- Do not use a stub agent when the task asks for real E2E. If you use a stub smoke test, label it clearly as stub.
- Interact through the UI: click buttons, type into the composer with keyboard input, and take screenshots. Use DOM eval only for waiting/assertions, not to fake user actions.
- Do not claim success without screenshot paths and concrete visible evidence.
- Wait for the agent turn to finish before clicking New session.
- After clicking New session, open Session history and verify the previous session is still listed.
- Capture failures too: screenshot plus relevant stdout/stderr tails.
- Clean up spawned Electron/Vite/agent child processes at the end.

Run:
1. `pnpm --filter @master-clash/desktop test:startup:static` for deterministic startup/package coverage.
2. `pnpm --filter @master-clash/desktop test:startup:ui` only if a stub UI smoke test is explicitly useful, and label it as stub.
3. `pnpm test:startup:real-codex` for the real Codex path.

For the real run, verify:
- The prompt is typed into the composer: `Run \`pwd\` with your shell tool, then answer with only the path.`
- A tool-call row appears, such as `Ran pwd`.
- The final answer includes a `.clash/projects/` working directory path.
- The stop/running state clears before a fresh session is created.
- The old session remains visible in Session history after `+`.

Return:
- Commands run and pass/fail status.
- Screenshot paths as Markdown image links.
- Any observed transport diagnostics, such as WebSocket timeout/fallback, separated from assistant-message rendering issues.
- A short list of product regressions found, with repro steps.
```

## Pass/Fail Bar

A real desktop E2E passes only if all are true:

- It uses the development Electron window launched from the current repo.
- It uses the real Codex ACP path, not a fake/stub provider.
- The UI is driven through `agent-browser` user actions.
- Screenshots show the final state.
- Tool call, final answer, idle state, fresh session, and history persistence are all verified.

## Common Failure Modes

- **Old installed app opened**: kill it and relaunch desktop dev from the repo.
- **Submit click opens the model menu**: scope submit clicks to `.clash-chat-input-surface` and the right-bottom primary button.
- **New session wipes history**: session creation must persist a local row immediately, before ACP ready.
- **Tool output duplicated**: tool updates must be merged by tool call id.
- **Mock mistaken for E2E**: rerun with `pnpm test:startup:real-codex`.
- **Transport warning rendered as chat text**: treat WebSocket fallback warnings as diagnostics, not assistant messages.
