import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveLocalMediaBinary,
  selectLocalMediaBinary,
} from "./local-media-binaries.js";

describe("Local media binary discovery", () => {
  it("prefers an explicit executable override to the packaged binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-media-binary-"));
    try {
      const override = join(directory, "override-ffmpeg");
      const packaged = join(directory, "packaged-ffmpeg");
      await Promise.all([
        writeFile(override, "override"),
        writeFile(packaged, "packaged"),
      ]);
      await Promise.all([chmod(override, 0o755), chmod(packaged, 0o755)]);

      expect(
        selectLocalMediaBinary({
          tool: "ffmpeg",
          env: { FFMPEG_PATH: override },
          packagedPath: packaged,
          systemPaths: [],
          platform: process.platform,
        }),
      ).toBe(override);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the packaged executable when no override is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-media-package-"));
    try {
      const packaged = join(directory, "ffprobe");
      await writeFile(packaged, "packaged");
      await chmod(packaged, 0o755);

      expect(
        selectLocalMediaBinary({
          tool: "ffprobe",
          env: {},
          packagedPath: packaged,
          systemPaths: [],
          platform: process.platform,
        }),
      ).toBe(packaged);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses ffprobe beside an explicitly selected ffmpeg before the package", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-media-sibling-"));
    try {
      const ffmpeg = join(directory, "ffmpeg");
      const ffprobe = join(directory, "ffprobe");
      const packaged = join(directory, "packaged-ffprobe");
      await Promise.all([
        writeFile(ffmpeg, "ffmpeg"),
        writeFile(ffprobe, "ffprobe"),
        writeFile(packaged, "packaged"),
      ]);
      await Promise.all([
        chmod(ffmpeg, 0o755),
        chmod(ffprobe, 0o755),
        chmod(packaged, 0o755),
      ]);

      expect(
        resolveLocalMediaBinary("ffprobe", {
          env: { FFMPEG_PATH: ffmpeg },
          systemPaths: [],
          loadPackage: () => ({ path: packaged }),
        }),
      ).toBe(ffprobe);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not select a binary trapped inside an Electron ASAR archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-media-asar-"));
    try {
      const archiveDirectory = join(directory, "app.asar", "bin");
      const archived = join(archiveDirectory, "ffmpeg");
      await mkdir(archiveDirectory, { recursive: true });
      await writeFile(archived, "archived");
      await chmod(archived, 0o755);

      expect(
        selectLocalMediaBinary({
          tool: "ffmpeg",
          env: {},
          packagedPath: archived,
          systemPaths: [],
          platform: process.platform,
        }),
      ).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves the platform package used by a packaged Local Host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-media-resolve-"));
    try {
      const packaged = join(directory, "ffprobe");
      await writeFile(packaged, "packaged");
      await chmod(packaged, 0o755);
      expect(
        resolveLocalMediaBinary("ffprobe", {
          env: {},
          systemPaths: [],
          loadPackage: (name) =>
            name === "@ffprobe-installer/ffprobe" ? { path: packaged } : null,
        }),
      ).toBe(packaged);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("carries an executable ffmpeg in the Local API production dependency graph", () => {
    expect(
      resolveLocalMediaBinary("ffmpeg", {
        env: {},
        systemPaths: [],
      }),
    ).toMatch(/ffmpeg(?:\.exe)?$/);
  });

  it("carries an executable ffprobe in the Local API production dependency graph", () => {
    expect(
      resolveLocalMediaBinary("ffprobe", {
        env: {},
        systemPaths: [],
      }),
    ).toMatch(/ffprobe(?:\.exe)?$/);
  });
});
