import type { Env } from "../../config";
import { signAssetPath } from "../../services/asset-signing";

export async function signedMediaUrl(env: Env, storageKey: string): Promise<string> {
  const mediaBase = env.MEDIA_GATEWAY_URL || env.WORKER_PUBLIC_URL || env.R2_PUBLIC_URL;
  if (!mediaBase) {
    throw new Error("MEDIA_GATEWAY_URL, WORKER_PUBLIC_URL, or R2_PUBLIC_URL is required for provider media references.");
  }
  const signedPath = await signAssetPath(env, storageKey);
  return `${mediaBase.replace(/\/$/, "")}${signedPath}`;
}

export async function signedMediaUrls(env: Env, storageKeys: string[] | undefined): Promise<string[] | undefined> {
  if (!storageKeys?.length) return undefined;
  return Promise.all(storageKeys.map((key) => signedMediaUrl(env, key)));
}
