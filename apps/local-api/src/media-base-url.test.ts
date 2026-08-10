import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveMediaBaseUrl } from "./media-base-url";

/**
 * The media base URL must name the port the host actually listened on.
 *
 * `port: 0` asks the OS to pick one, which is how the plugin runtime starts the host. The
 * base URL was built from the requested port, so it froze as `http://127.0.0.1:0` before
 * the real port was known. Text-to-image never noticed, because nothing fetches an asset
 * back. A reference did: inlining it produced a bare `fetch failed` with a reachable
 * upstream and no clue that the URL was unroutable.
 */
describe("media base URL follows the bound port", () => {
  it("uses the bound port rather than the requested one", () => {
    const resolve = resolveMediaBaseUrl(() => 56242);
    expect(resolve()).toBe("http://127.0.0.1:56242");
  });

  it("never hands out port 0", () => {
    let bound: number | undefined;
    const resolve = resolveMediaBaseUrl(() => bound);
    expect(() => resolve()).toThrow(/not listening/i);
    bound = 56242;
    expect(resolve()).toBe("http://127.0.0.1:56242");
  });

  it("reflects a port assigned after the URL was requested", () => {
    // The consumer holds the resolver, not a string, so a late bind is still visible.
    let bound = 1111;
    const resolve = resolveMediaBaseUrl(() => bound);
    expect(resolve()).toBe("http://127.0.0.1:1111");
    bound = 2222;
    expect(resolve()).toBe("http://127.0.0.1:2222");
  });

  it("is wired into the server from the bound port, not the requested one", () => {
    // Testing the resolver alone would pass while the server still interpolated
    // `options.port`, which is exactly how `http://127.0.0.1:0` shipped.
    const server = readFileSync(join(__dirname, "server.ts"), "utf8");
    expect(server).toContain("resolveMediaBaseUrl(() => boundPort)");
    expect(server).toContain("boundPort = info.port;");
    expect(server).not.toContain("mediaBaseUrl: `http://127.0.0.1:${options.port}`");
  });
});
