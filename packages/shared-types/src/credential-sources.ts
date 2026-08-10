import { z } from "zod";

import {
  ExecutablePluginProviderAuthSchema,
  type ExecutablePluginProviderAuth,
} from "./executable-plugin";

/**
 * Credential sources, normalized.
 *
 * A provider's `auth` array answers one question -- how does a credential for this
 * provider get here -- but each entry answers it in a different shape, so every
 * consumer re-derived the same distinctions. Settings did it by picking entries out
 * by type name:
 *
 *     const oauth = auth.find((a) => a.type === 'oauth');
 *     const localTokenImport = auth.find((a) => a.type === 'local-token-import');
 *     const apiKeyAuth = auth.filter((a) => a.type === 'api-key');
 *
 * Three `find`s producing three differently shaped fields, so a provider could not
 * offer two of the same kind (two regions, two installed clients), and every new
 * kind meant another branch in the UI.
 *
 * The distinctions consumers actually need are narrower than the wire types:
 *
 *   - which control renders it: a field, a button that opens a window, or a button
 *     that calls the host
 *   - whether it needs a human present, which is what decides if a headless or CI
 *     caller can use it at all
 *
 * That second axis is the one Kubernetes standardized as `interactiveMode` on exec
 * credential plugins, and it is the axis this product was missing: `hilo-hub`
 * declares two sources and *both* need either a window or an installed desktop app,
 * so no unattended path exists -- invisible until a CLI run fails.
 *
 * Git and Docker credential helpers also settled on verbs (`get`/`store`/`erase`)
 * and, for Git and kubectl, an expiry field. Where this product differs from all of
 * them is trust: their helper commands are configured by the user, while these are
 * declared by a third-party plugin. That is why acquisition stays a closed set of
 * host-implemented kinds instead of an arbitrary command.
 */

/** How a credential source is presented. */
export type CredentialSourceControl = "field" | "button-window" | "button-action";

export const CredentialSourceKindSchema = z.enum([
  /** User supplies a static credential. */
  "api-key",
  /** Real authorization-code flow against an authorization server. */
  "oauth",
  /** Vendor-specific capture: complete a login page, read the token it redirects with. */
  "login-page-capture",
  /** Vendor-specific import: read the token an installed desktop app already holds. */
  "local-app-store",
  /** User supplies a signing secret; the wire credential is minted from it and expires. */
  "derived-token",
]);
export type CredentialSourceKind = z.infer<typeof CredentialSourceKindSchema>;

export interface CredentialSource {
  /** Stable id for this source within its provider. */
  id: string;
  kind: CredentialSourceKind;
  label: string;
  control: CredentialSourceControl;
  /**
   * True when a human has to be present. A headless or CI caller must filter these
   * out rather than discover the failure by trying.
   */
  interactive: boolean;
  /** Credential field this source populates. */
  credentialId: string;
  /**
   * True when the stored secret is not the credential and cannot be sent as-is.
   *
   * The axis the taxonomy was missing. Four of the five kinds store the value they send, so "inject
   * the stored credential" reads as one uniform rule -- and on the fifth that rule puts a private
   * key on the wire. Host code branches on this rather than on the kind name, so a second
   * derivation scheme does not mean revisiting every injection site.
   *
   * A derived credential is short-lived by construction, which is why nothing here holds one: this
   * type describes how to obtain a credential and never carries the result. Code cannot persist
   * into a slot that does not exist, and the slot is missing on purpose -- poll state lives beside
   * the node in the canvas document, where a bearer token would be replicated and backed up with
   * the project long after it stopped working.
   */
  derivesCredential: boolean;
  /** The originating wire entry, for host code that needs its kind-specific fields. */
  auth: ExecutablePluginProviderAuth;
}

const CONTROL_BY_KIND: Readonly<Record<CredentialSourceKind, CredentialSourceControl>> = {
  "api-key": "field",
  oauth: "button-window",
  "login-page-capture": "button-window",
  "local-app-store": "button-action",
  // A service account document is pasted in, the same gesture as a key.
  "derived-token": "field",
};

