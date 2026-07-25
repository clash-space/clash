// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalAssetsClient from "./GlobalAssetsClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GlobalAssetsClient", () => {
  it("uploads a local file into the global library without requiring a project", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ storageKey: "uploads/hero.png" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "asset-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "asset-1",
        kind: "image",
        srcR2Key: "uploads/hero.png",
        signedUrl: "/assets/uploads/hero.png",
        createdAt: 1,
      }), { status: 200 }));

    render(<GlobalAssetsClient initialAssets={[]} />);
    const input = screen.getByLabelText("Upload global assets") as HTMLInputElement;
    const file = new File(["image"], "hero.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("hero.png")).toBeTruthy());
    const registerBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(registerBody).toMatchObject({
      addToLibrary: true,
      kind: "image",
      srcR2Key: "uploads/hero.png",
    });
    expect(registerBody).not.toHaveProperty("projectId");
  });
});
