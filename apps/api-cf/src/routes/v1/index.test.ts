import { describe, expect, it } from "vitest";

import { v1Routes } from "./index";

describe("hosted v1 Asset boundary", () => {
  it.each([
    ["GET", "/assets"],
    ["POST", "/assets"],
    ["POST", "/assets/batch"],
    ["GET", "/assets/legacy-asset"],
    ["PATCH", "/assets/legacy-asset/cover"],
    ["DELETE", "/assets/legacy-asset/ref?projectId=legacy-project"],
  ])("does not expose legacy %s %s", async (method, path) => {
    const response = await v1Routes.request(path, { method });

    expect(response.status).toBe(404);
  });
});
