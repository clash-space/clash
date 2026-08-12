import { describe, expect, it, vi } from "vitest";

import { createNpxSkillsMarketplace } from "./marketplace-skills.js";

const registry = {
  skills: [
    {
      id: "clash.video.sd25-pe",
      name: "sd25-pe",
      title: "Seedance 2.5 Prompt Engineering",
      description: "Official Seedance 2.5 prompt-engineering guidance.",
      source: "provider-official",
      sourceVersion: "0.1.1",
      install: {
        kind: "npx-skills",
        source: "https://arkdocs.tos-cn-beijing.volces.com/skills/",
        skill: "sd25-pe",
        scope: "global",
      },
    },
    {
      id: "clash.video.bundled",
      name: "bundled",
      source: "first-party",
      path: "skills/bundled",
    },
  ],
};

describe("npx skills marketplace", () => {
  it("lists only registry skills backed by the supported lazy installer", () => {
    const marketplace = createNpxSkillsMarketplace({ registry, run: vi.fn() });

    expect(marketplace.skills).toEqual([
      expect.objectContaining({
        id: "clash.video.sd25-pe",
        name: "sd25-pe",
        type: "skill",
        install: registry.skills[0]?.install,
      }),
    ]);
  });

  it("maps the machine-readable global skills list back to registry ids", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        { name: "sd25-pe", path: "/Users/test/.agents/skills/sd25-pe", scope: "global" },
        { name: "unrelated", path: "/Users/test/.agents/skills/unrelated", scope: "global" },
      ]),
    });
    const marketplace = createNpxSkillsMarketplace({ registry, run });

    await expect(marketplace.listInstalled()).resolves.toEqual([
      expect.objectContaining({
        skillId: "clash.video.sd25-pe",
        name: "sd25-pe",
        path: "/Users/test/.agents/skills/sd25-pe",
      }),
    ]);
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/^npx(?:\.cmd)?$/),
      ["--yes", "skills@latest", "list", "--global", "--json"],
    );
  });

  it("installs a selected registry skill from its fixed official source", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    const marketplace = createNpxSkillsMarketplace({ registry, run });

    await expect(marketplace.install("clash.video.sd25-pe")).resolves.toMatchObject({
      skillId: "clash.video.sd25-pe",
      installed: true,
    });
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/^npx(?:\.cmd)?$/),
      [
        "--yes",
        "skills@latest",
        "add",
        "https://arkdocs.tos-cn-beijing.volces.com/skills/",
        "--skill",
        "sd25-pe",
        "--global",
        "--yes",
      ],
    );
  });

  it("uninstalls only the fixed skill name belonging to the selected registry id", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    const marketplace = createNpxSkillsMarketplace({ registry, run });

    await marketplace.uninstall("clash.video.sd25-pe");

    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/^npx(?:\.cmd)?$/),
      ["--yes", "skills@latest", "remove", "sd25-pe", "--global", "--yes"],
    );
  });

  it("rejects ids that are not in the trusted registry", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    const marketplace = createNpxSkillsMarketplace({ registry, run });

    await expect(marketplace.install("https://evil.example/skill"))
      .rejects.toThrow(/unknown marketplace skill/i);
    expect(run).not.toHaveBeenCalled();
  });
});
