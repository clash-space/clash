# ACP Agent Setup State Machine

Last updated: 2026-06-27

This document is the product and engineering contract for local ACP agent
setup in Clash Desktop. It intentionally treats setup as a state machine, not
as scattered button handlers.

## Why This Model

The user wants one mental model:

```text
install -> authenticate if required -> enable -> use
```

That is mostly correct, but "authenticate if required" is conditional. ACP
agents do not all need auth. Some agents expose no auth methods and should be
usable immediately after they are available. Other agents expose auth methods
or report unauthenticated diagnostics and must be gated before enablement.

The product therefore cannot infer auth from the agent name. It must derive it
from an ACP auth probe or a local preflight owned by the adapter.

## Terms

- Catalog entry: an agent Clash knows about from the ACP registry, built-in
  config, or user configured custom agent server.
- Available agent: a catalog/custom agent whose command can be resolved and
  launched locally.
- Installed agent: a Clash-managed registry install exists in the local
  Clash install directory.
- Enabled agent: the user has allowed this available, auth-ready agent to
  appear in Copilot runtime choices.
- Auth method: one concrete ACP auth/setup path exposed by
  `initialize.authMethods`. A single agent may expose multiple methods.
  Clash treats auth methods as protocols:
  - `agent`: agent-owned sign-in, usually browser or callback based. Clash
    invokes ACP `authenticate(methodId)`.
  - `terminal`: terminal/setup auth. Clash opens the declared terminal command
    or legacy `_meta["terminal-auth"]`/`_meta.type = "terminal"` command.
    If a terminal method only describes required environment variables, it is a
    credential prompt, not a terminal flow.
  - `env_var`: credential configuration. Clash must not invoke
    `authenticate`; it guides the user to set the required variables and then
    probes again.
- No auth method: this is not an ACP auth method. It is the product state where
  the agent reports no auth requirement and should be treated as auth-ready.
- Auth probe: a non-interactive check. It may initialize ACP, collect supported
  auth methods, and create a probe session, but it must not run
  `authenticate`.
- Config probe: a non-interactive check for ACP config options, including
  model/mode selectors. It may create a probe session but must not run
  `authenticate`.
- Authenticate: an explicit user action that invokes ACP `authenticate` or a
  terminal/browser auth launch flow.
- Auth launch: the local UI state after the user starts an authenticate action.
  This is not the same as authenticated. It only means Clash is opening or
  waiting on the agent-owned external flow.

## Atomic Agent Capabilities

Each action must stay atomic. UI flows may compose these actions, but handlers
should not hide extra state transitions.

| Capability | Purpose | May launch auth? | Writes state? |
| --- | --- | --- | --- |
| `discoverCatalog` | List registry, built-in, and custom entries. | No | No |
| `discoverAvailable` | Resolve command paths for catalog/custom entries. | No | No |
| `readInstallInfo` | Read Clash-managed install metadata and versions. | No | No |
| `install` | Install a registry agent into Clash's managed bin dir. | No | Yes: files |
| `uninstall` | Remove a Clash-managed registry install. | No | Yes: files and enabled config cleanup |
| `probeAuth` | Determine whether the agent needs auth and which auth methods exist. | No | Cache only |
| `probeConfig` | Read models/modes/config options after auth is ready. | No | Cache only |
| `authenticate` | Start an `agent` or `terminal` auth flow. | Yes, explicitly | Agent-owned auth storage |
| `configureCredentials` | Collect or point to variables required by an `env_var` auth method. | No auth launch | Settings/env storage |
| `enable` | Persist enabled agent ids. | No | Yes: enabled config |
| `startSession` | Start an ACP session. | No | Session state |

The Settings `Install` button is a composed setup flow, not the raw `install`
capability. It performs:

```text
install -> probeAuth -> probeConfig -> enable if auth-ready
```

If the post-install auth probe reports `needs-auth` or `unknown`, the flow stops
there and shows the required auth/configuration action. It must not render a
disabled enable switch for that row.

## Auth Probe Contract

Auth state is a tri-state plus absence:

| Auth value | Meaning | Enable allowed? |
| --- | --- | --- |
| `undefined` | No auth requirement was reported. The agent is available and does not need login for ACP, or auth is not relevant. | Yes |
| `configured` | ACP/local preflight confirms auth is configured. | Yes |
| `needs-auth` | ACP/local preflight confirms login is required. | No |
| `unknown` | ACP/local preflight explicitly says auth cannot be verified. | No |

