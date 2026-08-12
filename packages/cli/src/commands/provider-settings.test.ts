import { describe, expect, it } from "vitest";

import type { PluginAuthDeclaration } from "@clash/shared-types";

import { assertDeclaredSetting, declaredChoices } from "./provider-settings.js";

/**
 * A setting's allowed values come from the Provider that declared them.
 *
 * There were three answers to "what services does MiniMax have" in this repository at once: a table
 * in the CLI saying `global` and `cn`, a table in shared-types, and the Provider's own form saying
 * `international` and `domestic`. The CLI's copy is what `--service` validated against, so the two
 * spellings the Provider actually understands were both rejected.
 *
 * A declaration the host reads for rendering but not for validation is half a declaration. The same
 * form drives both, or they drift -- and they had.
 */
// One method, because these cases ask whether a key is declared at all -- which method declares it
// is the concern of the form that renders, not of `--set`.
const MINIMAX: PluginAuthDeclaration = {
  methods: [{
    id: "api-key",
    label: "API key",
    form: [
    { kind: "field", key: "apiKey", label: "API key", secret: true },
    {
      kind: "choice",
      key: "service",
      label: "Region",
      options: [
        { value: "international", label: "International" },
        { value: "domestic", label: "China" },
      ],
        default: "international",
      },
    ],
  }],
};

describe("declaredChoices", () => {
  it("reads the options a Provider declared for one key", () => {
    expect(declaredChoices(MINIMAX, "service")).toEqual(["international", "domestic"]);
  });

  it("answers nothing for a key that is not a choice", () => {
    // `apiKey` is free text. Offering "known values" for it would invent a menu the Provider never
    // declared.
    expect(declaredChoices(MINIMAX, "apiKey")).toBeUndefined();
  });

  it("answers nothing for a Provider that declares no auth", () => {
    expect(declaredChoices(undefined, "service")).toBeUndefined();
  });
});

describe("assertDeclaredSetting", () => {
  it("accepts a value the Provider offers", () => {
    expect(() => assertDeclaredSetting(MINIMAX, "service", "domestic")).not.toThrow();
  });

  it("lists what is on offer when the value is not", () => {
    // The old message named the CLI's own two values, so an operator reading it went looking for a
    // service the vendor does not have.
    expect(() => assertDeclaredSetting(MINIMAX, "service", "cn"))
      .toThrow(/international, domestic/);
  });

  it("says the Provider has no such setting rather than that it has one service", () => {
    // The previous wording -- "runs one service" -- was a claim about the vendor. What was actually
    // true was that this CLI had no row for it.
    expect(() => assertDeclaredSetting(MINIMAX, "region", "global"))
      .toThrow(/does not declare a region/i);
  });

  it("accepts an unset value, because a declared default covers it", () => {
    expect(() => assertDeclaredSetting(MINIMAX, "service", undefined)).not.toThrow();
  });

  it("refuses any value when the Provider declares no auth at all", () => {
    // Nothing to check against is not the same as anything goes: storing a setting no Provider reads
    // leaves the operator believing they configured something.
    expect(() => assertDeclaredSetting(undefined, "service", "international"))
      .toThrow(/does not declare/i);
  });
});

/**
 * The CLI enumerates no vendor fields.
 *
 * `--api-key`, `--service` and `--region` were three flags naming three things a vendor happens to
 * want, each with its own host-side notion of what values are legal. Adding a Provider that wants an
 * access key and a secret meant adding flags; adding one that wants a region spelled differently
 * meant editing a table. The disease is the same in all three, and fixing `--service` alone left it.
 *
 * `--set key=value` is the whole surface. Which keys exist, which values they accept, and which are
 * required all come from the Provider's declaration -- the same declaration the settings screen
 * renders.
 */
describe("settings from a declaration", () => {
  const GOOGLE: PluginAuthDeclaration = {
    methods: [{
      id: "ai-studio",
      label: "AI Studio",
      form: [
      {
        kind: "choice",
        key: "service",
        label: "Service",
        options: [
          { value: "ai-studio", label: "AI Studio" },
          { value: "agent-platform", label: "Agent Platform" },
        ],
        default: "ai-studio",
      },
      { kind: "field", key: "apiKey", label: "API key", secret: true, default: "" },
        { kind: "field", key: "serviceAccountKey", label: "Service account JSON", secret: true, default: "" },
      ],
    }],
  };

  it("accepts any key the Provider declared, whatever it is called", () => {
    for (const [key, value] of [["service", "agent-platform"], ["apiKey", "AIza"], ["serviceAccountKey", "{}"]]) {
      expect(() => assertDeclaredSetting(GOOGLE, key!, value!), key).not.toThrow();
    }
  });

  it("refuses a key the Provider never declared", () => {
    // Storing it would leave the operator believing they configured something no Provider reads.
    expect(() => assertDeclaredSetting(GOOGLE, "region", "us-central1"))
      .toThrow(/does not declare a region/i);
  });

  it("validates a choice but not a free-text field", () => {
    expect(() => assertDeclaredSetting(GOOGLE, "service", "vertex")).toThrow(/ai-studio, agent-platform/);
    // An api key has no menu, and inventing one would reject valid keys.
    expect(() => assertDeclaredSetting(GOOGLE, "apiKey", "anything-at-all")).not.toThrow();
  });
});
