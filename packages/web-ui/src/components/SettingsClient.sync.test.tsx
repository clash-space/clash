// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsClient from "./SettingsClient";

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: () => ({
    runtimes: [],
    refresh: vi.fn(),
  }),
}));

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  setVariable: vi.fn(),
  deleteVariable: vi.fn(),
  uninstallAction: vi.fn(),
  uninstallSkill: vi.fn(),
  listModelCatalog: vi.fn(),
  updateModelProviders: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, whileTap: _whileTap, initial: _initial, animate: _animate, exit: _exit, ...props }: any) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

describe("SettingsClient sync section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads and saves local sync configuration", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/sync") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          mode: "local-only",
          remote_loro: {
            enabled: false,
            url: null,
            has_token: false,
            source: "none",
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/sync") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          mode: "cloud-sync",
          remote_loro_url: "https://cloud.example",
          remote_loro_token: "secret",
        });
        return new Response(JSON.stringify({
          mode: "cloud-sync",
          remote_loro: {
            enabled: true,
            url: "https://cloud.example",
            has_token: true,
            source: "config",
          },
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="sync"
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByText("Local only");
    fireEvent.click(screen.getByRole("radio", { name: /Cloud sync/ }));
    fireEvent.change(screen.getByLabelText("Remote Loro URL"), {
      target: { value: "https://cloud.example" },
    });
    fireEvent.change(screen.getByLabelText("Remote Loro token"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sync settings" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Token saved").length).toBeGreaterThan(0);
    expect(screen.getByText("Sync settings saved.")).toBeTruthy();
  });
});

describe("SettingsClient provider keys", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows provider key presets in Variables and fills the key input", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="variables"
          embedded
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "fal.ai · FAL_API_KEY" }));

    expect((screen.getByPlaceholderText("KEY_NAME") as HTMLInputElement).value).toBe("FAL_API_KEY");
    expect(screen.getByRole("button", { name: "Replicate · REPLICATE_API_TOKEN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OpenAI · OPENAI_API_KEY" })).toBeTruthy();
  });

  it("does not show provider key presets in API Tokens", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="tokens"
          embedded
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("fal.ai · FAL_API_KEY")).toBeNull();
  });
});

describe("SettingsClient model routing", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows provider routing and saves account weights", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([
      {
        model: {
          id: "nano-banana-2",
          name: "Nano Banana 2",
          kind: "image",
        },
        tier: "available",
        selectedRoute: {
          modelCode: "nano-banana-2",
          kind: "image",
          providerId: "fal",
          upstreamId: "fal",
          upstreamModel: "fal-ai/nano-banana-2",
          apiShape: "fal",
          priority: 20,
        },
        routes: [],
        candidateProviders: ["fal"],
        missingVariables: [],
      },
    ]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              providerId: "fal",
              upstreamId: "fal",
              enabled: true,
              availableVariables: ["FAL_API_KEY"],
              weight: 75,
            },
          ]}
          initialModelCatalog={[
            {
              model: {
                id: "nano-banana-2",
                name: "Nano Banana 2",
                kind: "image",
              },
              tier: "available",
              selectedRoute: {
                modelCode: "nano-banana-2",
                kind: "image",
                providerId: "fal",
                upstreamId: "fal",
                upstreamModel: "fal-ai/nano-banana-2",
                apiShape: "fal",
                priority: 20,
              },
              routes: [],
              candidateProviders: ["fal"],
              missingVariables: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Provider routing")).toBeTruthy();
    expect(screen.getAllByText("fal/fal").length).toBeGreaterThan(0);
    expect(screen.getByText("Nano Banana 2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Weight for fal/fal"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save routing" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: "fal",
            upstreamId: "fal",
            enabled: true,
            weight: 90,
          }),
        ]),
      );
    });
  });
});
