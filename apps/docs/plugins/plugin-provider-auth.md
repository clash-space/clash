# Plugin Provider Auth

How a plugin gets the credential it needs, and what Clash does on its behalf.

The short version: **Clash stores things and runs flows; the plugin decides what
those things mean.** There is no auth type registry, no per-vendor header table,
and no sandbox.

## Why not an auth type registry

The obvious design is a closed set of auth kinds the host implements —
`api-key`, `oauth`, `basic` — and a plugin picks one. It breaks on contact with
real providers. Counted in this codebase, before any of this was written:

- **kling** holds an accessKey and a secretKey, signs an HS256 JWT locally,
  valid 30 minutes, and **exchanges with nobody**. It is not an api key and not
  a token exchange.
- A plugin may run its own authenticated helper. The credential never reaches
  the host at all; the helper makes the request and the plugin returns output.
- **device-code** flows have three columns in the database and no vocabulary
  anywhere.

Each of these needed a new kind, and the next provider would need another. So
the host stopped classifying auth and started offering primitives.

## The primitives

### Storage

Opaque key/value with a lifetime. The host does not interpret the values.

```ts
await store.put("apiKey", value, { secret: true });
await store.put("accessToken", token, { secret: true, expiresAt: Date.now() + 3600_000 });
const key = await store.get("apiKey");
```

`secret: true` is encrypted at rest. `expiresAt` is what makes renewal
schedulable — it is the only thing the host reads.

This replaces a table with a column per flow. `provider_oauth` had
`device_code`, `user_code`, `interval_seconds` and `oauth_state`, which meant a
new flow was a schema change.

**A plugin reads only what it wrote.** Keys are scoped to the plugin, so one
plugin cannot read another's credentials, and a key name is a private choice
rather than something to coordinate. Since plugins hold their credentials in
plaintext, this is the boundary that remains: installing a plugin exposes the
accounts you configure *for that plugin*, not every account on the machine.

### A plugin cannot name itself

The scoping above is only a boundary if the plugin cannot choose which scope it
is in. If a store call carried a plugin id, any plugin could read any other's
credentials by asking for them, and the isolation would be a naming convention.

So the plugin never sends one. At spawn the host mints a random token, keeps it
in memory mapped to `{ pluginId, accountId }`, and passes it to the process it
just started. Store calls carry the token; the host resolves it.

```
host                                     plugin
 │ spawn, env CLASH_STORE_TOKEN=<32 random bytes>
 │───────────────────────────────────────▶
 │ token → { pluginId, accountId }        │
 │   held in memory only                  │
 │                                        │
 │ ◀── get(token, "apiKey") ─────────────│
 │ resolve token, then read that scope     │
```

Why a token rather than the id itself:

- **Unguessable.** A plugin id is public — it is in the manifest, the docs and
  the directory name. Knowing another plugin's id must not be enough.
- **It dies on restart.** The map is memory, never written, so a token that
  leaks into a log or a crash dump is worthless by the time anyone reads it.
- **It is per-spawn.** Two accounts of the same plugin get different tokens, so
  one cannot reach the other's credentials.

The key is data, not a path. `"../other/apiKey"` addresses a row named exactly
that, in the caller's own scope, and finds nothing.

### This is where settings live now, too

Not only credentials. Anything an account states about itself is a key here,
because the alternative was a fixed column and there were never enough of them.

`provider_accounts` has `region`, `label`, `api_shape`, `priority`, `weight`.
A `--location` flag was written against it, parsed correctly, printed success,
and dropped the value — none of the columns was `location`. A parameter that
cannot be stored is worse than a missing one, because the failure is silent.

So `region`, `service`, `label` and whatever the next provider needs are all
just keys:

```ts
await store.put("service", "agent-platform");
await store.put("region", "us-central1");
```

The host reads none of them. It does not know that Google has services, that
MiniMax has two hosts, or that Agent Platform has locations — which is the
point, since it also does not know about the provider you are about to add.

### Methods

A Provider declares one or more **methods**. A method is a whole coherent configuration — a way of
authenticating, carrying exactly the fields that way needs.

This was originally a single flat form, and the ways of authenticating had to be reconstructed from
it. Google broke that. It has two surfaces and two credentials, and they do not pair off evenly: a
service account signs an assertion only Agent Platform accepts; an API key works on AI Studio *and*
on Agent Platform in Express mode; and a region is an Agent Platform concept that AI Studio has no
notion of. Expressed as one form this needed a `service` choice, a rule saying two keys were
alternatives, and a condition hiding the choice once a service account was pasted — three
mechanisms for the host to infer a structure the plugin knew outright. It also carried a notice
claiming Agent Platform refuses API keys, which is false, and which is what made the choice look
redundant in the first place.

