import { afterEach, describe, expect, it, vi } from "vitest";

import {
  marketplaceInstallPlugin,
  marketplaceInstallSkill,
  marketplaceUninstallSkill,
  type RegistryItem,
} from "./clientActions.js";

const skill: RegistryItem = {
  id: "clash.video.sd25-pe",
  name: "sd25-pe",
  type: "skill",
};

describe("marketplace skill actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks local-api to install a trusted registry id instead of posting a skill definition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ installed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await marketplaceInstallSkill(skill);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/marketplace/skills/clash.video.sd25-pe/install",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("asks local-api to uninstall the same trusted registry id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await marketplaceUninstallSkill(skill.id);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/marketplace/skills/clash.video.sd25-pe/install",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("asks local-api to install an official executable plugin by package id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ installed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await marketplaceInstallPlugin({
      id: "clash.storyboard",
      packageId: "clash.storyboard",
      name: "Storyboard",
      type: "plugin",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/marketplace/plugins/clash.storyboard/install",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
