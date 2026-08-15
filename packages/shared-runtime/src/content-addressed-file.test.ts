import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { publishContentAddressedFile } from "./content-addressed-file";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("content-addressed file publication", () => {
  it("fails closed when concurrent different candidates both claim one identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "content-addressed-file-"));
    roots.push(root);
    const path = join(root, "objects", "claimed");
    const encoder = new TextEncoder();
    const outcomes = await Promise.allSettled([
      publishContentAddressedFile(path, encoder.encode("candidate-a"), {
        isValidForIdentity: () => true,
      }),
      publishContentAddressedFile(path, encoder.encode("candidate-b"), {
        isValidForIdentity: () => true,
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(["candidate-a", "candidate-b"]).toContain(
      await readFile(path, "utf8"),
    );
  });
});
