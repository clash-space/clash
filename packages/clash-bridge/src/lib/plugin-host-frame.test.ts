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

describe("the frame carries control information, not media", () => {
  it("keeps the limit small enough that media cannot be meant to fit", () => {
    // A Card may accept a 30 MB reference and several of them. If the frame were sized to
    // hold them it would have to be ~100 MB, which is the signal that media does not belong
    // in the frame at all: references travel as `clash-asset://` handles.
    const source = readFileSync(join(__dirname, "plugin-host-ipc.ts"), "utf8");
    const declared = /MAX_MESSAGE_BYTES = (\d+) \* 1024 \* 1024/.exec(source);
    expect(declared, "the limit must be stated in MB").not.toBeNull();
    const megabytes = Number(declared![1]);
    const oneEncodedReference = Math.ceil(30 * (4 / 3));
    expect(megabytes).toBeLessThan(oneEncodedReference);
  });
});
