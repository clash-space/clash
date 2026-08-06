// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { VoiceInputSetupPopover } from "./VoiceInputSetupPopover";

afterEach(() => {
  cleanup();
});

describe("VoiceInputSetupPopover", () => {
  it("delegates trigger toggling and dismissal to the shared Radix popover", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <VoiceInputSetupPopover
          open
          onOpenChange={onOpenChange}
          notice={{
            message: "Enable voice input in Voice input settings first.",
            action: {
              label: "Open Voice input",
              href: "/settings?section=audio",
            },
          }}
          trigger={<button type="button">Voice</button>}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog", { name: "Voice input setup" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voice" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(
      <MemoryRouter>
        <VoiceInputSetupPopover
          open
          onOpenChange={onOpenChange}
          notice={{
            message: "Enable voice input in Voice input settings first.",
            action: {
              label: "Open Voice input",
              href: "/settings?section=audio",
            },
          }}
          trigger={<button type="button">Voice</button>}
        />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
