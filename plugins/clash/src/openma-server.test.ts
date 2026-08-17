import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createOpenMaMcpServer } from "./openma-server.js";

test("the bundled OpenMA MCP exposes skills, browser, and session-history tools", async (t) => {
  const calls: Array<{ group: string; input: unknown }> = [];
  const server = createOpenMaMcpServer({
    taskId: "session-current",
    tools: {
      async searchSkills(input) {
        calls.push({ group: "skills", input });
        return [{ id: "clash:clash", description: "Operate Clash" }];
      },
      async readSkill(input) {
        return `skill:${input.skill}`;
      },
      async readPluginFile(input) {
        return `file:${input.plugin}:${input.path}`;
      },
      async browserTabs(input) {
        return { tabs: [], input };
      },
      async browserNavigate(input) {
        calls.push({ group: "browser", input });
        return { url: input.url };
      },
      async browserScreenshot(input) {
        return {
          media_type: "image/png",
          data: "aGVsbG8=",
          tab_id: "tab-1",
          url: `https://example.com/?full=${String(input.full_page)}`,
        };
      },
      async browserClick(input) {
        return input.selector;
      },
      async browserType(input) {
        return input;
      },
      async browserGetText(input) {
        return input.selector ?? "page";
      },
      async browserEval(input) {
        return input.expression;
      },
      async browserClose() {
        return { tabs: [] };
      },
      async listSessions(input) {
        calls.push({ group: "sessions", input });
        return { sessions: [] };
      },
      async readSession(input) {
        return input;
      },
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "openma-native-tools-test", version: "1.0.0" });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name).sort(),
    [
      "browser_click",
      "browser_close",
      "browser_eval",
      "browser_get_text",
      "browser_navigate",
      "browser_screenshot",
      "browser_tabs",
      "browser_type",
      "openma_sessions_list",
      "openma_sessions_read",
      "plugin_read_file",
      "plugin_read_skill",
      "plugin_search_skills",
    ],
  );

  await client.callTool({
    name: "plugin_search_skills",
    arguments: { query: "clash", limit: 5 },
  });
  await client.callTool({
    name: "browser_navigate",
    arguments: { url: "https://example.com" },
  });
  await client.callTool({
    name: "openma_sessions_list",
    arguments: { query: "review", limit: 10 },
  });
  assert.deepEqual(calls.map(({ group }) => group), [
    "skills",
    "browser",
    "sessions",
  ]);

  const selfRead = await client.callTool({
    name: "openma_sessions_read",
    arguments: { session_id: "session-current" },
  });
  assert.equal(selfRead.isError, true);
  const selfContent = Array.isArray(selfRead.content) ? selfRead.content : [];
  const selfMessage = selfContent.find(
    (content): content is { type: "text"; text: string } =>
      typeof content === "object"
      && content !== null
      && "type" in content
      && content.type === "text"
      && "text" in content
      && typeof content.text === "string",
  );
  assert.match(selfMessage?.text ?? "", /current conversation/i);
});
