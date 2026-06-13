import { describe, expect, it } from "vitest";
import type { PresenceClient } from "@clash/shared-types";
import { visiblePresenceClients } from "./presenceVisibility";

describe("visiblePresenceClients", () => {
  it("hides the current browser user but keeps that user's local agent visible", () => {
    const clients: PresenceClient[] = [
      {
        id: "browser-self",
        clientType: "browser",
        userId: "local-user",
        name: "Local User",
      },
      {
        id: "agent-self",
        clientType: "agent",
        userId: "local-user",
        name: "Mock ACP",
      },
      {
        id: "remote-browser",
        clientType: "browser",
        userId: "remote-user",
        name: "Remote User",
      },
    ];

    expect(visiblePresenceClients(clients, "local-user")).toEqual([
      expect.objectContaining({ id: "agent-self", clientType: "agent", userId: "local-user" }),
      expect.objectContaining({ id: "remote-browser", clientType: "browser", userId: "remote-user" }),
    ]);
  });
});
