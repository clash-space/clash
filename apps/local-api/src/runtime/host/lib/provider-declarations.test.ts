import { describe, expect, it } from "vitest";

import { providerRegistrationsFrom } from "./provider-declarations";

/**
 * A Provider's declaration is readable without running it.
 *
 * `listProviders` skipped any plugin with no live session, so a freshly installed Provider was
 * invisible until something happened to spawn it. The symptom was circular: connecting an account
 * reads the declaration to validate the settings, and the plugin is only spawned once it has an
 * account -- so `--set apiKey=...` answered "this provider does not declare an apiKey setting" for
 * a Provider whose manifest declared exactly that.
 *
 * Reading a declaration is reading a file the installer already validated. The session gates
 * *invoking* the plugin, which is a different question.
 */
const MANIFEST = {
  apiVersion: "clash.plugin/v1" as const,
  id: "clash.google",
  version: "0.1.0",
  name: "Google",
  runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "dist/stdio.mjs", args: [] },
  contributes: { functions: [{ id: "google-execute", kind: "provider-executor" as const }] },
};

const DOCUMENT = {
  apiVersion: "clash.provider/v1" as const,
  kind: "provider" as const,
  spec: {
    id: "google",
    name: "Google",
    upstreamId: "google-ai-studio",
    apiShape: "google-ai-studio",
    executorExportId: "google-execute",
    auth: {
      methods: [{
        id: "api-key",
        label: "API key",
        form: [{ kind: "field" as const, key: "apiKey", label: "API key", secret: true }],
      }],
    },
  },
};

function loaded(overrides: Record<string, unknown> = {}) {
  return [{
    loaded: { manifest: MANIFEST, providers: { google: DOCUMENT }, schemaHash: `sha256:${"0".repeat(64)}` },
    session: undefined,
    ...overrides,
  }];
}

describe("provider declarations", () => {
  it("lists a Provider that has never been spawned", () => {
    const registrations = providerRegistrationsFrom(loaded());
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.document.spec.id).toBe("google");
  });

  it("carries the auth declaration, which is what a caller came for", () => {
    const [registration] = providerRegistrationsFrom(loaded());
    expect(registration!.document.spec.auth?.methods[0]?.form?.[0]).toMatchObject({ key: "apiKey" });
  });

  it("still skips a plugin with no schema hash", () => {
    // No hash means the installer never attested it. Reporting its declaration would let an
    // unverified file decide what a settings screen renders.
    const registrations = providerRegistrationsFrom(
      loaded({ loaded: { manifest: MANIFEST, providers: { google: DOCUMENT }, schemaHash: undefined } }),
    );
    expect(registrations).toEqual([]);
  });

  it("skips an entry whose manifest is not an executable plugin", () => {
    const registrations = providerRegistrationsFrom(
      loaded({ loaded: { manifest: { name: "legacy action" }, providers: { google: DOCUMENT }, schemaHash: "sha256:x" } }),
    );
    expect(registrations).toEqual([]);
  });

  it("lists every Provider a plugin declares, not just the first", () => {
    const two = loaded({
      loaded: {
        manifest: MANIFEST,
        providers: { google: DOCUMENT, other: { ...DOCUMENT, spec: { ...DOCUMENT.spec, id: "other" } } },
        schemaHash: `sha256:${"0".repeat(64)}`,
      },
    });
    expect(providerRegistrationsFrom(two).map((r) => r.document.spec.id).sort())
      .toEqual(["google", "other"]);
  });
});
