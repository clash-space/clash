import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createDesktopLogger } from "./stdio-logger";

function fakeStream(write: (chunk: string) => boolean = () => true) {
  const emitter = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn> };
  emitter.write = vi.fn(write);
  return emitter as NodeJS.WritableStream & { write: ReturnType<typeof vi.fn> };
}

function epipe(): Error & { code: string } {
  return Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
}

describe("desktop stdio logger", () => {
  it("formats successful stdout writes", () => {
    const stdout = fakeStream();
    const logger = createDesktopLogger(stdout, fakeStream());

    logger.info("hello %s", "desktop");

    expect(stdout.write).toHaveBeenCalledWith("hello desktop\n");
  });

  it("drops future stdout logs after a synchronous EPIPE", () => {
    const stdout = fakeStream(() => {
      throw epipe();
    });
    const logger = createDesktopLogger(stdout, fakeStream());

    expect(() => logger.info("first")).not.toThrow();
    expect(() => logger.info("second")).not.toThrow();

    expect(stdout.write).toHaveBeenCalledTimes(1);
  });

  it("drops future stderr logs after an asynchronous EPIPE", () => {
    const stderr = fakeStream();
    const logger = createDesktopLogger(fakeStream(), stderr);

    stderr.emit("error", epipe());
    expect(() => logger.error("after close")).not.toThrow();

    expect(stderr.write).not.toHaveBeenCalled();
  });
});
