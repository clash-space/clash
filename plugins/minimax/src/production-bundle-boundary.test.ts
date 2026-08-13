import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { sourceMatches } from "@clash/gui/test-support/source-match";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MiniMax production bundle boundary", () => {
  it("keeps the collaboration engine outside the provider bundle", async () => {
    const bundle = await readFile(
      join(import.meta.dirname, "..", "dist", "stdio.mjs"),
      "utf8",
    );

    expect(sourceMatches(bundle, /loro-crdt|loro_wasm/u)).toBe(false);
  });

  it("loads as a self-contained Node ESM module after installation", async () => {
    const isolatedDirectory = await mkdtemp(
      join(tmpdir(), "clash-minimax-bundle-"),
    );
    temporaryDirectories.push(isolatedDirectory);
    const installedDist = join(isolatedDirectory, "dist");
    await mkdir(installedDist);
    const installedEntrypoint = join(installedDist, "stdio.mjs");
    await copyFile(
      join(import.meta.dirname, "..", "dist", "stdio.mjs"),
      installedEntrypoint,
    );
    await copyFile(
      join(import.meta.dirname, "..", "manifest.json"),
      join(isolatedDirectory, "manifest.json"),
    );

    const loaded = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(pathToFileURL(installedEntrypoint).href)})`,
      ],
      { encoding: "utf8" },
    );

    expect({
      status: loaded.status,
      signal: loaded.signal,
      stderr: loaded.stderr,
    }).toEqual({ status: 0, signal: null, stderr: "" });
  });
});
