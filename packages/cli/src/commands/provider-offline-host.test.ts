import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");

/**
 * A stopped host is an ordinary situation, and it should read like one.
 *
 * Host discovery falls back to the cloud gateway's port when no local daemon is running, so the
 * request goes somewhere nothing is listening and `fetch` rejects. Unhandled, that surfaces as a
 * raw AggregateError with two ECONNREFUSED entries and a Node stack — which reads like the CLI
 * broke, when the answer is to start the host.
 *
 * Every other local command already says so. This one is new and did not.
 */
describe("connecting with no host running", () => {
  it("says the host is not running rather than printing a socket error", () => {
    expect(source).toMatch(/is not running|start(ing)? (the )?host|Is it running/i);
  });

  it("names the address it tried", () => {
    // Two of them exist -- a discovered local daemon and the cloud gateway default -- so which one
    // was attempted is the first thing worth knowing.
    expect(source).toMatch(/serverUrl|getServerUrl/);
  });
});
