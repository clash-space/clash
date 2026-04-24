import { describe, expect, it, vi } from "vitest";

import { uploadBytes } from "./r2";

describe("uploadBytes", () => {
  it("uses audio file extensions for audio content types", async () => {
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;

    const wavKey = await uploadBytes(bucket, new Uint8Array([1]), "proj-1", "task-wav", "audio/wav");
    const mp3Key = await uploadBytes(bucket, new Uint8Array([2]), "proj-1", "task-mp3", "audio/mpeg");

    expect(wavKey).toBe("projects/proj-1/assets/task-wav.wav");
    expect(mp3Key).toBe("projects/proj-1/assets/task-mp3.mp3");
    expect(bucket.put).toHaveBeenNthCalledWith(
      1,
      "projects/proj-1/assets/task-wav.wav",
      expect.any(Uint8Array),
      { httpMetadata: { contentType: "audio/wav" } },
    );
    expect(bucket.put).toHaveBeenNthCalledWith(
      2,
      "projects/proj-1/assets/task-mp3.mp3",
      expect.any(Uint8Array),
      { httpMetadata: { contentType: "audio/mpeg" } },
    );
  });
});
