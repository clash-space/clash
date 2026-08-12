import { describe, expect, it } from "vitest";

import { PluginAuthDeclarationSchema } from "./plugin-auth.js";
import { authFormControls, missingAuthKeys } from "./auth-form.js";

/**
 * A third way a method obtains a credential: import one an installed local app already holds.
 *
 * Beside a form the user fills and a flow the host drives, some vendors ship their own desktop app
 * and the user is already signed in to it. hrhrng.hub worked this way before: the recipe named the
 * format, the directory, the file and the field, and the host read it. No browser, no callback,
 * nothing for the user to do.
 *
 * The method was dropped during a conversion on the grounds that a recipe the host executes against
 * another app's files is a path a plugin could point anywhere. That concern is real but it is not
 * this product's bargain -- the plugin sandbox was removed deliberately, and a plugin can already
 * read any file its user can. Dropping it bought no safety and cost the only automatic path to a
 * credential.
 */
const hub = PluginAuthDeclarationSchema.parse({
  methods: [
    {
      id: "reuse-local-login",
      label: "Reuse MiniMax Hub login",
      import: {
        format: "electron-store-aes-256-gcm-v2",
        appDataSubdirectory: "@hilo/MiniMax Hub Global",
        configFile: "hub-config-global.json",
        keyFile: ".token-key",
        tokenPath: ["tokens", "accessToken"],
        storeAs: "accessToken",
      },
    },
    {
      id: "token",
      label: "Paste an access token",
      form: [{ kind: "field", key: "accessToken", label: "Access token", secret: true }],
    },
  ],
});

describe("import method", () => {
  it("is accepted", () => {
    expect(PluginAuthDeclarationSchema.safeParse(hub).success).toBe(true);
  });

  it("satisfies a method on its own, with no field to fill", () => {
    // The whole point is that the user does nothing. Reporting a missing key would put a required
    // field in front of someone who is already signed in.
    expect(missingAuthKeys(hub, {}, "reuse-local-login")).toEqual([]);
    expect(authFormControls(hub, {}, "reuse-local-login")).toEqual([]);
  });

  it("refuses a recipe with an empty token path", () => {
    // An empty path reads the whole config object, which is not a credential and would be stored as
    // one.
    const bad = structuredClone(hub);
    (bad.methods[0]!.import as { tokenPath: string[] }).tokenPath = [];
    expect(PluginAuthDeclarationSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses a recipe that does not say where to store what it read", () => {
    const bad = structuredClone(hub) as { methods: Record<string, unknown>[] };
    delete (bad.methods[0]!.import as Record<string, unknown>).storeAs;
    expect(PluginAuthDeclarationSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses an absolute or escaping subdirectory", () => {
    // The recipe names a subdirectory of the user's application data, not an arbitrary path. This
    // does not make the read safe -- nothing here is a sandbox -- but a declaration that reaches
    // outside is far more likely to be a mistake than an intention.
    for (const bad of ["/etc", "../../.ssh", "~/.aws"]) {
      const declaration = structuredClone(hub);
      (declaration.methods[0]!.import as { appDataSubdirectory: string }).appDataSubdirectory = bad;
      expect(PluginAuthDeclarationSchema.safeParse(declaration).success).toBe(false);
    }
  });
});
