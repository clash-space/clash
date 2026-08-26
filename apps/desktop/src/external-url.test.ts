import { describe, expect, it, vi } from "vitest";

describe("desktop external URL boundary", () => {
  it("opens normalized HTTP URLs through the injected system opener", async () => {
    const module = await import("./external-url").catch(() => null);
    const opener = vi.fn(async () => undefined);
    expect(module).not.toBeNull();
    if (!module) return;

    await expect(module.openExternalHttpUrl(
      "https://github.com/login/oauth/authorize?client_id=clash",
      opener,
    )).resolves.toBeUndefined();
    expect(opener).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize?client_id=clash",
    );
  });

  it("rejects non-web protocols without calling the system opener", async () => {
    const module = await import("./external-url").catch(() => null);
    const opener = vi.fn(async () => undefined);
    expect(module).not.toBeNull();
    if (!module) return;

    await expect(module.openExternalHttpUrl("javascript:alert(1)", opener)).rejects.toThrow(
      "Only HTTP and HTTPS URLs can be opened",
    );
    expect(opener).not.toHaveBeenCalled();
  });
});