Important distinction:

- A transport/probe crash is not automatically `unknown`. It should not create
  a blocking auth state unless the adapter has a meaningful auth signal.
- `unknown` is reserved for capability-aware checks such as "HOME missing for
  Gemini preflight" where enabling would knowingly create a broken flow.
- `methodId`/`methodName` identify the default method. `methods[]` lists every
  supported concrete method. UI may choose any listed `methodId` when invoking
  `authenticate` for `agent`/`terminal`, or when routing credential setup for
  `env_var`.
- Multiple auth methods do not create multiple enable states. Enablement only
  depends on the post-probe auth state: `undefined`/`configured` can enable;
  `needs-auth`/`unknown` cannot.

### Auth Method Protocols

| Method protocol | Source shape | Primary UI | Backend action |
| --- | --- | --- | --- |
| none | no `authMethods` and no auth-required signal | Enable | No auth action |
| `agent` | missing `type`, `type: "agent"`, or `_meta.type: "agent"` | Sign in | Call ACP `authenticate(methodId)` |
| `terminal` | `type: "terminal"`, `_meta.type: "terminal"`, or `_meta["terminal-auth"]` without env-var-only copy | Open setup | Launch terminal command, then probe |
| `env_var` | `type: "env_var"` with `vars[]`/optional `link`, or a terminal method whose description only asks for environment variables such as `OPENAI_API_KEY` | Configure | Do not authenticate; configure variables, then probe |
| unsupported | any other type | No auth action | Block enable until a supported path exists or probe changes |

## State Machine

The canonical state is computed from catalog, install, availability, auth, and
enabled config. Do not persist a single opaque `status` field.

```text
CatalogOnly
  -> install
InstalledUnavailable
  -> discoverAvailable
AvailableUnprobed
  -> probeAuth
AuthReady
  -> enable
Enabled
  -> startSession
AuthNeeded
  -> authenticate or configureCredentials
AuthLaunching
  -> waitForExternalAuth
WaitingForExternalAuth
  -> probeAuth
AuthUnknown
  -> checkAgain
ProbeFailedTransient
  -> checkAgain
```

### States

| State | Predicate | Primary UI |
| --- | --- | --- |
| `CatalogOnly` | catalog entry exists, no available command, installable | Install only |
| `InstalledUnavailable` | managed install exists but command not resolved | Check again |
| `AvailableUnprobed` | command resolved, no auth result yet | Checking on load or before enable |
| `AuthReady` | available and auth is `undefined` or `configured` | Enable switch |
| `AuthNeeded` | available and auth is `needs-auth` | Supported auth/setup action, Check again |
| `AuthLaunching` | user clicked an auth/setup action and Clash is asking the agent to open the external flow | Disabled auth action with `Opening…`; do not block the whole page |
| `WaitingForExternalAuth` | external auth was launched or launch request has not settled quickly | Inline waiting status, automatic probe, Open again, Check now |
| `AuthUnknown` | available and auth is `unknown` | Check again |
| `Enabled` | enabled config contains id and auth is ready | Runtime/Copilot selectable |
| `ProbeFailedTransient` | probe transport failed without auth signal | Keep previous visible state; Check again |

### Transitions

