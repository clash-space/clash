import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultClashHome,
  defaultLocalApiDataDir,
  resolveClashProfile,
} from "./local-paths.js";

describe("Clash runtime profiles", () => {
  it("keeps production backward compatible while isolating development state", () => {
    expect(resolveClashProfile({})).toBe("prod");
    expect(resolveClashProfile({ CLASH_PROFILE: "dev" })).toBe("dev");
    expect(defaultClashHome({ CLASH_PROFILE: "prod" })).toBe(join(homedir(), ".clash"));
    expect(defaultClashHome({ CLASH_PROFILE: "dev" })).toBe(
      join(homedir(), ".clash", "profiles", "dev"),
    );
    expect(defaultLocalApiDataDir({ CLASH_PROFILE: "dev" })).toBe(
      join(homedir(), ".clash", "profiles", "dev", "local-api"),
    );
  });

  it("treats an explicit CLASH_HOME as the exact profile home", () => {
    expect(defaultClashHome({
      CLASH_HOME: "/tmp/clash-explicit",
      CLASH_PROFILE: "dev",
    })).toBe("/tmp/clash-explicit");
  });

  it("rejects unknown profiles instead of silently crossing channels", () => {
    expect(() => resolveClashProfile({ CLASH_PROFILE: "staging" })).toThrow(
      "CLASH_PROFILE must be dev or prod",
    );
  });
});