```jsonc
{
  "methods": [
    { "id": "ai-studio", "label": "Google AI Studio (Developer API)",
      "form": [ { "kind": "field", "key": "apiKey", "label": "API key", "secret": true } ] },

    { "id": "service-account", "label": "Google Cloud Agent Platform (service account)",
      "form": [ { "kind": "field", "key": "serviceAccountKey", "secret": true },
                { "kind": "choice", "key": "region", "options": [ /* ... */ ] } ] }
  ]
}
```

`region` is absent from the AI Studio method rather than present and ignored. A field that is
present and ignored teaches the reader that fields can be ignored.

An account records which method it uses, so method ids must be unique. A method must collect
something or start a flow: one that does neither offers a name and nothing to do with it.

How many methods is the vendor's business, not a matter of symmetry. MiniMax declares one, because
the same key is presented the same way to either host — its `international`/`domestic` choice is a
deployment, not a second way in, and splitting it would ask the user to choose an authentication
method in order to express a region.

### Form

Declared, not coded. The host renders it and writes results to storage. A form belongs to a method.

| Kind | Use |
| --- | --- |
| `field` | api key, base url |
| `choice` | a menu — MiniMax region, Google region |
| `button` | starts a flow: "Sign in with Google" |
| `notice` | explains a field |
| `display-code` | shows a code the user types elsewhere (device-code flows) |

```jsonc
{
  "form": [
    { "kind": "field",  "key": "apiKey", "label": "API key", "secret": true },
    { "kind": "notice", "text": "Create one at aistudio.google.com/apikey" }
  ]
}
```

A field with no declared default is required. A `button` is only drawn when its own method declares
a flow — under the old flat shape there was one flow for the whole declaration, so a button in one
part of the form was enabled by a flow declared for another.

The host never learns what a field **means**. `apiKey` is a secret field and `serviceAccountKey` is
a secret field; that one is a token and the other is JSON, and what either authorises, stays the
plugin's business. Any host logic keyed on those names would be the host guessing at something the
plugin never told it.

### Browser flow

Anything that needs a browser window and an address back.

```jsonc
{
  "flow": {
    "open": "https://accounts.google.com/o/oauth2/v2/auth",
    "callback": { "type": "loopback" }
  }
}
```

`loopback` binds `http://127.0.0.1:<random port>` and hands the query
parameters to the plugin. **Google requires this** for desktop clients; the
out-of-band flow (`urn:ietf:wg:oauth:2.0:oob`) was withdrawn in 2022.

`scheme` registers a custom URL scheme instead, for platforms where that is the
convention.

`poll-until` covers device-code: show a code, poll an endpoint until the user
finishes elsewhere.

PKCE, the `state` parameter, the port and the timeout are the host's. A plugin
that had to implement `state` correctly would eventually implement it
incorrectly, and the failure is a silent CSRF rather than an error.

### Renewal

The plugin declares whether renewal applies and when. The plugin's own code
performs it.

```jsonc
{ "renew": { "before": "60s" } }  // when a stored expiresAt approaches
{ "renew": { "every": "12h" } }   // on a fixed schedule
```

The host wakes the plugin's `renew` export; the plugin refreshes however its
vendor requires and writes the result back to storage. Renewal is not a
protocol the host knows — a refresh-token exchange, a re-signed JWT and a
re-run CLI are all just code.

These two are declarations because only the host can act on them: it is the one
awake when nobody is using the app. A credential rejected *during* a call is not
in that category — the plugin is already running, already holds the response,
and can refresh and retry in the same function. Declaring that case would mean
reporting a failure outward and waiting to be called again, to do something the
plugin could have done immediately.

What the host does own is the **failure**: when renewal fails, the account is
marked as needing attention and the form says so. A dead refresh token must not
surface as a generation error three screens away.

### Verification

The host can ask whether a credential currently works, and reports the answer
in the form. This is the existing provider test — `POST
/api/v1/model-providers/test` — which **runs a real generation** on a real
model rather than pinging an endpoint.

That distinction is the point. A key can be well-formed, accepted by an auth
check, and still fail on the model you wanted: the project may not have the API
enabled, the model may not exist in your region, or the account may lack the
role. All three were measured here with a key that authenticated correctly.

It matters most for credentials the user obtained elsewhere. `gcloud auth login`
produces something we did not mint and cannot audit; the useful question is not
"is this well-formed" but "does this provider serve that model, for you, now".