| Event | From | To | Guard |
| --- | --- | --- | --- |
| `install.ok` | `CatalogOnly` | `AvailableUnprobed` or `AuthNeeded/AuthReady` | install completed, then refresh/probe |
| `install.fail` | `CatalogOnly` | `CatalogOnly` | show non-blocking feedback |
| `installFlow.authReady` | `AuthReady` | `Enabled` | Settings Install flow continues to enable after auth-ready probe |
| `installFlow.authBlocked` | `AuthNeeded/AuthUnknown` | unchanged | Settings Install flow stops and shows auth/setup action |
| `probeAuth.none` | `AvailableUnprobed` | `AuthReady` | no auth methods/requirements |
| `probeAuth.configured` | `AvailableUnprobed/AuthNeeded/AuthUnknown` | `AuthReady` | auth configured |
| `probeAuth.needsAuth` | any available state | `AuthNeeded` | auth method or unauth diagnostic found |
| `probeAuth.unknown` | any available state | `AuthUnknown` | explicit unknown auth signal |
| `probeAuth.transportFail` | any state | `ProbeFailedTransient` or previous state | no auth signal |
| `authenticate.request(methodId?)` | `AuthNeeded` | `AuthLaunching` | user explicitly starts a supported `agent`/`terminal` auth/setup method |
| `authenticate.opened(methodId?)` | `AuthLaunching` | `WaitingForExternalAuth` | external flow opened; start automatic probe |
| `authenticate.request.pending > short timeout` | `AuthLaunching` | `WaitingForExternalAuth` | release `Opening…`; auth may still be waiting externally |
| `configureCredentials.request(methodId?)` | `AuthNeeded` | `AuthNeeded` | `env_var` method; show credential configuration path, do not call `authenticate` |
| `autoProbe.configured` | `WaitingForExternalAuth` | `AuthReady` | auth configured |
| `autoProbe.needsAuth` | `WaitingForExternalAuth` | `WaitingForExternalAuth` | keep polling until budget is exhausted |
| `autoProbe.budgetExhausted` | `WaitingForExternalAuth` | `AuthNeeded` | show non-error `Still waiting`; keep Open again and Check now |
| `authenticate.launchFail` | `AuthLaunching` | `AuthNeeded` | show non-blocking error feedback |
| `enable.request` | `AuthReady` | `Enabled` | backend re-probes requested ids |
| `enable.request` | `AuthNeeded/AuthUnknown/CatalogOnly` | unchanged | backend rejects |
| `disable.request` | `Enabled` | `AuthReady` | persist removal only |
| `uninstall.ok` | any managed state | `CatalogOnly` | remove managed files and enabled id |
| `startSession.request` | `Enabled` | session starting | backend cold auth guard passes |
| `startSession.request` | auth-blocked | unchanged | backend rejects with auth-required message |

## Product Rules

1. Raw `install` never writes enabled config by itself.
2. Settings `Install` is a setup flow and may continue to `enable` when the
   post-install probe is auth-ready.
3. Auth never implies enable by itself.
4. Enable is impossible unless the agent is available and auth-ready.
5. Not every agent requires auth. Absence of auth state is a valid ready state.
6. Settings load should run an auth probe for all available/installed agents,
   even when they are not enabled.
7. Install/upgrade/authenticate responses should return the same auth-probed
   harness view used by Settings. A newly installed agent must not display
   `Ready` until its auth state is known.
8. Runtime refresh for Copilot should run config probe for enabled agents and
   warm installed agents when needed.
9. Every auth-blocked UI surface must offer Check again because auth may happen
   outside Clash.
10. Auth actions are shown only when the agent reports a concrete supported auth
   method. Browser/agent methods use Sign in copy; terminal/setup methods use
   Open setup copy; env-var credential methods use Configure copy and never
   call ACP `authenticate`. If the agent reports multiple methods, the user
   must be able to choose the method.
11. Session creation must repeat the auth guard. UI state is advisory; backend
   state is authoritative.
12. Errors that do not block the current workflow should use global
   non-blocking feedback. Blocking confirmations should use modal dialogs.
13. After Sign in opens an external browser or terminal flow, Clash must
    automatically re-probe auth. A connected/success page in the browser should
    be reflected in Settings without requiring manual Check again.
14. `Opening…` is a short launch state, not a waiting state. If the launch
    request does not settle quickly, release the row into
    `WaitingForExternalAuth` with Open again and Check now actions.
15. A user doing nothing in the external auth page is not an error. It remains
    `WaitingForExternalAuth` until the probe budget expires, then returns to
    `AuthNeeded` with a neutral "Still waiting" message.
16. Catalog-only and auth-blocked rows do not show an enable switch. A stale
    enabled row may still show a switch only as a disable affordance.

## Backend Responsibilities

The local API owns the authoritative state transitions:

- `GET /api/v1/local/harnesses?probe=auth`
  returns install/availability/auth state and supported auth methods for
  Settings. This endpoint probes the installed/available harness scope, not
  only the enabled runtime scope.
- `POST /api/v1/local/harnesses/:harnessId/authenticate`
  accepts an optional `method_id`/`methodId` and launches that agent-owned
  `agent`/`terminal` auth method. Omitting the method uses the ACP default
  method for compatibility. `env_var` methods, including terminal-shaped methods
  that only ask for credential environment variables, must be rejected with a
  clear credential-configuration message, not launched as sign-in.
