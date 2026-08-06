import { describe, expect, it } from "vitest";
import { generatePikaChat } from "./pika-chat.js";

describe("Pika synchronous chat", () => {
  it.each([
    ["openai/gpt-5.6-sol", "/v1/chat/completions", { choices: [{ message: { content: "sol" } }] }, "sol"],
    ["anthropic/claude-sonnet-5", "/anthropic/v1/messages", { content: [{ type: "text", text: "sonnet" }] }, "sonnet"],
    ["google/gemini-3.6-flash", "/genai/v1beta/models/google%2Fgemini-3.6-flash:generateContent", { candidates: [{ content: { parts: [{ text: "gemini" }] } }] }, "gemini"],
  ])("routes %s through its documented Pika protocol", async (model, path, body, text) => {
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await generatePikaChat({
      apiKey: "pk_live_test",
      model,
      prompt: "hello",
      systemPrompt: "be concise",
      fetch: async (input, init) => {
        request = { url: String(input), init };
        return Response.json(body);
      },
    });
    expect(request?.url).toBe(`https://api.dev.pika.art${path}`);
    expect(request?.init?.headers).toMatchObject({ "x-api-key": "pk_live_test" });
    expect(result.text).toBe(text);
  });
});
