import { describe, expect, it } from "vitest";

import { MINIMAX_AUTH } from "./minimax-adapter.js";
import { PluginAuthDeclarationSchema, authFormControls, missingAuthKeys } from "@clash/shared-types";

/**
 * One method, because MiniMax has one way in.
 *
 * The region is not a second way of authenticating. The same key is presented the same way to
 * either host, so splitting `international` and `domestic` into two methods would ask the user to
 * choose an authentication method in order to express a deployment -- and would then have to
 * duplicate `apiKey` across both.
 *
 * The count follows the vendor, not a wish for symmetry with Google. Google genuinely has three
 * configurations because a service account and an API key are presented differently and reach
 * different hosts.
 */
describe("MINIMAX_AUTH", () => {
  it("is a valid declaration", () => {
    expect(PluginAuthDeclarationSchema.safeParse(MINIMAX_AUTH).success).toBe(true);
  });

  it("declares exactly one method", () => {
    expect(MINIMAX_AUTH.methods.map((method) => method.id)).toEqual(["api-key"]);
  });

  it("collects the key and the region together", () => {
    expect(authFormControls(MINIMAX_AUTH, {}, "api-key").flatMap((c) => ("key" in c ? [c.key] : [])))
      .toEqual(["apiKey", "service"]);
  });

  it("needs the key and treats the declared region as supplied", () => {
    expect(missingAuthKeys(MINIMAX_AUTH, {}, "api-key")).toEqual(["apiKey"]);
    expect(missingAuthKeys(MINIMAX_AUTH, { apiKey: "k" }, "api-key")).toEqual([]);
  });

  it("keeps both hosts selectable", () => {
    // The CLI's deleted SERVICES table claimed these were `global` and `cn`, so both values the
    // Provider actually understood were rejected. The declaration is the only place they are named.
    const region = authFormControls(MINIMAX_AUTH, {}, "api-key")
      .find((control) => "key" in control && control.key === "service");
    expect(region?.control).toBe("select");
    expect((region as { options: { value: string }[] }).options.map((o) => o.value))
      .toEqual(["international", "domestic"]);
  });
});
