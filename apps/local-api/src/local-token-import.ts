import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Where a desktop app keeps a token, and how to read it.
 *
 * Declared here rather than in `@clash/shared-types` because it is no longer part of the plugin
 * protocol. It used to be a `local-token-import` member of a union over auth types, which a plugin
 * wrote into its manifest and the host executed. That registry is gone: a union over auth types
 * needs a member per vendor, and this one existed for a single installed client.
 *
 * The decryption itself is unchanged and still used by the host's own import endpoint. What moved
 * is only where the recipe comes from -- this type, rather than a schema every plugin could write
 * to. The traversal guard below is what makes that safe to keep: every path is resolved inside the
 * application data root, and one that escapes throws rather than reading `~/.ssh`.
 */
export interface LocalTokenImportAuth {
  type: "local-token-import";
  id: string;
  label?: string;
  source: {
    format: "electron-store-aes-256-gcm-v2";
    appDataSubdirectory: string;
    configFile: string;
    keyFile: string;
    tokenPath: readonly string[];
  };
}

const ENCRYPTED_V2_PREFIX = "v2enc:";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function defaultLocalTokenAppDataRoot(options: {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const env = options.env ?? process.env;
  if (platform === "darwin") return join(homeDirectory, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA?.trim() || join(homeDirectory, "AppData", "Roaming");
  return env.XDG_CONFIG_HOME?.trim() || join(homeDirectory, ".config");
}

function resolveInside(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  const fromRoot = relative(absoluteRoot, target);
  if (!fromRoot || fromRoot === ".") return target;
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Local token source escapes the application data root.");
  }
  return target;
}

function objectAtPath(input: unknown, path: readonly string[]): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function decodeV2Token(stored: string, key: Buffer): string {
  if (!stored.startsWith(ENCRYPTED_V2_PREFIX)) {
    throw new Error("Local token is not encrypted with the supported v2 format.");
  }
  const parts = stored.slice(ENCRYPTED_V2_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Local token ciphertext is malformed.");
  const [ivBase64, authTagBase64, ciphertextBase64] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) {
    throw new Error("Local token ciphertext is malformed.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      .toString("utf8")
      .trim();
    if (!plaintext) throw new Error("Local token is empty.");
    return plaintext;
  } catch (error) {
    if (error instanceof Error && error.message === "Local token is empty.") throw error;
    throw new Error("Local token could not be decrypted with the app key.");
  }
}

export async function importLocalProviderToken(options: {
  auth: LocalTokenImportAuth;
  applicationSupportRoot?: string;
}): Promise<{ accessToken: string; importedFrom: string }> {
  const root = options.applicationSupportRoot ?? defaultLocalTokenAppDataRoot();
  const appDataDirectory = resolveInside(root, options.auth.source.appDataSubdirectory);
  const configPath = resolveInside(appDataDirectory, options.auth.source.configFile);
  const keyPath = resolveInside(appDataDirectory, options.auth.source.keyFile);
  const [configBytes, key] = await Promise.all([readFile(configPath), readFile(keyPath)]);
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Local token key must be ${KEY_LENGTH} bytes.`);
  }
  let config: unknown;
  try {
    config = JSON.parse(configBytes.toString("utf8"));
  } catch {
    throw new Error("Local token config is not valid JSON.");
  }
  const stored = objectAtPath(config, options.auth.source.tokenPath);
  if (typeof stored !== "string" || !stored.trim()) {
    throw new Error("Local token config does not contain the declared token field.");
  }
  return {
    accessToken: decodeV2Token(stored.trim(), key),
    importedFrom: basename(appDataDirectory),
  };
}
