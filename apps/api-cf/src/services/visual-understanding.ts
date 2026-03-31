/**
 * Visual Understanding via Cloudflare Workers AI — Kimi K2.5.
 *
 * Analyzes images/video frames to produce structured understanding:
 * description, shot segmentation, and tags.
 */

export interface VisualShot {
  start: number;
  end: number;
  description: string;
}

export interface VisualUnderstandingResult {
  description?: string;
  shots?: VisualShot[];
  tags?: string[];
}

const VISUAL_ANALYSIS_PROMPT = `Analyze this image/video frame in detail. Return a JSON object with:
- "description": A concise description of the visual content, style, and mood.
- "shots": An array of detected shots/scenes. Each shot has "start" (seconds), "end" (seconds), and "description". For a single image, use one shot with start=0, end=0.
- "tags": An array of relevant tags (e.g. "outdoor", "portrait", "dark", "animation").

Return ONLY valid JSON, no markdown fences.`;

/**
 * Analyze an image or video frame using Kimi K2.5 via Workers AI.
 * @param ai Workers AI binding (env.AI)
 * @param imageDataUri Base64 data URI of the image/frame
 */
export async function analyzeVisual(
  ai: Ai,
  imageDataUri: string,
): Promise<VisualUnderstandingResult> {
  const response = await ai.run("@moonshot/kimi-k2.5" as Parameters<Ai["run"]>[0], {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISUAL_ANALYSIS_PROMPT },
          { type: "image_url", image_url: { url: imageDataUri } },
        ],
      },
    ],
  }) as { response?: string };

  const text = response?.response || "";

  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      description: parsed.description || undefined,
      shots: Array.isArray(parsed.shots) ? parsed.shots : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
    };
  } catch {
    // If JSON parsing fails, return the raw text as description
    return { description: text || undefined };
  }
}
