import {
  HostedExecutablePluginCapabilitySchema,
  type HostedExecutablePluginCapability,
} from "@clash/shared-types";
import { z } from "zod";

const HostedCredentialCapabilitySchema = z.object({
  protocol: z.literal("clash.plugin.credential-capability/v1"),
  capabilityId: z.string().trim().min(1),
  parentCapabilityId: z.string().trim().min(1),
  invocationId: z.string().trim().min(1),
  pluginId: z.string().trim().min(1),
  secretId: z.string().trim().min(1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict().refine((value) => value.expiresAt > value.issuedAt, {
  path: ["expiresAt"],
  message: "Credential capability must expire after it is issued.",
});

export type HostedCredentialCapability = z.infer<typeof HostedCredentialCapabilitySchema>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (!secret.trim()) throw new Error("Hosted plugin capability signing key is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signHostedExecutablePluginCapability(
  input: unknown,
  secret: string,
): Promise<string> {
  const capability = HostedExecutablePluginCapabilitySchema.parse(input);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(capability)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySignedPayload(token: string, secret: string): Promise<unknown> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new Error("Hosted plugin capability token is malformed.");
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    base64UrlToBytes(signature),
    new TextEncoder().encode(payload),
  );
  if (!valid) throw new Error("Hosted plugin capability signature is invalid.");
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    throw new Error("Hosted plugin capability payload is invalid.");
  }
}

export async function verifyHostedExecutablePluginCapability(
  token: string,
  secret: string,
  options: { nowSeconds?: number } = {},
): Promise<HostedExecutablePluginCapability> {
  const capability = HostedExecutablePluginCapabilitySchema.parse(
    await verifySignedPayload(token, secret),
  );
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (capability.expiresAt <= nowSeconds) throw new Error("Hosted plugin capability has expired.");
  if (capability.issuedAt > nowSeconds + 60) throw new Error("Hosted plugin capability is not active yet.");
  return capability;
}


export async function signHostedCredentialCapability(
  input: unknown,
  secret: string,
): Promise<string> {
  const capability = HostedCredentialCapabilitySchema.parse(input);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(capability)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(payload),
  );
  return `clash-secret://${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyHostedCredentialCapability(
  handle: string,
  secret: string,
  options: { nowSeconds?: number } = {},
): Promise<HostedCredentialCapability> {
  if (!handle.startsWith("clash-secret://")) throw new Error("Credential handle is malformed.");
  const capability = HostedCredentialCapabilitySchema.parse(
    await verifySignedPayload(handle.slice("clash-secret://".length), secret),
  );
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (capability.expiresAt <= nowSeconds) throw new Error("Credential handle has expired.");
  if (capability.issuedAt > nowSeconds + 60) throw new Error("Credential handle is not active yet.");
  return capability;
}
