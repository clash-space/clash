// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  dropdownMenuItemClassName,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

afterEach(() => {
  cleanup();
});

describe("transient popup primitives", () => {
  it("does not keep pointer hover paint after Radix leaves an item highlighted", () => {
    const itemClassName = dropdownMenuItemClassName();

    expect(itemClassName).toContain("hover:bg-warm-muted/75");
    expect(itemClassName).toContain("focus-visible:bg-warm-muted/75");
    expect(itemClassName).not.toContain("data-[highlighted]:bg-warm-muted/75");
  });

  it("toggles a dropdown from the same trigger and dismisses it with Escape", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Example menu">
          <DropdownMenuItem>First item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.getByRole("menu", { name: "Open menu" })).toBeTruthy();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menu", { name: "Open menu" })).toBeNull();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Open menu" })).toBeNull();
  });

  it("switches dropdown triggers in one pointer action", () => {
    render(
      <>
        <DropdownMenu>
          <DropdownMenuTrigger>First trigger</DropdownMenuTrigger>
          <DropdownMenuContent aria-label="First menu">
            <DropdownMenuItem>First item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger>Second trigger</DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Second menu">
            <DropdownMenuItem>Second item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "First trigger" }),
      { button: 0, ctrlKey: false },
    );
    expect(screen.getByRole("menu", { name: "First trigger" })).toBeTruthy();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Second trigger" }),
      { button: 0, ctrlKey: false },
    );
    expect(screen.queryByRole("menu", { name: "First trigger" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Second trigger" })).toBeTruthy();
  });

  it("keeps trigger focus when a dropdown is opened by pointer", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Pointer menu</DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Pointer menu">
          <DropdownMenuItem>First item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Pointer menu" });
    trigger.focus();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(screen.getByRole("menu", { name: "Pointer menu" })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it("toggles a popover and switches to another popover in one click", () => {
    render(
      <>
        <Popover>
          <PopoverTrigger>First popover</PopoverTrigger>
          <PopoverContent role="dialog" aria-label="First panel">
            First panel
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger>Second popover</PopoverTrigger>
          <PopoverContent role="dialog" aria-label="Second panel">
            Second panel
          </PopoverContent>
        </Popover>
      </>,
    );

    const firstTrigger = screen.getByRole("button", { name: "First popover" });
    fireEvent.click(firstTrigger);
    expect(screen.getByRole("dialog", { name: "First panel" })).toBeTruthy();

    fireEvent.click(firstTrigger);
    expect(screen.queryByRole("dialog", { name: "First panel" })).toBeNull();

    fireEvent.click(firstTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Second popover" }));
    expect(screen.queryByRole("dialog", { name: "First panel" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Second panel" })).toBeTruthy();
  });
});
