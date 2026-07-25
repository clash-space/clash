import { describe, expect, it } from "vitest";
import { safeDirectorVideoExportName } from "./director-video-export";

describe("desktop Director camera video export", () => {
  it("creates a safe WebM filename from the Stage and camera names", () => {
    expect(safeDirectorVideoExportName("  Lobby / Blocking  ", "Camera #2")).toBe(
      "Lobby-Blocking-Camera-2.webm",
    );
    expect(safeDirectorVideoExportName("***", "***")).toBe("director-camera.webm");
  });
});
