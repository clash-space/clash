import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "plugin-host-ipc.ts"), "utf8");

/**
 * No invented ceiling. The runtime already has one.
 *
 * There were two numbers and they disagreed: `asset.write` accepted base64 up to 128 MB, the frame
 * carrying it stopped at 8 MB, so the larger was unreachable and the smaller was the real answer.
 * Neither was measured against anything — one 30-second video from Gemini Omni is 3,470,456
 * characters of base64, 43% of the frame limit, and length and resolution scale from there.
 *
 * The frame is accumulated with `buffer += chunk.toString("utf8")`, so the true ceiling is what a
 * JavaScript string can hold: 536,870,888 characters on Node 24, twenty-four bytes short of 512 MB.
 * That limit is real, enforced by V8, and cannot be configured away. A second, smaller, invented
 * limit in front of it only refuses work earlier for a reason nobody chose.
 *
 */
describe("plugin frame size", () => {
  it("does not invent a byte ceiling", () => {
    expect(source).not.toMatch(/MAX_MESSAGE_BYTES/);
  });
});
