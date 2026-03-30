/**
 * REST API client for project CRUD (non-Loro operations).
 */

import { getServerUrl, requireApiKey } from "./config";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const url = `${serverUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  return res;
}

export async function apiJson<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
