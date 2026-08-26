import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeFetch: vi.fn(),
}));

vi.mock("@clash/web-ui/components/ProjectEditor", () => ({
  default: () => null,
}));
vi.mock("@clash/web-ui/lib/runtimeConfig", () => ({
  runtimeFetch: mocks.runtimeFetch,
}));

import { ErrorBoundary, loader } from "./project.$id";

afterEach(() => {
  mocks.runtimeFetch.mockReset();
  vi.unstubAllGlobals();
});

describe("project loader connection state", () => {
  it("keeps project loader failures inside the project route so Desktop chrome remains visible", () => {
    expect(ErrorBoundary).toEqual(expect.any(Function));
  });

  it("marks the owning Desktop tab disconnected when the Host cannot be reached", async () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal("window", windowTarget);
    mocks.runtimeFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const connectionEvents: unknown[] = [];
    windowTarget.addEventListener("clash:desktop-tab-connection", (event) => {
      connectionEvents.push((event as CustomEvent).detail);
    });

    await expect(
      loader({ params: { id: "project-1" } } as never),
    ).rejects.toThrow("Failed to fetch");

    expect(connectionEvents).toContainEqual({
      path: "/projects/project-1",
      connection: "disconnected",
    });
  });
});
