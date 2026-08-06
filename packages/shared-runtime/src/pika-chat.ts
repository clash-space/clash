import { PIKA_MEDIA_BASE_URL } from "./pika-media.js";

export interface PikaChatResult {
  text: string;
  requestId?: string;
  usage?: Record<string, number>;
}

export async function generatePikaChat(options: {
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<PikaChatResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const root = (options.baseUrl?.trim() || PIKA_MEDIA_BASE_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": options.apiKey.trim(),
  };
  let path: string;
  let body: Record<string, unknown>;
  if (options.model.startsWith("anthropic/")) {
    path = "/anthropic/v1/messages";
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: options.model,
      max_tokens: 4096,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: "user", content: options.prompt }],
    };
  } else if (options.model.startsWith("google/")) {
    path = `/genai/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
    body = {
      ...(options.systemPrompt ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } } : {}),
      contents: [{ role: "user", parts: [{ text: options.prompt }] }],
    };
  } else {
    path = "/v1/chat/completions";
    body = {
      model: options.model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        { role: "user", content: options.prompt },
      ],
    };
  }
  const response = await fetchImpl(`${root}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json() as any;
  if (!response.ok) {
    throw new Error(`Pika chat request failed: ${json?.error?.message ?? response.statusText}`);
  }
  const text = options.model.startsWith("anthropic/")
    ? json?.content?.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n")
    : options.model.startsWith("google/")
      ? json?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? "").join("")
      : json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text) throw new Error(`Pika chat returned no text for ${options.model}`);
  return {
    text,
    ...(typeof json?.id === "string" ? { requestId: json.id } : {}),
    ...(json?.usage && typeof json.usage === "object" ? { usage: json.usage } : {}),
  };
}
