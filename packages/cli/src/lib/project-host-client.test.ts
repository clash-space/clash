import test from "node:test";
import assert from "node:assert/strict";
import { createCliProjectAssetHostClient } from "./project-host-client";

test("CLI Project Asset client uses the discovered Host connection", async () => {
  const originalApiUrl = process.env.CLASH_API_URL;
  const originalApiKey = process.env.CLASH_API_KEY;
  process.env.CLASH_API_URL = "http://127.0.0.1:49329";
  process.env.CLASH_API_KEY = "clsh_asset_test";
  const requests: Array<{ url: string; authorization: string | null }> = [];

  try {
    const client = createCliProjectAssetHostClient({
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          authorization: headers.get("authorization"),
        });
        return Response.json({ assets: [] });
      },
    });

    assert.deepEqual(
      (await client.list({ projectId: "project one" })).value,
      [],
    );
    assert.deepEqual(requests, [{
      url: "http://127.0.0.1:49329/api/v1/projects/project%20one/assets",
      authorization: "Bearer clsh_asset_test",
    }]);
  } finally {
    if (originalApiUrl === undefined) delete process.env.CLASH_API_URL;
    else process.env.CLASH_API_URL = originalApiUrl;
    if (originalApiKey === undefined) delete process.env.CLASH_API_KEY;
    else process.env.CLASH_API_KEY = originalApiKey;
  }
});
