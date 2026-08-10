import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { writePluginHostResponse } from "./plugin-host-ipc";

/**
 * Writing a response must not kill the host.
 *
 * Every reply used a bare `socket.end()`, so a connection that produced two replies -- two
 * requests pipelined, or an oversize frame followed by anything -- wrote to a socket that
 * was already finished. The rejection escaped an unguarded `.then()` and took the whole
 * process with it, which silently abandoned queued generations:
 *
 *   Error [ERR_STREAM_WRITE_AFTER_END]: write after end
 *     at writeResponse (local-api.cjs:67276)
 *
 * A response that cannot be delivered is the client's problem, never the host's.
 */
describe("plugin host response writes survive a closed socket", () => {
  function fakeSocket(overrides: Partial<{ writableEnded: boolean; destroyed: boolean }> = {}) {
    const socket = new EventEmitter() as EventEmitter & {
      end: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
    };
    socket.end = vi.fn();
    socket.write = vi.fn();
    socket.writableEnded = overrides.writableEnded ?? false;
    socket.destroyed = overrides.destroyed ?? false;
    return socket;
  }

  const response = {
    protocol: "clash.plugin-host/v1" as const,
    requestId: "req-1",
    status: "ok" as const,
    result: [],
  };

  it("writes the first response", () => {
    const socket = fakeSocket();
    writePluginHostResponse(socket as never, response);
    expect(socket.end).toHaveBeenCalledOnce();
    expect(String(socket.end.mock.calls[0][0])).toContain("req-1");
  });

  it("skips a socket that has already been ended", () => {
    const socket = fakeSocket({ writableEnded: true });
    expect(() => writePluginHostResponse(socket as never, response)).not.toThrow();
    expect(socket.end).not.toHaveBeenCalled();
  });

  it("skips a destroyed socket", () => {
    const socket = fakeSocket({ destroyed: true });
    expect(() => writePluginHostResponse(socket as never, response)).not.toThrow();
    expect(socket.end).not.toHaveBeenCalled();
  });

  it("swallows a synchronous write failure instead of propagating it", () => {
    const socket = fakeSocket();
    socket.end.mockImplementation(() => {
      throw Object.assign(new Error("write after end"), { code: "ERR_STREAM_WRITE_AFTER_END" });
    });
    expect(() => writePluginHostResponse(socket as never, response)).not.toThrow();
  });
});
