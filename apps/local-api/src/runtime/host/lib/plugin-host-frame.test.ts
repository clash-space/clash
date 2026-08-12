import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { requestIdFromPartialFrame } from "./plugin-host-ipc";

/**
 * An oversize request must fail as itself, not as somebody else's reply.
 *
 * The size guard answered with `requestId: "unknown"`, and the client compares ids, so a
 * request larger than the frame limit surfaced as a protocol violation instead of a size
 * problem:
 *
 *   Clash plugin host returned a mismatched response.
 *
 * The real cause was two reference images, 2.26 MB and 2.64 MB once base64-encoded, against
 * a 4 MB frame. Recovering the id from the partial frame lets the error reach the caller
 * that caused it.
 */
describe("the size guard names the request it rejects", () => {
  it("recovers the id from a frame that is still incomplete", () => {
    const partial = '{"protocol":"clash.plugin-host/v1","requestId":"req-42","operation":"invoke","invocation":{"values":{"image":"AAAA';
    expect(requestIdFromPartialFrame(partial)).toBe("req-42");
  });

  it("tolerates whitespace and key order", () => {
    expect(requestIdFromPartialFrame('{ "operation" : "invoke" , "requestId" : "req-7" , "x": 1')).toBe("req-7");
  });

  it("falls back to unknown when no id has arrived yet", () => {
    expect(requestIdFromPartialFrame('{"protocol":"clash.plugin-host/v1","oper')).toBe("unknown");
  });
});

describe("the frame carries whatever a plugin returns", () => {
  it("does not hold media to a size chosen before any media existed", () => {
    // This used to assert the opposite: that the frame limit must stay small, because media belongs
    // in `clash-asset://` handles rather than in the frame.
    //
    // That route was never built. `clash-plugin-output://` appears in the schema and in one schema
    // test, with no producer and no resolver; `asset.write` with a url is answered by the host with
    // "Local asset.write currently requires inline dataBase64". Inline was the only way media could
    // travel, held to 8 MB -- and one 30-second video from Gemini Omni is 3,470,456 characters of
    // base64.
    const source = readFileSync(join(__dirname, "plugin-host-ipc.ts"), "utf8");
    expect(source).not.toMatch(/MAX_MESSAGE_BYTES/);
  });
});
