import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createOpenMaNativeTools } from "./openma-tools.js";

test("OpenMA native tools bind skills, persisted sessions, and task-scoped browser state", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-openma-tools-"));
  const skillDir = join(root, "skills", "clash");
  await mkdir(join(skillDir, "references"), { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: clash\ndescription: Operate the Clash workspace.\n---\n\n# Clash\n",
  );
  await writeFile(join(skillDir, "references", "flow.md"), "Use the Host.\n");

  const hostCalls: Array<{ path: string; init?: RequestInit }> = [];
  const browserCalls: string[][] = [];
  const tools = createOpenMaNativeTools({
    taskId: "session-current",
    pluginRoots: [{ name: "clash", root }],
    workspace: "/workspace/project",
    hostRequest: async (path, init) => {
      hostCalls.push({ path, init });
      if (path === "/api/v1/sessions") {
        return {
          sessions: [
            {
              id: "session-current",
              title: "Current",
              agentId: "codex-acp",
              updatedAt: "2026-08-16T00:00:00.000Z",
            },
            {
              id: "session-design",
              title: "Design review",
              agentId: "claude-acp",
              updatedAt: "2026-08-15T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/api/v1/local-sessions/session-design/messages") {
        return {
          messages: [
            {
              id: "turn-1-user",
              sender_kind: "user",
              turn_id: "turn-1",
              created_at: 1,
              events: [{ type: "text", text: "Please review" }],
            },
            {
              id: "turn-1-agent",
              sender_kind: "agent",
              turn_id: "turn-1",
              created_at: 2,
              events: [
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Looks good." },
                },
                {
                  sessionUpdate: "agent_thought_chunk",
                  content: { type: "text", text: "hidden" },
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected Host request: ${path}`);
    },
    runBrowser: async (args) => {
      browserCalls.push([...args]);
      if (args.includes("list")) {
        return JSON.stringify({
          tabs: [{ id: "tab-1", title: "Example", url: "https://example.com", active: true }],
        });
      }
      return JSON.stringify({ ok: true, url: "https://example.com" });
    },
  });

  assert.deepEqual(await tools.searchSkills({ query: "workspace", limit: 10 }), [
    { id: "clash:clash", description: "Operate the Clash workspace." },
  ]);
  assert.match(
    String(await tools.readSkill({ skill: "clash:clash" })),
    /# Clash/,
  );
  assert.equal(
    await tools.readPluginFile({ plugin: "clash", path: "./skills/clash/references/flow.md" }),
    "Use the Host.\n",
  );
  await assert.rejects(
    tools.readPluginFile({ plugin: "clash", path: "../package.json" }),
    /must start with|inside the plugin/i,
  );

  assert.deepEqual(await tools.listSessions({ query: "design", limit: 5 }), {
    sessions: [{
      id: "session-design",
      title: "Design review",
      agent_id: "claude-acp",
      last_used_at: "2026-08-15T00:00:00.000Z",
    }],
  });
  const history = await tools.readSession({ session_id: "session-design" }) as {
    content: string;
    has_more: boolean;
  };
  assert.match(history.content, /# Design review/);
  assert.match(history.content, /## User\nPlease review/);
  assert.match(history.content, /## Assistant\nLooks good\./);
  assert.doesNotMatch(history.content, /hidden/);
  assert.equal(history.has_more, false);

  assert.deepEqual(await tools.browserTabs({ action: "list" }), {
    active_tab_id: "tab-1",
    tabs: [{
      index: 0,
      tab_id: "tab-1",
      title: "Example",
      url: "https://example.com",
      active: true,
    }],
  });
  await tools.browserNavigate({ url: "https://example.com" });
  assert.ok(browserCalls.every((args) => args.includes("session-current")));
});

test("browser tools normalize agent-browser tabs and close only the selected tab", async () => {
  const calls: string[][] = [];
  const tabs = [
    {
      active: true,
      label: null,
      tabId: "t1",
      title: "First",
      type: "page",
      url: "https://first.example/",
    },
    {
      active: false,
      label: "docs",
      tabId: "t2",
      title: "Docs",
      type: "page",
      url: "https://docs.example/",
    },
  ];
  const tools = createOpenMaNativeTools({
    taskId: "session-browser-shape",
    pluginRoots: [],
    workspace: "/workspace/project",
    async hostRequest() {
      throw new Error("Host should not be used by browser tools");
    },
    runBrowser: async (args) => {
      calls.push([...args]);
      if (args.includes("get") && args.includes("text")) {
        return JSON.stringify({ success: true, data: { text: "123456" } });
      }
      if (args.includes("open")) {
        return JSON.stringify({
          success: true,
          data: { title: "First", url: "https://first.example/" },
        });
      }
      if (args.includes("click")) {
        return JSON.stringify({ success: true, data: { clicked: "#button" } });
      }
      if (args.includes("type")) {
        return JSON.stringify({ success: true, data: { typed: "hello" } });
      }
      if (args.includes("eval")) {
        return JSON.stringify({ success: true, data: { result: "evaluated" } });
      }
      const screenshotIndex = args.indexOf("screenshot");
      if (screenshotIndex >= 0) {
        const path = args.slice(screenshotIndex + 1).find((value) => !value.startsWith("--"));
        assert.equal(typeof path, "string");
        await writeFile(path!, Buffer.from("png"));
        return JSON.stringify({ success: true, data: { path } });
      }
      return JSON.stringify({ success: true, data: { tabs } });
    },
  });

  assert.deepEqual(await tools.browserTabs({ action: "list" }), {
    active_tab_id: "t1",
    tabs: [
      {
        index: 0,
        tab_id: "t1",
        active: true,
        url: "https://first.example/",
        title: "First",
      },
      {
        index: 1,
        tab_id: "t2",
        active: false,
        url: "https://docs.example/",
        title: "Docs",
      },
    ],
  });

  await tools.browserTabs({ action: "select", index: 1 });
  assert.deepEqual(calls.at(-2)?.slice(-2), ["tab", "t2"]);
  await tools.browserTabs({ action: "close", tab_id: "t2" });
  assert.deepEqual(calls.at(-2)?.slice(-3), ["tab", "close", "t2"]);
  await tools.browserClose();
  assert.deepEqual(calls.at(-2)?.slice(-3), ["tab", "close", "t1"]);

  await tools.browserScreenshot({ full_page: true });
  const screenshotCall = calls.find((args) => args.includes("screenshot"));
  assert.ok(screenshotCall?.includes("--full"));
  assert.ok(!screenshotCall?.includes("--full-page"));
  assert.equal(
    await tools.browserGetText({ selector: "body", max_chars: 4 }),
    "1234\n\n...[truncated; 2 more chars]",
  );
  assert.deepEqual(await tools.browserNavigate({ url: "https://first.example/" }), {
    tab_id: "t1",
    url: "https://first.example/",
    title: "First",
  });
  assert.equal(await tools.browserClick({ selector: "#button" }), "Clicked #button");
  assert.equal(
    await tools.browserType({ selector: "#input", text: "hello", submit: true }),
    "Typed 5 chars into #input and submitted",
  );
  assert.equal(await tools.browserEval({ expression: "1 + 1" }), "evaluated");
});

test("the browser launcher resolves the packaged CLI unless explicitly overridden", async () => {
  const module = await import("./openma-tools.js") as typeof import("./openma-tools.js") & {
    resolveAgentBrowserLaunch(
      env?: Record<string, string | undefined>,
    ): { command: string; args: string[] };
  };
  assert.deepEqual(
    module.resolveAgentBrowserLaunch({ CLASH_AGENT_BROWSER_COMMAND: "/custom/browser" }),
    { command: "/custom/browser", args: [] },
  );
  const bundled = module.resolveAgentBrowserLaunch({});
  assert.equal(bundled.command, process.execPath);
  assert.match(bundled.args[0] ?? "", /agent-browser[\\/]bin[\\/]agent-browser\.js$/u);
});
