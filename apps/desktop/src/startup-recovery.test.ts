import { describe, expect, it, vi } from "vitest";
import { startDesktopWithRecovery } from "./startup-recovery";

describe("Desktop startup recovery", () => {
  it("retries the same startup workflow after a recoverable Host failure", async () => {
    const failure = new Error("Host did not become ready");
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const decide = vi.fn().mockResolvedValue("retry" as const);
    const quit = vi.fn();

    await expect(
      startDesktopWithRecovery({ start, decide, quit }),
    ).resolves.toBe("started");
    expect(start).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith(failure);
    expect(quit).not.toHaveBeenCalled();
  });

  it("quits cleanly when the user declines another startup attempt", async () => {
    const start = vi.fn().mockRejectedValue(new Error("missing runtime"));
    const decide = vi.fn().mockResolvedValue("quit" as const);
    const quit = vi.fn();

    await expect(
      startDesktopWithRecovery({ start, decide, quit }),
    ).resolves.toBe("quit");
    expect(start).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
