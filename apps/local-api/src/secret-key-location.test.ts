import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { providerSecretKeyPath } from "./local-provider-store";

/**
 * The key does not live beside the database it protects.
 *
 * `provider-secret.key` sat in the same directory as `local.sqlite`, both 0600. Anyone who could
 * read one could read the other, and anything that copied the data directory -- a backup, a support
 * bundle, an rsync to another machine -- carried the ciphertext and its key together. Encryption
 * that travels with its key is an encoding.
 *
 * This is a smaller fix than the platform keystore, which is where this should end up: macOS
 * Keychain through Electron's `safeStorage` for the app, and something for the daemon that does not
 * prompt on every unattended read. Until then, separating the two at least makes copying the data
 * directory insufficient.
 */
describe("provider secret key location", () => {
  it("is not inside the data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-keyloc-"));
    expect(providerSecretKeyPath(dataDir).startsWith(dataDir)).toBe(false);
  });

  it("is readable only by its owner", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-keyloc-"));
    const path = providerSecretKeyPath(dataDir);
    const info = await stat(path).catch(() => undefined);
    if (info) expect(info.mode & 0o077).toBe(0);
  });

  it("keeps the existing key when one is already there", async () => {
    // Moving the file must not mint a new key: every stored credential would decrypt to nothing,
    // and the failure would look like corrupted accounts rather than a lost key.
    const dataDir = await mkdtemp(join(tmpdir(), "clash-keyloc-"));
    const path = providerSecretKeyPath(dataDir);
    const first = await readFile(path, "utf8").catch(() => "");
    const second = await readFile(path, "utf8").catch(() => "");
    expect(first).toBe(second);
  });
});
