import { describe, expect, it } from "vitest";

import {
  withProjectSessionSearch,
  withoutInitialProjectPrompt,
} from "./projectSessionRoute";

describe("project session route", () => {
  it("records and clears the active Host session without losing other route state", () => {
    expect(
      withProjectSessionSearch("?prompt=hello&surface=canvas", "session-1"),
    ).toBe("?prompt=hello&surface=canvas&thread=session-1");
    expect(
      withProjectSessionSearch(
        "?prompt=hello&surface=canvas&thread=session-1",
        null,
      ),
    ).toBe("?prompt=hello&surface=canvas");
  });

  it("consumes only the landing prompt and preserves the active Host session", () => {
    expect(
      withoutInitialProjectPrompt(
        "?prompt=hello&thread=session-1&surface=canvas",
      ),
    ).toBe("?thread=session-1&surface=canvas");
  });
});
