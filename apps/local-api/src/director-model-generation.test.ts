import { describe, expect, it, vi } from "vitest";
import {
  buildFalDirectorModelInput,
  generateFalDirectorModel,
} from "./director-model-generation.js";

describe("Director 3D model generation", () => {
  it("builds the documented Hunyuan3D V3 text-to-3D request", () => {
    expect(buildFalDirectorModelInput({
      prompt: "A production-ready chestnut horse with a leather saddle",
      quality: "low-poly",
      pbr: true,
      faceCount: 120_000,
    })).toEqual({
      prompt: "A production-ready chestnut horse with a leather saddle",
      enable_pbr: true,
      face_count: 120_000,
      generate_type: "LowPoly",
      polygon_type: "quadrilateral",
    });
  });

  it("submits, polls, downloads, and returns the generated GLB without exposing credentials", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fal-ai/hunyuan3d-v3/text-to-3d") && init?.method === "POST") {
        expect(init.headers).toMatchObject({ authorization: "Key secret-fal-key" });
        expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "A film prop horse" });
        return new Response(JSON.stringify({ request_id: "request-3d" }), { status: 200 });
      }
      if (url.endsWith("/requests/request-3d/status")) {
        return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      }
      if (url.endsWith("/requests/request-3d")) {
        return new Response(JSON.stringify({
          model_glb: {
            url: "https://v3b.fal.media/generated/model.glb",
            content_type: "model/gltf-binary",
            file_name: "model.glb",
          },
          thumbnail: { url: "https://v3b.fal.media/generated/preview.png" },
        }), { status: 200 });
      }
      if (url === "https://v3b.fal.media/generated/model.glb") {
        return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
          status: 200,
          headers: { "content-type": "model/gltf-binary" },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const generated = await generateFalDirectorModel({
      input: { prompt: "A film prop horse", quality: "normal", pbr: true },
      apiKey: "secret-fal-key",
      fetch: fetchMock as typeof fetch,
      pollIntervalMs: 0,
    });

    expect(generated).toMatchObject({
      contentType: "model/gltf-binary",
      fileName: "model.glb",
      requestId: "request-3d",
      provider: "fal",
      modelEndpoint: "fal-ai/hunyuan3d-v3/text-to-3d",
      remoteUrl: "https://v3b.fal.media/generated/model.glb",
      thumbnailUrl: "https://v3b.fal.media/generated/preview.png",
    });
    expect(Array.from(generated.bytes)).toEqual([0x67, 0x6c, 0x54, 0x46]);
    expect(JSON.stringify(generated)).not.toContain("secret-fal-key");
  });
});
