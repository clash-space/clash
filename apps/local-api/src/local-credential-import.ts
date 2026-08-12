import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reading a credential an already-installed local app is holding.
 *
 * A third way a method obtains a credential, beside a form the user fills and a flow the host
 * drives. hrhrng.hub worked this way: the MiniMax Hub desktop app is installed and signed in, and
 * the plugin declares a recipe for reading the token it already holds. No browser, no callback, no
 * custom scheme, and nothing for the user to do.
 *
 * That method was removed during a conversion on the grounds that a recipe the host executes
 * against another app's files is a path a plugin could point anywhere. The concern is real, but it
 * is not this product's bargain: the plugin sandbox was removed deliberately, and a plugin can
 * already read any file its user can. Removing it bought no safety and cost the only automatic path
 * to a credential.
 *
 * The recipe names the format, so the host never sniffs. Sniffing would mean guessing at another
 * app's storage, and guessing wrong yields plausible bytes rather than an error.
 */

export interface LocalCredentialRecipe {
  format: "electron-store-aes-256-gcm-v2";
  configFile: string;
  keyFile: string;
  /** Where the value sits inside the config, e.g. ["tokens", "accessToken"]. */
  tokenPath: string[];
  /** The store key to write it under. */
  storeAs: string;
}

const PREFIX = "v2enc";

function valueAt(config: unknown, path: string[]): string | undefined {
  let current: unknown = config;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

export async function importLocalCredential(
  recipe: LocalCredentialRecipe,
  appDataDir: string,
): Promise<Record<string, string>> {
  if (recipe.format !== "electron-store-aes-256-gcm-v2") {
    throw new Error(
      `This host cannot read the format ${String(recipe.format)} that the Provider declared.`,
    );
  }

  let rawConfig: string;
  let key: Buffer;
  try {
    [rawConfig, key] = await Promise.all([
      readFile(join(appDataDir, recipe.configFile), "utf8"),
      readFile(join(appDataDir, recipe.keyFile)),
    ]);
  } catch {
    // By far the common case is that the app simply is not there. Reporting a missing path sends
    // the reader looking for a bug in us.
    throw new Error(
      "The local app this Provider imports from is not installed, or has never been signed in.",
    );
  }

  const encrypted = valueAt(JSON.parse(rawConfig) as unknown, recipe.tokenPath);
  if (!encrypted) {
    throw new Error(
      `The local app is installed but holds nothing at ${recipe.tokenPath.join(".")}; sign in to it first.`,
    );
  }

  const [prefix, iv, tag, body] = encrypted.split(":");
  if (prefix !== PREFIX || !iv || !tag || !body) {
    throw new Error(`The stored value is not in ${PREFIX} form, so this recipe does not fit it.`);
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    // GCM authenticates as well as encrypts. Without this the wrong key yields plausible bytes,
    // which would be stored as a credential and then fail at the vendor for reasons of its own.
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return { [recipe.storeAs]: plaintext };
  } catch {
    throw new Error(
      "The local app's stored credential could not be decrypted; it may have been re-encrypted "
      + "under a new key, in which case signing in to that app again will refresh it.",
    );
  }
}
