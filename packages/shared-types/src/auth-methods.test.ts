import { describe, expect, it } from "vitest";

import { PluginAuthDeclarationSchema } from "./plugin-auth.js";
import { authFormControls, missingAuthKeys } from "./auth-form.js";

/**
 * An authentication method is a whole configuration, not a field.
 *
 * The declaration was one flat form, and the ways of authenticating had to be reconstructed from
 * it: `oneOf` said two keys were alternatives, and a `when` condition hid a field once another was
 * filled. Both were the host inferring a structure the plugin knows outright.
 *
 * Google is the case that broke it. A service account is one method and needs only its JSON; an API
 * key is another and additionally needs to say which surface it addresses, because a key works on
 * AI Studio *and* on Agent Platform in Express mode. Expressed as loose fields, `service` belongs to
 * one method and not the other, and the flat form has no way to say so -- hence a cross-field
 * condition, and before that a wrong claim in a notice that Agent Platform refuses API keys.
 *
 * Declared as methods, each carries its own fields and nothing needs inferring.
 *
 * The host stays ignorant, which is the point. It does not know that `apiKey` is an API key or that
 * `serviceAccountKey` is JSON -- they are a secret field and a secret field. Any host logic keyed
 * on those names would be the host guessing at meaning the plugin never gave it.
 */
const google = PluginAuthDeclarationSchema.parse({
  methods: [
    {
      id: "service-account",
      label: "Service account",
      form: [{ kind: "field", key: "serviceAccountKey", label: "Service account JSON", secret: true }],
    },
    {
      id: "api-key",
      label: "API key",
      form: [
        {
          kind: "choice", key: "service", label: "Service",
          options: [
            { value: "ai-studio", label: "Google AI Studio" },
            { value: "agent-platform", label: "Google Cloud Agent Platform" },
          ],
          default: "ai-studio",
        },
        { kind: "field", key: "apiKey", label: "API key", secret: true },
      ],
    },
  ],
});

const hub = PluginAuthDeclarationSchema.parse({
  methods: [
    {
      id: "sign-in",
      label: "Sign in to MiniMax Hub",
      flow: { open: "https://hub.minimax.io/login", callback: { type: "scheme", scheme: "minimax-hub" } },
    },
    {
      id: "token",
      label: "Paste a token",
      form: [{ kind: "field", key: "accessToken", label: "Access token", secret: true }],
    },
  ],
});

describe("auth methods", () => {
  it("accepts a declaration of several methods", () => {
    expect(PluginAuthDeclarationSchema.safeParse(google).success).toBe(true);
    expect(PluginAuthDeclarationSchema.safeParse(hub).success).toBe(true);
  });

  it("refuses two methods sharing an id", () => {
    // The account records which method it uses by id. Two with one id makes that record ambiguous.
    const bad = { methods: [google.methods[0], { ...google.methods[1], id: "service-account" }] };
    expect(PluginAuthDeclarationSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses a method that neither collects anything nor starts a flow", () => {
    // A method with no form and no flow offers the user a name and nothing to do with it.
    const bad = { methods: [{ id: "empty", label: "Empty" }] };
    expect(PluginAuthDeclarationSchema.safeParse(bad).success).toBe(false);
  });

  it("renders only the chosen method's fields", () => {
    // `service` belongs to the API key method. Showing it beside a service account JSON is what the
    // flat form did, and it invited an account whose settings contradict each other.
    const controls = authFormControls(google, {}, "service-account");
    expect(controls.flatMap((control) => "key" in control ? [control.key] : [])).toEqual([
      "serviceAccountKey",
    ]);

    const withKey = authFormControls(google, {}, "api-key");
    expect(withKey.flatMap((control) => "key" in control ? [control.key] : [])).toEqual([
      "service",
      "apiKey",
    ]);
  });

  it("reports what the chosen method still needs", () => {
    expect(missingAuthKeys(google, {}, "api-key")).toEqual(["apiKey"]);
    expect(missingAuthKeys(google, { apiKey: "k" }, "api-key")).toEqual([]);
    expect(missingAuthKeys(google, {}, "service-account")).toEqual(["serviceAccountKey"]);
  });

  it("treats a flow-only method as satisfied by what the flow stored", () => {
    expect(missingAuthKeys(hub, {}, "sign-in")).toEqual([]);
    expect(missingAuthKeys(hub, {}, "token")).toEqual(["accessToken"]);
  });
});
