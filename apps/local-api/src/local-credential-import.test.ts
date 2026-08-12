import { describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importLocalCredential } from "./local-credential-import.js";

/**
 * Reading a credential an already-installed local app is holding.
 *
 * This is a third way a method obtains a credential, beside a form the user fills and a flow the
 * host drives. It is how hrhrng.hub worked before: the MiniMax Hub desktop app is installed and
 * logged in, and the plugin declared a recipe for reading the token it already holds -- no browser,
 * no callback, no scheme.
 *
 * I removed that method while converting the plugin, unilaterally, on the grounds that a recipe the
 * host executes against another app's files is a path a plugin could point anywhere. That concern
 * is real but it is not this product's bargain: the plugin sandbox was removed deliberately, and a
 * plugin can already read any file the user can. Removing the method bought no safety and cost the
 * only automatic path to a credential -- everything that followed, guessing at the OAuth shape,
 * getting the callback wrong, and finally reading a cookie out of a browser by hand, was downstream
 * of that deletion.
 *
 * The recipe names the format, so the host is not sniffing. `v2enc:` is AES-256-GCM with the IV and
 * the auth tag ahead of the ciphertext, and the key sits beside the config in its own file.
 */
function hubFixture(token: string) {
  const dir = mkdtempSync(join(tmpdir(), "hub-"));
  const key = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  writeFileSync(join(dir, ".token-key"), key);
  writeFileSync(join(dir, "hub-config-global.json"), JSON.stringify({
    _version: 17,
    tokens: {
      accessToken: `v2enc:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`,
    },
  }));
  return dir;
}

const recipe = {
  format: "electron-store-aes-256-gcm-v2" as const,
  configFile: "hub-config-global.json",
  keyFile: ".token-key",
  tokenPath: ["tokens", "accessToken"],
  storeAs: "accessToken",
};

describe("importLocalCredential", () => {
  it("decrypts the token the local app holds", async () => {
    const dir = hubFixture("jwt-from-the-local-app");
    expect(await importLocalCredential(recipe, dir))
      .toEqual({ accessToken: "jwt-from-the-local-app" });
  });

  it("says the app is not installed rather than failing on a path", async () => {
    // The common case by far: the user simply does not have the app. A message about a missing file
    // sends them to look for a bug.
    await expect(importLocalCredential(recipe, join(tmpdir(), "definitely-absent")))
      .rejects.toThrow(/not installed|not signed in/i);
  });

  it("refuses a tampered ciphertext instead of returning rubbish", async () => {
    // GCM authenticates. Without the tag check a wrong key yields plausible bytes, which would be
    // stored as a credential and fail at the vendor for reasons of its own.
    const dir = hubFixture("real-token");
    const configPath = join(dir, "hub-config-global.json");
    const config = JSON.parse(String(require("node:fs").readFileSync(configPath))) as
      { tokens: { accessToken: string } };
    const [prefix, iv, tag, body] = config.tokens.accessToken.split(":");
    const flipped = Buffer.from(body!, "base64");
    flipped[0] ^= 0xff;
    config.tokens.accessToken = `${prefix}:${iv}:${tag}:${flipped.toString("base64")}`;
    writeFileSync(configPath, JSON.stringify(config));

    await expect(importLocalCredential(recipe, dir)).rejects.toThrow(/could not be decrypted/i);
  });

  it("refuses a format it was not told about", async () => {
    // The recipe names the format; the host does not sniff. An unknown one is a plugin declaring
    // something this host cannot honour, which is worth saying plainly.
    await expect(importLocalCredential(
      { ...recipe, format: "some-future-format" as never },
      hubFixture("t"),
    )).rejects.toThrow(/some-future-format/);
  });

  it("says which path was empty when the app is installed but signed out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-"));
    writeFileSync(join(dir, ".token-key"), randomBytes(32));
    writeFileSync(join(dir, "hub-config-global.json"), JSON.stringify({ _version: 17, tokens: {} }));

    await expect(importLocalCredential(recipe, dir)).rejects.toThrow(/tokens\.accessToken/);
  });
});
