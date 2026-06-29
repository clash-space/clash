import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: mocks.spawn,
}));

function withPlatform(value: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value });
  return () => {
    if (descriptor) Object.defineProperty(process, "platform", descriptor);
  };
}

describe("launchInteractiveAuthCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.spawn.mockReset();
  });

  it("opens macOS Terminal without waiting for the terminal command to finish", async () => {
    const restorePlatform = withPlatform("darwin");
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);
    const { launchInteractiveAuthCommand } = await import("./local-acp");

    try {
      const launched = launchInteractiveAuthCommand({
        label: "Qwen Code setup",
        command: "/tmp/qwen",
        args: ["--auth-type=openai"],
        cwd: "/tmp/project",
      });

      expect(mocks.spawn).toHaveBeenCalledWith(
        "osascript",
        expect.arrayContaining([
          "-e",
          "activate",
        ]),
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
        }),
      );

      child.emit("spawn");

      await expect(launched).resolves.toBeUndefined();
      expect(child.unref).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});