- `PUT /api/v1/local/harnesses`
  validates every requested enabled id by probing auth before saving.
- `GET /api/v1/runtimes?probe=config`
  returns only enabled and auth-ready agents, with config options when known.
- `POST /api/v1/runtimes/:runtimeId/sessions`
  re-checks auth before creating the ACP session.
- Install/upgrade/authenticate endpoints must return refreshed auth-probed
  harness state. Uninstall must return refreshed harness state after removing
  the managed install and enabled id.

Backend must never trust that a disabled frontend control was respected.

## Frontend Responsibilities

Settings:

- `CatalogOnly`: show a `Not installed` status and the `Install` action.
- `Installing`: keep the row scoped to `Installing <agent> from the ACP
  registry…`; do not show a global loading label for a single-row install.
- `PostInstallProbe`: show `Checking <agent> auth…` on that row. If auth is
  ready, save enablement automatically. If auth is blocked, stop and show the
  auth-needed state.
- `AuthNeeded`: show Auth needed badge, Check again, and only the supported
  action for the selected auth method. Do not show an enable switch. Agent/browser
  methods render Sign in; terminal/setup methods render Open setup; env-var
  methods render Configure and route to credential setup. If multiple auth
  methods are present, render one action per method.
- `AuthLaunching`: show Opening on the clicked auth action only.
- `WaitingForExternalAuth`: show inline waiting copy, poll
  `GET /api/v1/local/harnesses?probe=auth&refresh=1`, refresh runtime config
  when auth becomes ready, and keep Open again / Check now available.
- `AuthUnknown`: show Check auth badge and Check again. Do not show an enable
  switch unless this is a stale enabled row that needs a disable affordance.
- `AuthReady`: show Enable switch.
- `Enabled`: switch on.
- Switching on without auth data may trigger backend validation, but should show
  a row-level checking state and then render the returned state. If backend
  validation rejects with auth-required, immediately refresh
  `GET /api/v1/local/harnesses?probe=auth&refresh=1` and render the refreshed
  row without a disabled enable switch before relying on the toast.

Copilot:

- Harness picker only shows runtime agents returned by `/api/v1/runtimes`.
- Model picker is scoped to the selected agent's ACP config options.
- If runtime/session creation rejects with auth-required, show a direct path to
  Settings and a Check again/refresh affordance.

## Test Matrix

Minimum regression coverage:

- Installed agent with no auth methods can be enabled.
- Installed agent with `needs-auth` cannot be enabled.
- Installed agent with explicit `unknown` cannot be enabled.
- Saved enabled id with `needs-auth` is omitted from runtime agents.
- Default enabled fallback with `needs-auth` is omitted from runtime agents.
- Settings Install flow auto-enables only when the post-install auth probe is
  auth-ready.
- Authenticate does not auto-enable.
- Env-var auth methods render Configure, do not call `/authenticate`, and keep
  enable blocked until a later auth probe reports configured.
- Backend authenticate rejects env-var methods before starting ACP.
- Session start rejects auth-blocked agents before spawning ACP.
- Settings hides switches for unavailable/auth-blocked agents, except when a
  stale enabled row needs a disable affordance.
- Settings offers Check again for every auth-blocked row.
- Config probe does not invoke authenticate.
- Auth probe exposes every supported auth method.
- Authenticate can target a non-default `methodId`.
- Settings sends the selected `method_id` when an agent has multiple auth
  methods.
- Settings automatically re-probes after auth launch and reaches AuthReady
  without a manual Check again.
- A stalled auth launch request exits `Opening…` and leaves the user with
  Open again and Check now.

## Files That Should Implement This Contract

- `apps/local-api/src/local-acp.ts`
- `apps/local-api/src/local-acp.test.ts`
- `apps/local-api/src/app.ts`
- `packages/cli/src/runtime/bridge/_acp-runtime/probe.ts`
- `packages/cli/src/runtime/bridge/_acp-runtime/probe.test.ts`
- `packages/web-ui/src/components/SettingsClient.tsx`
- `packages/web-ui/src/components/SettingsClient.sync.test.tsx`
- `packages/web-ui/src/hooks/useClashRuntime.ts`
- `packages/web-ui/src/components/ChatbotCopilot.tsx`
