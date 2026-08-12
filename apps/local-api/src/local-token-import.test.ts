import { createCipheriv } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importLocalProviderToken } from "./local-token-import.js";

/**
 * Reading a token out of an installed desktop app's encrypted store.
 *
 * This used to be driven by a `local-token-import` entry in a plugin's manifest -- a recipe naming
 * a subdirectory, a config file, a key file and a path into the JSON -- which the host executed
 * against the user's filesystem. That entry was one member of a union over auth types, added for a
 * single installed client, and it is gone with the rest of that registry.
 *
 * The routine stayed, because the capability is real and the host's own import endpoint still uses
 * it. What it lost was its only test: the end-to-end case in app.test.ts drove it through a
 * plugin-declared recipe, and that path was reversed when plugins stopped being able to declare
 * one. The traversal guard is the part worth keeping covered -- it is what stands between a recipe
 * and `~/.ssh` -- so it is exercised here directly rather than through an endpoint that no longer
 * reaches it.
 */
describe("importing a token from a local app store", () => {
  let root: string;

  const key = Buffer.alloc(32, 7);
  const iv = Buffer.alloc(16, 9);
  const accessToken = "hub-local-access-token";

  function encrypt(plaintext: string): string {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      "v2enc",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }

  const auth = {
    type: "local-token-import" as const,
    id: "hilo-hub",
    source: {
      format: "electron-store-aes-256-gcm-v2" as const,
      appDataSubdirectory: "@hilo/MiniMax Hub Global",
      configFile: "hub-config-global.json",
      keyFile: ".token-key",
      tokenPath: ["tokens", "accessToken"],
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "local-token-import-"));
    const appData = join(root, "@hilo", "MiniMax Hub Global");
    await mkdir(appData, { recursive: true });
    await writeFile(join(appData, ".token-key"), key);
    await writeFile(join(appData, "hub-config-global.json"), JSON.stringify({
      tokens: { accessToken: encrypt(accessToken) },
    }));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("decrypts the token the app stored", async () => {
    const imported = await importLocalProviderToken({ auth, applicationSupportRoot: root });
    expect(imported.accessToken).toBe(accessToken);
    // Named by the directory it came from, so a user with two installed clients can tell which one
    // answered without the token appearing anywhere in the response.
    expect(imported.importedFrom).toBe("MiniMax Hub Global");
  });

  it("refuses a subdirectory that climbs out of the application data root", async () => {
    // The guard that matters. Without it a recipe reading `../../.ssh` would be followed, and the
    // recipe used to come from a third-party manifest.
    await expect(importLocalProviderToken({
      auth: { ...auth, source: { ...auth.source, appDataSubdirectory: "../../.ssh" } },
      applicationSupportRoot: root,
    })).rejects.toThrow(/escapes the application data root/);
  });

  it("refuses a config file that climbs out of the app directory", async () => {
    await expect(importLocalProviderToken({
      auth: { ...auth, source: { ...auth.source, configFile: "../hub-config-global.json" } },
      applicationSupportRoot: root,
    })).rejects.toThrow(/escapes the application data root/);
  });

  it("refuses a key file that climbs out of the app directory", async () => {
    await expect(importLocalProviderToken({
      auth: { ...auth, source: { ...auth.source, keyFile: "../.token-key" } },
      applicationSupportRoot: root,
    })).rejects.toThrow(/escapes the application data root/);
  });

  it("yields no token from a path naming an inherited property", async () => {
    // `tokenPath` walks JSON by property name, and the recipe used to come from a third-party
    // manifest, so a path aimed at the prototype chain is worth asserting cannot produce a value.
    //
    // What this does not do is isolate one guard. Three checks combine here -- own-property, the
    // "still an object" test between segments, and the final "is it a string" -- and removing the
    // own-property check alone changes no outcome, because `constructor` resolves to a function and
    // the object check stops the walk anyway. The assertion is on the behaviour, not on which line
    // produces it.
    //
    // The schema used to refuse `__proto__`, `constructor` and `prototype` in a declared path
    // outright. That validation went with the auth-type registry; only the runtime behaviour
    // asserted here remains.
    for (const tokenPath of [["constructor", "name"], ["__proto__", "accessToken"], ["__proto__"]]) {
      await expect(importLocalProviderToken({
        auth: { ...auth, source: { ...auth.source, tokenPath } },
        applicationSupportRoot: root,
      }), tokenPath.join(".")).rejects.toThrow(/does not contain the declared token field/);
    }
  });

  it("rejects a key that is not 32 bytes rather than deriving one", async () => {
    const appData = join(root, "@hilo", "MiniMax Hub Global");
    await writeFile(join(appData, ".token-key"), Buffer.alloc(16, 7));
    await expect(importLocalProviderToken({ auth, applicationSupportRoot: root }))
      .rejects.toThrow(/must be 32 bytes/);
  });

  it("reports a ciphertext that does not decrypt rather than returning empty", async () => {
    // AES-GCM authenticates. A tampered or wrong-key payload has to fail loudly, because an empty
    // string returned here would be stored as a credential and fail much later as a 401.
    const appData = join(root, "@hilo", "MiniMax Hub Global");
    const wrongKey = Buffer.alloc(32, 8);
    const cipher = createCipheriv("aes-256-gcm", wrongKey, iv);
    const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
    await writeFile(join(appData, "hub-config-global.json"), JSON.stringify({
      tokens: {
        accessToken: [
          "v2enc",
          iv.toString("base64"),
          cipher.getAuthTag().toString("base64"),
          ciphertext.toString("base64"),
        ].join(":"),
      },
    }));
    await expect(importLocalProviderToken({ auth, applicationSupportRoot: root }))
      .rejects.toThrow(/could not be decrypted/);
  });
});
