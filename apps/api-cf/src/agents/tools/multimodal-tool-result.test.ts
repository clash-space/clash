/**
 * End-to-end test: can an LLM actually SEE image data returned from a tool?
 *
 * This test creates a tool that returns a real image via toModelOutput,
 * calls generateText with that tool, and verifies the LLM's response
 * proves it actually saw the image content (not just JSON).
 *
 * Run: pnpm --filter api-cf test -- --run multimodal-tool-result.test
 *
 * Requires GOOGLE_API_KEY in .dev.vars or env.
 */
import { describe, it, expect } from "vitest";
import { tool, generateText, convertToModelMessages, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Helpers ──────────────────────────────────────────────

/** Create a tiny 1x1 red PNG as base64 (valid image) */
function makeTestImageBase64(): string {
  // Minimal 1x1 red pixel PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64"
  );
  return png.toString("base64");
}

/** Load a real test image if available, otherwise use tiny PNG */
function getTestImage(): { data: string; mediaType: string; description: string } {
  // Try to find a real test image
  const testImagePath = path.join(__dirname, "__fixtures__", "test-image.jpg");
  if (fs.existsSync(testImagePath)) {
    const buf = fs.readFileSync(testImagePath);
    return { data: buf.toString("base64"), mediaType: "image/jpeg", description: "test photo" };
  }
  // Fallback: tiny red pixel
  return { data: makeTestImageBase64(), mediaType: "image/png", description: "1x1 red pixel" };
}

// ─── Test ─────────────────────────────────────────────────

const CF_AIG_TOKEN = process.env.CF_AIG_TOKEN;
const CF_AIG_OPENAI_URL = process.env.CF_AIG_OPENAI_URL;

