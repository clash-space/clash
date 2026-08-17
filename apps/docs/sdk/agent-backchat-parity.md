# Agent / Backchat parity

Clash's local agent runtime follows Backchat's ACP lifecycle and event model
while preserving Clash's product-specific MCP tools, renderer, persona, and
Host-owned Project model.

## Aligned runtime behavior

- ACP initialize, authentication retry, `session/new`, load/resume/fork,
  cancel, close, delete, logout, provider listing, mode, and config options.
- Permission, terminal, filesystem, elicitation, document/NES, steering, and
  ACP-over-MCP callbacks.
- Prompt metadata, usage, stop reasons, timeouts, broken pipes, process exits,
  legacy config negotiation, and out-of-band session updates.
- Canonical `oma.event.v1` work-item/callback lifecycle events, including
  OpenCode provisional child identity followed by structured reidentification.
- Durable transcript/event persistence and cold restore. Raw callback traffic,
  canonical event envelopes, and `acp.client_request` / `acp.client_response`
  diagnostics do not become user-visible conversation blocks.
- Steering that starts a new turn owns its out-of-band activity through the
  terminal idle/cancel boundary.
- Live reasoning projects only the newest turn's actual thought tail. Explicit
  thinking lines remain separate, single-line header rows; the full formatted
  body stays mounted behind the disclosure and uses the transcript's main
  scroll. A thought followed by text or a tool is no longer resurrected as the
  current activity, and a historical turn cannot inherit a newer turn's live
  state.
- Managed runtime upgrades replace the update action with an accessible,
  non-interactive status spinner while npm is running instead of presenting a
  disabled button or fake determinate progress.
- Canonical child work items are projected in Copilot beside their parent
  turn, summarized above the composer while running, and opened in a
  Copilot-contained right-side Sheet that reuses the real ACP transcript/tool
  renderer. Opening the Sheet keeps the parent conversation mounted, preserves
  the current route, and leaves at least one quarter of the Copilot visibly
  exposed. Close, overlay click, and Escape return to the parent conversation;
  the Sheet does not add route-style Back navigation. Cold-restored sessions
  rebuild the same child activity state from persisted events.

## MCP topology

The bundled plugin exposes two stdio peers:

| Server | Responsibility | Rendering |
| --- | --- | --- |
| `clash` | Assets, Canvas, Timeline, Director | Trusted Clash product renderer |
| `openma` | Plugin skills, task browser, session history | Standard MCP rendering |

Both are passed as normal ACP `mcpServers` descriptors. Transport support is
negotiated with the harness, and the ACP-over-MCP extension remains supported.
Only the built-in `clash` descriptor receives the Host trust marker; a
third-party server named `clash` cannot opt itself into product rendering.

The task browser uses the packaged `agent-browser` runtime with a stable
per-task session/namespace. Its tool schema and results match the Backchat
contract: stable tab ids, active-tab-only close, full-page PNG capture, bounded
visible text, click/type/eval, and task isolation. It opens a headed browser
window rather than Backchat's Electron BrowserView.

## Intentional product boundaries

- `additionalDirectories` is intentionally omitted from the public runtime
  options and every ACP session setup payload. New, resumed, loaded, and forked
  sessions remain single-root through `cwd`.
- Backchat Schedules are not copied. They are a Backchat product automation
  feature, not an ACP/agent primitive, and Clash has no corresponding product
  contract in this scope.
- Browser automation remains a normal MCP capability and result surface. Clash
  intentionally does not add a temporary sidebar tab or copy Backchat's
  Electron BrowserView host.
- Clash persona, Project workspace identity, Canvas/Timeline/Asset/Director
  tools, and special MCP result rendering remain intact.
