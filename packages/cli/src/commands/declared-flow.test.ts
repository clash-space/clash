import { describe, expect, it } from "vitest";

import { authFormControls, missingAuthKeys } from "@clash/shared-types";

/**
 * The CLI drives the declaration through the same reader the settings screen uses.
 *
 * `providers add` accepted `--set key=value` and nothing else, so a Provider whose declaration is a
 * browser flow could not be connected at all: hrhrng.hub declares `flow.open` and a
 * `minimax-hub://` callback, and the only way in was to already hold a token and paste it.
 *
 * The fix is not a CLI-side reader. The CLI is another rendering of the same form, so it calls
 * `authFormControls` -- the function the GUI calls -- and turns controls into prompts instead of
 * inputs. A second reader is what produced the deleted `SERVICES` table, which claimed MiniMax ran
 * `global`/`cn` while the Provider declared `international`/`domestic`, rejecting both values it
 * understood.
 */
// `methods`: each a whole way in, with its own fields and its own flow. hub really does declare
// three, and the button belongs to the one that opens a browser -- a Provider-level form would
// offer a "Sign in" button to someone who chose to paste a token.
const hub = {
  methods: [{
    id: "sign-in",
    label: "Sign in",
    form: [
      { kind: "button", key: "signIn", label: "Sign in to MiniMax Hub" },
      { kind: "notice", text: "Or paste a token you already hold." },
      { kind: "field", key: "accessToken", label: "Access token", secret: true, default: "" },
    ],
    flow: {
      open: "https://hub.minimax.io/login?device_id=clash-desktop",
      callback: { type: "scheme", scheme: "minimax-hub" },
    },
  }],
} as never;

const google = {
  methods: [{
    id: "ai-studio",
    label: "AI Studio",
    form: [
      { kind: "choice", key: "service", label: "Service", options: [{ value: "ai-studio", label: "AI Studio" }], default: "ai-studio" },
      { kind: "field", key: "apiKey", label: "API key", secret: true, default: "" },
    ],
  }],
} as never;

describe("the CLI reads the declared form", () => {
  it("sees the button a browser flow hangs off", () => {
    const controls = authFormControls(hub, {}, "sign-in");
    expect(controls.some((control) => control.control === "button")).toBe(true);
  });

  it("draws no button for a Provider that declares no flow", () => {
    // clash.google dropped its browser flow: Google's OAuth needs a published, verified app, and a
    // service account has no such gate. Offering to sign in would open a page that refuses.
    expect(authFormControls(google, {}, "ai-studio").some((control) => control.control === "button")).toBe(false);
  });

  it("does not call the token missing, because the button can supply it", () => {
    // `accessToken` declares `default: ""`, and a declared default means not required. That reads
    // oddly until you see the button beside it: the two are alternatives, and the field is optional
    // precisely because signing in fills it.
    //
    // So `missingAuthKeys` cannot tell the CLI whether this account is usable -- an empty token
    // with no sign-in is unusable, and the declaration has no way to say "one of these two". Left
    // as it is rather than papered over: the CLI decides from the stored value, and the gap in the
    // declaration vocabulary is recorded here rather than hidden behind a special case.
    expect(missingAuthKeys(hub, {}, "sign-in")).toEqual([]);
    expect(missingAuthKeys(hub, { accessToken: "t-1" }, "sign-in")).toEqual([]);
  });

  it("prefers a stored value over the declared default", () => {
    const controls = authFormControls(google, { service: "agent-platform" }, "ai-studio");
    // Narrowed rather than read off the union: a notice is prose and carries neither key nor
    // value, and the compiler is right to say so.
    const service = controls.find((control) => "key" in control && control.key === "service");
    expect(service && "value" in service ? service.value : undefined).toBe("agent-platform");
  });
});