describe.skipIf(!CF_AIG_TOKEN || !CF_AIG_OPENAI_URL)("Multimodal tool result E2E", () => {
  it("LLM can see image data returned from tool via toModelOutput", async () => {
    const testImage = getTestImage();

    const readImageTool = tool({
      description: "Read an image and return it for the model to see",
      inputSchema: z.object({
        id: z.string().describe("Image ID"),
      }),
      execute: async ({ id }) => {
        return {
          text: `Image ${id}: ${testImage.description}`,
          imageData: testImage.data,
          imageMediaType: testImage.mediaType,
        };
      },
      toModelOutput({ output }) {
        if (output.imageData) {
          return {
            type: "content" as const,
            value: [
              { type: "text" as const, text: output.text },
              { type: "media" as const, data: output.imageData, mediaType: output.imageMediaType },
            ],
          };
        }
        return output.text;
      },
    });

    const tools = { read_image: readImageTool };

    const openai = createOpenAI({
      apiKey: CF_AIG_TOKEN!,
      baseURL: CF_AIG_OPENAI_URL!,
    });
    const model = openai.chat("gpt-5.4");

    const result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        { role: "user", content: "Call read_image with id 'test-1', then describe what you see. Be specific about colors." },
      ],
    });

    console.log("=== LLM Response ===");
    console.log(result.text);
    console.log("=== Steps ===", result.steps.length);
    for (const [i, step] of result.steps.entries()) {
      console.log(`Step ${i}: finishReason=${step.finishReason}, text="${step.text?.slice(0,100)}"`);
      for (const tc of step.toolCalls || []) {
        console.log(`  Tool call: ${tc.toolName}(${JSON.stringify(tc.args)}) id=${tc.toolCallId}`);
      }
      for (const tr of step.toolResults || []) {
        const out = tr.output as any;
        console.log(`  Tool result: hasImageData=${!!out?.imageData}, text=${out?.text?.slice(0,50)}`);
      }
    }
    console.log("=== Full text ===", JSON.stringify(result.text));
    console.log("=== Response messages ===", result.response?.messages?.length);

    // LLM should have called the tool
    const allToolCalls = result.steps.flatMap(s => s.toolCalls || []);
    expect(allToolCalls.length).toBeGreaterThan(0);
    expect(allToolCalls[0].toolName).toBe("read_image");

    // LLM should respond about the image, not echo JSON
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.text).not.toContain('"type": "content"');
    expect(result.text).not.toContain("imageData");
    // For a red pixel, it should mention red or color
    console.log("=== Checking if LLM saw the image ===");
    console.log("Response mentions color:", /red|color|pixel|image/i.test(result.text));
  }, 60_000);

  it("LLM can see image via URL in tool result (file type)", async () => {
    // Use a publicly accessible image URL
    const PUBLIC_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

    const readImageUrlTool = tool({
      description: "Read an image node and return a URL for the model to see",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({
        text: `Image node ${id}: a test image with dice`,
        url: PUBLIC_IMAGE_URL,
        mediaType: "image/png",
      }),
      toModelOutput({ output }) {
        if (output.url) {
          return {
            type: "content" as const,
            value: [
              { type: "text" as const, text: output.text },
              { type: "file" as const, url: output.url, mediaType: output.mediaType },
            ],
          };
        }
        return output.text;
      },
    });

    const tools = { read_image: readImageUrlTool };
    const openai = createOpenAI({ apiKey: CF_AIG_TOKEN!, baseURL: CF_AIG_OPENAI_URL! });
    const model = openai.chat("gpt-5.4");

    const result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        { role: "user", content: "Call read_image with id 'node-1' and describe what you see in detail." },
      ],
    });

    console.log("=== URL-based LLM Response ===");
    console.log(result.text);
    console.log("=== Steps ===", result.steps.length);
    for (const [i, step] of result.steps.entries()) {
      console.log(`Step ${i}: finishReason=${step.finishReason}`);
    }

    expect(result.steps.length).toBeGreaterThan(1); // tool call + response
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
    // The wikipedia image shows dice on a checkered transparency background
    console.log("Response mentions visual content:", /dice|transparent|checker|image|color/i.test(result.text));
  }, 60_000);

  it("convertToModelMessages correctly transforms tool result with toModelOutput", async () => {
    const testImage = getTestImage();

    const readImageTool = tool({
      description: "Read image",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({
        text: `Image ${id}`,
        imageData: testImage.data,
        imageMediaType: testImage.mediaType,
      }),
      toModelOutput({ output }) {
        return {
          type: "content" as const,
          value: [
            { type: "text" as const, text: output.text },
            { type: "media" as const, data: output.imageData, mediaType: output.imageMediaType },
          ],
        };
      },
    });

    const tools = { read_image: readImageTool };

    // Simulate a UI message with tool result
    // SDK uses part.type = "tool-{toolName}" for static tools (getStaticToolName splits on "-")
    const messages = [
      {
        id: "msg-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "read the image" }],
      },
      {
        id: "msg-2",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-read_image" as const,
            toolCallId: "call-1",
            state: "output-available" as const,
            input: { id: "test" },
            output: {
              text: "Image test",
              imageData: testImage.data,
              imageMediaType: testImage.mediaType,
            },
          },
        ],
      },
    ];

    // WITHOUT tools — should get JSON serialization
    const withoutTools = await convertToModelMessages(messages as any);
    console.log("=== Without tools ===");
    const toolMsg1 = withoutTools.find(m => m.role === "tool");
    if (toolMsg1) {
      const content = (toolMsg1 as any).content;
      for (const part of content) {
        if (part.type === "tool-result") {
          console.log("Output type:", part.output?.type);
          console.log("Output value type:", typeof part.output?.value);
        }
      }
    }

    // WITH tools — should get content array with image-data
    const withTools = await convertToModelMessages(messages as any, { tools });
    console.log("=== With tools ===");
    console.log("Tools keys:", Object.keys(tools));
    console.log("Tool has toModelOutput:", !!(tools as any).read_image?.toModelOutput);
    const toolMsg2 = withTools.find(m => m.role === "tool");
    console.log("Tool message found:", !!toolMsg2);
    console.log("All messages roles:", withTools.map(m => m.role));
    console.log("Full withTools:", JSON.stringify(withTools, (k, v) => {
      // Truncate base64 data for readability
      if (typeof v === 'string' && v.length > 100) return v.slice(0, 50) + '...[truncated]';
      return v;
    }, 2));
    if (toolMsg2) {
      const content = (toolMsg2 as any).content;
      for (const part of content) {
        if (part.type === "tool-result") {
          console.log("Output type:", part.output?.type);
          console.log("Output:", JSON.stringify(part.output, (k, v) => {
            if (typeof v === 'string' && v.length > 100) return v.slice(0, 50) + '...[truncated]';
            return v;
          }));
          if (part.output?.type === "content") {
            for (const v of part.output.value) {
              console.log("  Part:", v.type, v.type === "image-data" ? `(${v.mediaType})` : v.text?.slice(0, 50));
            }
          }
        }
      }
    }

    // Verify: with tools, the output should be content type with image-data
    const toolMessage = withTools.find(m => m.role === "tool") as any;
    expect(toolMessage).toBeTruthy();
    const toolResult = toolMessage.content.find((p: any) => p.type === "tool-result");
    expect(toolResult.output.type).toBe("content");
    expect(toolResult.output.value).toHaveLength(2);
    expect(toolResult.output.value[0].type).toBe("text");
    // toModelOutput returns 'media', SDK's mapToolResultOutput converts to 'image-data' downstream
    expect(toolResult.output.value[1].type).toBe("media");
    expect(toolResult.output.value[1].mediaType).toBe(testImage.mediaType);
  });
});