const INTERACTIVE_BY_KIND: Readonly<Record<CredentialSourceKind, boolean>> = {
  // A pasted key needs a human once, but it can be provisioned ahead of time, so an
  // unattended caller is not blocked by it.
  "api-key": false,
  oauth: true,
  "login-page-capture": true,
  "local-app-store": false,
  // The most unattended kind there is: a machine credential exists so that no human has to be
  // present, and minting needs the stored secret rather than a person.
  "derived-token": false,
};

/**
 * Kinds whose stored secret is not the credential.
 *
 * Separated from `CONTROL_BY_KIND` and `INTERACTIVE_BY_KIND` because it answers a different
 * question: those two decide how a credential is obtained from the user, this one decides what the
 * host may do with it afterwards.
 */
const DERIVES_BY_KIND: Readonly<Record<CredentialSourceKind, boolean>> = {
  "api-key": false,
  oauth: false,
  "login-page-capture": false,
  "local-app-store": false,
  "derived-token": true,
};

/**
 * Classify a wire auth entry.
 *
 * `oauth` with `flow: "browser"` is reported as `login-page-capture` rather than
 * `oauth`, because that is what it is. It carries no `response_type`, `client_id`, or
 * `token_type`, and its token field is configurable -- which only makes sense when
 * there is no standard to conform to, since RFC 6749 fixes that name as
 * `access_token`. Naming it accurately keeps `oauth` available for a real
 * authorization-code flow instead of spending it on one vendor's redirect.
 */
export function credentialSourceKind(auth: ExecutablePluginProviderAuth): CredentialSourceKind {
  if (auth.type === "api-key") return "api-key";
  if (auth.type === "derived-token") return "derived-token";
  if (auth.type === "local-token-import") return "local-app-store";
  return auth.flow === "browser" ? "login-page-capture" : "oauth";
}

function defaultLabel(kind: CredentialSourceKind): string {
  if (kind === "api-key") return "API key";
  if (kind === "derived-token") return "Service account key";
  if (kind === "local-app-store") return "Reuse local app login";
  return "Sign in";
}

/**
 * One uniform list of the ways a credential for this provider can be obtained.
 *
 * Order is preserved, so a provider controls which source it presents first, and
 * duplicates of a kind are kept -- two installed clients or two regions are two
 * sources, not one overwriting the other.
 */
export function resolveCredentialSources(
  auth: readonly ExecutablePluginProviderAuth[],
): CredentialSource[] {
  return auth.map((entry, index) => {
    const kind = credentialSourceKind(entry);
    const id = entry.type === "api-key"
      ? entry.credentialId
      : entry.id;
    const label = ("label" in entry && entry.label) ? entry.label : defaultLabel(kind);
    return {
      id: id || `${kind}-${index}`,
      kind,
      label,
      control: CONTROL_BY_KIND[kind],
      interactive: INTERACTIVE_BY_KIND[kind],
      derivesCredential: DERIVES_BY_KIND[kind],
      // Every source populates the same credential the broker injects; they differ
      // only in how it is obtained. A derived token is the exception: its stored
      // secret is a distinct document, and naming it `apiKey` would invite code to
      // forward a signing key as one.
      credentialId: entry.type === "api-key" || entry.type === "derived-token"
        ? entry.credentialId
        : "apiKey",
      auth: entry,
    };
  });
}

/** Sources usable without a human present. */
export function unattendedCredentialSources(
  auth: readonly ExecutablePluginProviderAuth[],
): CredentialSource[] {
  return resolveCredentialSources(auth).filter((source) => !source.interactive);
}

/** True when the provider can be configured without a human present. */
export function hasUnattendedCredentialSource(
  auth: readonly ExecutablePluginProviderAuth[],
): boolean {
  return unattendedCredentialSources(auth).length > 0;
}

export { ExecutablePluginProviderAuthSchema };