## The auth shape is plugin code

Every vendor puts the credential somewhere different, with a different name:

| Vendor | Where |
| --- | --- |
| Google API key | header `x-goog-api-key` |
| Google OAuth | header `Authorization: Bearer` |
| ElevenLabs | header `xi-api-key` |
| fal | header `Authorization: Key` |
| Replicate | header `Authorization: Token` |

There is no rule to discover here. `Key`, `Token` and `Bearer` differ for no
reason, and some providers want the credential in the query string. This is
part of the vendor's API shape, which is exactly what a plugin is for:

```js
const key = await store.get("apiKey");
const response = await fetch(url, { headers: { "x-goog-api-key": key } });
```

The host previously carried this as a table keyed by provider id, which meant
adding a provider meant editing the host, and a third-party plugin could not
introduce one at all.

## No sandbox

Plugins run as ordinary processes with ordinary network and filesystem access.
They read their credentials in plaintext.

This is a deliberate trade. The alternative — network primitives replaced with
throwing stubs, every request brokered, the plugin never seeing the token —
forces the host to know each vendor's auth shape in order to inject it, which
puts vendor knowledge back in the host and blocks any provider the host has not
been taught.

Installing a plugin is therefore giving it your provider credentials. That is
the same trust as installing any other software, and it is stated here rather
than implied by a sandbox that could not hold anyway.

## Worked example: Google

Google is four different credentials, which is why it is the useful test of
whether these primitives are enough.

### API key

```jsonc
{
  "id": "google-api-key",
  "form": [{ "kind": "field", "key": "apiKey", "label": "API key", "secret": true }]
}
```

```js
authorize: (c) => ({ headers: { "x-goog-api-key": c.apiKey } })
```

Reaches the Gemini Developer API. A Cloud API key works only if the Gemini API
is enabled on its project — otherwise the response is
`403 Gemini API has not been used in project <n>`.

### OAuth

```jsonc
{
  "id": "google-oauth",
  "form": [{ "kind": "button", "key": "signIn", "label": "Sign in with Google", "flow": "oauth" }],
  "flow": {
    "open": "https://accounts.google.com/o/oauth2/v2/auth",
    "callback": { "type": "loopback" },
    "params": { "access_type": "offline", "prompt": "consent",
                "scope": "https://www.googleapis.com/auth/cloud-platform" }
  },
  "renew": { "before": "60s" }
}
```

Clash bundles a Desktop OAuth client. A Desktop client id is not a secret —
RFC 8252 treats native apps as public clients, and no desktop application can
keep a client secret. Security comes from PKCE, `state`, the system browser and
a strict redirect, not from hiding the id.

Two facts worth knowing before depending on this:

- An OAuth app in **Testing** status issues refresh tokens that expire after
  **7 days**. Production use requires publishing and verification, and
  `cloud-platform` is a sensitive scope.
- A refresh token can also die from revocation, long disuse or an org policy
  change. `invalid_grant` means sign in again, and the form has to say that.

### Service account

```jsonc
{
  "id": "google-service-account",
  "form": [{ "kind": "field", "key": "serviceAccountKey", "label": "Service account JSON", "secret": true }],
  "renew": { "before": "60s" }
}
```

The stored key is not the credential: the plugin signs a JWT with the private
key and exchanges it at `oauth2.googleapis.com/token` (RFC 7523) for an access
token that lasts about an hour. The key lasts until revoked, which makes this
the only unattended source of a Google token.

Required for **Gemini Omni**, which is reachable only through the Interactions
API — measured: `POST /v1beta1/projects/{p}/locations/global/interactions`
answers an api key with `401 API keys are not supported by this API`, while
`:generateContent` refuses the model with `400 only supported in the
Interactions API`.

### An externally obtained token

```jsonc
{
  "id": "google-adc",
  "form": [
    { "kind": "notice", "text": "Run: gcloud auth login" },
    { "kind": "button", "key": "check", "label": "Check access", "flow": "verify" }
  ]
}
```

The plugin runs `gcloud auth print-access-token` and verifies the result
against the provider. Clash mints nothing and stores nothing long-lived; the
token lasts about an hour and the plugin fetches a fresh one when it needs one.

Suitable for developer machines. It requires the Google Cloud SDK, which most
users do not have.

## Choosing between them

| You have | Use |
| --- | --- |
| An AI Studio key (`AIza…`) | API key |
| A Google account, no tooling | OAuth |
| A server, or Gemini Omni | Service account |
| gcloud already installed | ADC |
