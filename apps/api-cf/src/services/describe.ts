import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const OPENAI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/44af79e51582ca20c9003eb926540242/clash/openai";

/**
 * Generate a description for an image or video using GPT-4o via AI Gateway (unified billing).
 * @param cfAigToken Cloudflare AI Gateway token
 */
export async function generateDescription(
  cfAigToken: string,
  assetUrl: string,
): Promise<string> {
  const openai = createOpenAI({
    apiKey: cfAigToken,
    baseURL: OPENAI_GATEWAY_URL,
  });

  let imageContent: { type: "image"; image: URL } | { type: "image"; image: Uint8Array; mimeType: string };

  if (assetUrl.startsWith("data:")) {
    // data:image/png;base64,... → extract mime + decode to Uint8Array
    const [header, b64] = assetUrl.split(",", 2);
    const mimeType = header.replace("data:", "").replace(";base64", "") || "image/png";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    imageContent = { type: "image" as const, image: bytes, mimeType };
  } else {
    imageContent = { type: "image" as const, image: new URL(assetUrl) };
  }

  const result = await generateText({
    model: openai.chat("gpt-5"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this asset in detail. Focus on visual elements, style, and mood." },
          imageContent,
        ],
      },
    ],
  });

  if (!result.text) throw new Error("No description generated");
  return result.text;
}
