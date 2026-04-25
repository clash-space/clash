import { describe, expect, it } from "vitest";

import {
  getEffectiveChromeAuth,
  shouldProbeSessionForChrome,
} from "./authChrome";

describe("auth chrome helpers", () => {
  it("probes session only for the homepage when the layout loader is unauthenticated", () => {
    expect(shouldProbeSessionForChrome("/", false)).toBe(true);
    expect(shouldProbeSessionForChrome("/", true)).toBe(false);
    expect(shouldProbeSessionForChrome("/login", false)).toBe(false);
  });

  it("keeps dashboard chrome visible when a client probe confirms auth", () => {
    expect(getEffectiveChromeAuth(false, true)).toBe(true);
    expect(getEffectiveChromeAuth(false, false)).toBe(false);
    expect(getEffectiveChromeAuth(true, false)).toBe(true);
  });
});
