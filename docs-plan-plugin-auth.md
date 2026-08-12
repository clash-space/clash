# Plugin-provider authentication — plan

Everything below is decided unless marked OPEN. Acceptance is what must be true
to call an item done; "verified" always means demonstrated on this machine, not
asserted in a test alone.

---

## 0. Where we are (measured, not recalled)

| Fact | Evidence |
| --- | --- |
| `CLASH_PROVIDER_API_KEY` is read by the plugin, set by nobody | one read site, zero writes in the repo |
| So the plugin path cannot authenticate at all | Google generations that "worked" went through `local-aigc`, confirmed by `[route]` trace |
| `asset.write` has zero callers | host implements it; no plugin calls it |
| Transport is hand-written per plugin | 3 copies, already drifted (malformed-line handling differs) |
| Host holds a per-vendor auth table | `local-plugin-broker.ts:167` — `elevenlabs`, `google` |
| Docs describe a model that is not built | "plugin never sees the token", "network APIs replaced with throwing stubs" |
| Secret key sits beside the database it protects | both 0600 in `~/.clash/local-api/` |
| 43 files uncommitted, 25 local-api tests failing | from removing the silent mock fallback |

---

## 1. Four primitives (the design)

Auth is **not** a primitive. It is storage plus plugin code.

### 1.1 GUI primitives

Declarative; the host renders. Five kinds, each justified by a case that
exists today:

| Kind | For |
| --- | --- |
| `field` | api keys, base urls |
| `choice` | MiniMax region, Google service — today hardcoded in one GUI branch |
| `button` | "Sign in with Google" — no way to trigger a flow today |
| `notice` | explaining what a field is |
| `display-code` | device-code flows — three DB columns, zero vocabulary |

**Acceptance**
- Every one of the 14 built-in providers renders from a declaration; the 45
  `provider.providerId === '...'` branches in `SettingsClient.tsx` are gone.
- A provider added with `clash providers add` and no GUI code renders a
  complete form.

### 1.2 Redirect + callback primitives

| Kind | For |
| --- | --- |
| `redirect-out` | open the system browser |
| `callback-in: loopback` | `http://127.0.0.1:<random>` — **required by Google**; OOB was withdrawn in 2022 |
| `callback-in: scheme` | custom scheme, already in the schema |
| `poll-until` | device-code |

PKCE, `state`, port selection and timeout are the **host's**, not the plugin's.
A plugin declares endpoints and scopes only.

**Acceptance**
- Google OAuth completes against real Google, on this machine, producing a
  refresh token.
- Wrong `state` is rejected; a test proves the rejection, not just the success.
- The plugin declaration contains no code for PKCE or `state`.

### 1.3 Storage primitives

Opaque key/value with a lifetime. **Not** a column per flow — `provider_oauth`
today has `device_code`, `user_code`, `interval_seconds`, `oauth_state`, so a
new flow means a schema change.

```
put(key, value, { secret?: bool, expiresAt?: number })
get(key)
```

**Acceptance**
- Adding a new auth flow touches no table definition.
- `secret: true` values are ciphertext at rest; verified by reading the DB.

### 1.4 Renew

Plugin-declared, host-executed on a schedule.

```jsonc
{ "renew": { "when": "before(60s)", "using": "refresh_token" } }
```

**Acceptance**
- An expired access token is refreshed without the user present.
- `invalid_grant` marks the account as needing re-authorization, and the GUI
  says so — rather than surfacing as a generation failure.

### 1.5 Auth shape — plugin code

The plugin reads what it stored and builds its own request:

```js
const key = await store.get("apiKey");
fetch(url, { headers: { "x-goog-api-key": key } });
```

**Acceptance**
- `local-plugin-broker.ts` contains no vendor names.
- A vendor using an unusual scheme — kling signs an HS256 JWT locally from
  accessKey/secretKey — is expressible with no host change.

### 1.6 Helpers

OAuth2 + PKCE is the same for most vendors. Ship it as a helper the plugin
calls, not as something each author reimplements.

**Acceptance**
- Google and one other OAuth provider use the same helper with different
  parameters only.

---

## 2. What this deletes

| Removed | Why |
| --- | --- |
| Host per-vendor auth table | the plugin builds its own request |
| `network.fetch` `credentialHandle` | the host no longer injects auth |
| `credential.handle` | the plugin holds the credential |
| `CLASH_PROVIDER_API_KEY` | never set; replaced by the storage primitive |

OPEN: whether the sandbox stays for third-party plugins. Deciding "first-party
runs directly" does not settle what a third-party plugin gets.

---

## 3. Decisions already taken

- **Client ID**: ours, a Desktop client, bundled. Not a secret (RFC 8252).
- **Cloud**: keep the design compatible; do not build it now.
- **Local encryption**: move the key out of the data directory now
  (option 2). Platform keystore later — Electron `safeStorage` fits the app,
  and the daemon needs a route that does not prompt on unattended reads.
- **Renew** is a declaration, not plugin-scheduled code.

Known consequence, not yet solved: an OAuth app in **Testing** status issues
refresh tokens that expire in **7 days**. Real users need the app published and
verified, and `cloud-platform` is a sensitive scope.

---

## 4. Debt that blocks or distorts this work

| Item | Acceptance |
| --- | --- |
| 25 failing local-api tests | migrated to selecting the mock provider explicitly; suite green |
| Plugin transport hand-written ×3 | all plugins use the SDK's `defineStdioExecutablePlugin`; no plugin contains `createInterface` |
| `asset.write` unused | executors return handles; frames carry no media |
| `asset.write` refuses `url` | host fetches a public url itself; fal/replicate stop downloading-then-re-encoding |
| 43 uncommitted files | committed in reviewable pieces |
| Docs describe an unbuilt model | `broker.md` rewritten to match what exists |

---

## 5. Order

1. Commit what is verified today (Google consolidation, omni fixes, plugin
   executors, CLI).
2. Clear the 25 failures.
3. Storage primitive + key relocation.
4. GUI primitives, validated by replacing the 45 hardcoded branches.
5. Redirect/callback + OAuth helper, validated by a real Google sign-in.
6. Renew.
7. Delete the host auth table and the broker credential path.
8. Rewrite `broker.md`.

Each step ends with its own acceptance demonstrated before the next begins.
