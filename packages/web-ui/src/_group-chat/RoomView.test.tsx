// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoomView } from "./RoomView";

describe("RoomView", () => {
  it("keeps cloud sync status out of the message scroll layer", () => {
    render(
      <RoomView
        messages={[
          {
            id: "message-1",
            type: "room.message",
            project_id: "project-1",
            sender_kind: "user",
            sender_id: "local-user",
            sender_user_id: "local-user",
            mentions: [],
            text: "hello room",
            at: 1,
          },
        ]}
        userId="local-user"
        labelFor={(id) => id}
        empty={false}
        hasInvited
        sync={{
          mode: "cloud-sync",
          remote_room: { enabled: true, status: "mirrored" },
        }}
      />,
    );

    const log = screen.getByRole("log", { name: "Room messages" });
    expect(within(log).queryByText("Cloud synced")).toBeNull();
    expect(within(log).getByText("hello room")).toBeTruthy();
  });
});
