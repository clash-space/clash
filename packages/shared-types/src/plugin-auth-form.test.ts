import { describe, expect, it } from "vitest";

import { PluginAuthDeclarationSchema } from "./plugin-auth.js";

/**
 * The form is declared; the host renders it.
 *
 * There is no auth-type registry, because there is no closed set of auth types. One vendor signs
 * requests with an access-key pair; another wants a console token; Google accepts several
 * credential forms. A registry would need a new entry for each, which
 * means editing the host to add a provider.
 *
 * So the vendor declares its own shape, and the host only stores what comes back. What the host
 * needs to know is how to *draw* it -- five kinds cover every vendor examined.
 *
 * A declaration used to be a flat `{ form: [...] }`, with `oneOf` and `when` bolted on to say which
 * fields were alternatives. Both were the host inferring a structure the plugin knows outright, and
 * both are gone: the alternatives are the methods themselves. Every case below therefore nests its
 * form inside a method.
 *
 * The negative cases pair the refusal with an otherwise-identical acceptance. Without that pairing
 * they proved nothing here: a top-level `form` is rejected by the strict `{ methods }` schema
 * before anything inside it is read, so `refuses a flow that opens a non-https address` went on
 * passing after the migration while testing only that the envelope had changed. A fully valid flat
 * form reports `success: false` for the same reason.
 */

/** A declaration around one method, so a case says what it is about and not how methods work. */
const declaring = (method: Record<string, unknown>) => ({
  methods: [{ id: "primary", label: "Primary", ...method }],
});

describe("auth declarations", () => {
  it("accepts a field and a notice, which is the whole of an api-key provider", () => {
    const parsed = PluginAuthDeclarationSchema.safeParse(declaring({
      form: [
        { kind: "field", key: "apiKey", label: "API key", secret: true },
        { kind: "notice", text: "Create one at aistudio.google.com/apikey" },
      ],
    }));
    expect(parsed.success).toBe(true);
  });

  it("accepts a choice, which is where a setting lives now", () => {
    // `region` and `service` used to be columns the host understood. They are keys like any other.
    const parsed = PluginAuthDeclarationSchema.safeParse(declaring({
      form: [{
        kind: "choice",
        key: "region",
        label: "Region",
        options: [
          { value: "global", label: "Global" },
          { value: "us-central1", label: "us-central1" },
        ],
        default: "global",
      }],
    }));
    expect(parsed.success).toBe(true);
  });

  it("requires a choice to offer options", () => {
    // A menu with nothing on it renders as a control the user cannot satisfy.
    const choice = (options: unknown[]) => declaring({
      form: [{ kind: "choice", key: "region", label: "Region", options }],
    });
    expect(PluginAuthDeclarationSchema.safeParse(
      choice([{ value: "global", label: "Global" }]),
    ).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(choice([])).success).toBe(false);
  });

  it("carries a browser flow with a loopback callback", () => {
    // Google requires loopback for desktop clients; the out-of-band flow was withdrawn in 2022.
    const parsed = PluginAuthDeclarationSchema.safeParse(declaring({
      form: [{ kind: "button", key: "signIn", label: "Sign in with Google" }],
      flow: {
        open: "https://accounts.google.com/o/oauth2/v2/auth",
        callback: { type: "loopback" },
      },
    }));
    expect(parsed.success).toBe(true);
  });

  it("refuses a flow that opens a non-https address", () => {
    // The address is opened in the user's browser. A plaintext one would carry the request, and
    // anything echoed back to it, in the clear.
    const opening = (open: string) => declaring({
      form: [],
      flow: { open, callback: { type: "loopback" } },
    });
    expect(PluginAuthDeclarationSchema.safeParse(
      opening("https://accounts.example.test/auth"),
    ).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(
      opening("http://accounts.example.test/auth"),
    ).success).toBe(false);
  });

  it("accepts the two renewal schedules the host can act on", () => {
    // The method carries a field as well: one that renews but collects nothing, starts no flow and
    // imports nothing offers the user a name and nothing to do with it, and would be refused for
    // that instead of for its schedule.
    const renewing = (renew: unknown) => declaring({
      form: [{ kind: "field", key: "apiKey", label: "API key", secret: true }],
      renew,
    });
    expect(PluginAuthDeclarationSchema.safeParse(renewing({ before: "60s" })).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(renewing({ every: "12h" })).success).toBe(true);
  });

  it("refuses a renewal that declares both", () => {
    // Two schedules for one credential is two answers to when the host should wake the plugin.
    const renewing = (renew: unknown) => declaring({
      form: [{ kind: "field", key: "apiKey", label: "API key", secret: true }],
      renew,
    });
    expect(PluginAuthDeclarationSchema.safeParse(renewing({ before: "60s" })).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(
      renewing({ before: "60s", every: "12h" }),
    ).success).toBe(false);
  });

  it("refuses an unknown form kind rather than skipping it", () => {
    // Silently dropping one would render a form missing the field that carries the credential, and
    // the account would fail later for a reason the form never showed.
    const item = (kind: string) => declaring({
      form: [{ kind, key: "x", label: "x" }],
    });
    expect(PluginAuthDeclarationSchema.safeParse(item("field")).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(item("captcha")).success).toBe(false);
  });

  it("refuses the flat form the declaration used to be", () => {
    // The shape every case above was written against. It is worth pinning because its silent
    // rejection is what let the refusals here go on passing while testing nothing: this same
    // declaration is valid in every respect except that `form` no longer sits at the top.
    expect(PluginAuthDeclarationSchema.safeParse({
      form: [{ kind: "field", key: "apiKey", label: "API key", secret: true }],
    }).success).toBe(false);
  });
});
