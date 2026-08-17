import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { createRequire } from "node:module";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { OpenMaNativeTools } from "./openma-server.js";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(import.meta.url);

export function resolveAgentBrowserLaunch(
  env: Record<string, string | undefined> = process.env,
): { command: string; args: string[] } {
  const override = env.CLASH_AGENT_BROWSER_COMMAND?.trim();
  if (override) return { command: override, args: [] };
  const packageJson = nodeRequire.resolve("agent-browser/package.json");
  return {
    command: process.execPath,
    args: [join(dirname(packageJson), "bin", "agent-browser.js")],
  };
}

export interface OpenMaPluginRoot {
  name: string;
  root: string;
}

export interface OpenMaNativeToolOptions {
  taskId: string;
  pluginRoots: readonly OpenMaPluginRoot[];
  workspace: string;
  hostRequest(path: string, init?: RequestInit): Promise<unknown>;
  runBrowser?: (args: readonly string[]) => Promise<string>;
}

interface SkillEntry {
  pluginName: string;
  name: string;
  description: string;
  file: string;
  pluginRoot: string;
}

interface SessionRow {
  id: string;
  title?: string;
  agentId?: string;
  agent_id?: string;
  updatedAt?: string;
  last_used_at?: string | number;
}

interface SessionMessage {
  sender_kind?: string;
  events?: unknown[];
}

interface HistoryEvent {
  seq: number;
  kind: "user" | "assistant" | "thought" | "activity";
  text: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function frontmatterValue(source: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "mu").exec(source);
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
}

async function discoverSkills(roots: readonly OpenMaPluginRoot[]): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  for (const plugin of roots) {
    const directory = join(plugin.root, "skills");
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = join(directory, entry.name, "SKILL.md");
      let source: string;
      try {
        source = await readFile(file, "utf8");
      } catch {
        continue;
      }
      skills.push({
        pluginName: plugin.name,
        name: frontmatterValue(source, "name") ?? entry.name,
        description: frontmatterValue(source, "description") ?? "",
        file,
        pluginRoot: plugin.root,
      });
    }
  }
  return skills;
}

async function resolveReadablePluginFile(rootPath: string, path: string): Promise<string> {
  if (!path.startsWith("./")) {
    throw new Error('Plugin file path must start with "./"');
  }
  const root = await realpath(rootPath);
  const candidate = await realpath(resolve(root, path));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Plugin file path must stay inside the plugin root");
  }
  const info = await stat(candidate);
  if (!info.isFile()) throw new Error("Plugin path is not a file");
  if (info.size > 1024 * 1024) throw new Error("Plugin file is larger than 1 MiB");
  return candidate;
}

function jsonResult(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function agentBrowserData(value: unknown): unknown {
  const envelope = objectValue(value);
  const data = objectValue(envelope.data);
  return Object.keys(data).length > 0 ? data : value;
}

function normalizeBrowserTabs(value: unknown) {
  const result = objectValue(agentBrowserData(value));
  const rawTabs = Array.isArray(result.tabs) ? result.tabs : [];
  const tabs = rawTabs.flatMap((raw, index) => {
    const tab = objectValue(raw);
    const tabId = textValue(tab.tabId) ?? textValue(tab.tab_id) ?? textValue(tab.id);
    if (!tabId) return [];
    return [{
      index,
      tab_id: tabId,
      active: tab.active === true,
      url: textValue(tab.url) ?? "about:blank",
      title: typeof tab.title === "string" ? tab.title : "",
    }];
  });
  return {
    active_tab_id: tabs.find((tab) => tab.active)?.tab_id ?? null,
    tabs,
  };
}

function eventText(value: unknown): string {
  const event = objectValue(value);
  if (event.type === "text") return textValue(event.text) ?? "";
  const inner = Object.keys(objectValue(event.update)).length > 0
    ? objectValue(event.update)
    : event;
  const content = objectValue(inner.content);
  return textValue(content.text) ?? "";
}

function historyEvents(messages: readonly SessionMessage[]): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  let seq = 0;
  for (const message of messages) {
    for (const raw of message.events ?? []) {
      seq += 1;
      const event = objectValue(raw);
      const inner = Object.keys(objectValue(event.update)).length > 0
        ? objectValue(event.update)
        : event;
      const updateType = textValue(inner.sessionUpdate) ?? textValue(inner.type);
      const text = eventText(raw);
      if (message.sender_kind === "user" && text) {
        events.push({ seq, kind: "user", text });
      } else if (
        message.sender_kind === "agent"
        && (updateType === "agent_message" || updateType === "agent_message_chunk" || event.type === "text")
        && text
      ) {
        events.push({ seq, kind: "assistant", text });
      } else if (
        updateType === "agent_thought" || updateType === "agent_thought_chunk"
      ) {
        if (text) events.push({ seq, kind: "thought", text });
      } else if (updateType === "tool_call" || updateType === "tool_call_update") {
        events.push({
          seq,
          kind: "activity",
          text: textValue(inner.title) ?? updateType,
        });
      }
    }
  }
  return events;
}

function renderHistory(
  session: { id: string; title: string; agent_id: string; workspace: string },
  blocks: readonly string[],
  assistant: string,
): string {
  const pending = assistant ? [`## Assistant\n${assistant.trim()}`] : [];
  const body = [...blocks, ...pending].join("\n\n");
  return [
    `# ${session.title || session.id}`,
    `- session_id: ${session.id}`,
    `- agent: ${session.agent_id}`,
    `- workspace: ${session.workspace}`,
    "",
    body || "(No readable conversation messages.)",
  ].join("\n");
}

function formatHistory(
  session: { id: string; title: string; agent_id: string; workspace: string },
  events: readonly HistoryEvent[],
  options: { after_seq?: number; max_chars?: number; include_activity?: boolean },
) {
  const fromSeq = Math.max(0, options.after_seq ?? 0);
  const maxChars = Math.max(1_000, Math.min(100_000, options.max_chars ?? 30_000));
  const selected = events.filter((event) => event.seq > fromSeq);
  const blocks: string[] = [];
  let assistant = "";
  let lastSeq = fromSeq;
  const flushAssistant = () => {
    if (!assistant) return;
    blocks.push(`## Assistant\n${assistant.trim()}`);
    assistant = "";
  };
  for (const event of selected) {
    const previousBlocks = blocks.length;
    const previousAssistant = assistant;
    if (event.kind === "user") {
      flushAssistant();
      blocks.push(`## User\n${event.text.trim()}`);
    } else if (event.kind === "assistant") {
      assistant += event.text;
    } else if (options.include_activity && event.kind === "thought") {
      flushAssistant();
      blocks.push(`### Agent thought\n${event.text.trim()}`);
    } else if (options.include_activity && event.kind === "activity") {
      flushAssistant();
      blocks.push(`### Activity\n${event.text}`);
    }
    if (renderHistory(session, blocks, assistant).length > maxChars) {
      blocks.length = previousBlocks;
      assistant = previousAssistant;
      return {
        session,
        from_seq: fromSeq,
        next_after_seq: lastSeq,
        has_more: true,
        content: renderHistory(session, blocks, assistant),
      };
    }
    lastSeq = event.seq;
  }
  flushAssistant();
  return {
    session,
    from_seq: fromSeq,
    next_after_seq: selected.at(-1)?.seq ?? fromSeq,
    has_more: false,
    content: renderHistory(session, blocks, assistant),
  };
}

export function createOpenMaNativeTools(options: OpenMaNativeToolOptions): OpenMaNativeTools {
  const taskId = options.taskId;
  const sessionArgs = ["--session", taskId, "--namespace", "clash", "--json", "--headed"];
  const runBrowser = options.runBrowser ?? (async (args) => {
    const launch = resolveAgentBrowserLaunch();
    const result = await execFileAsync(launch.command, [...launch.args, ...args], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  });
  const browser = async (args: readonly string[]) =>
    agentBrowserData(jsonResult(await runBrowser([...sessionArgs, ...args])));
  const listBrowserTabs = async () =>
    normalizeBrowserTabs(await browser(["tab", "list"]));

  const sessions = async (): Promise<SessionRow[]> => {
    const result = objectValue(await options.hostRequest("/api/v1/sessions"));
    return Array.isArray(result.sessions) ? result.sessions as SessionRow[] : [];
  };

  return {
    async searchSkills({ query, limit }) {
      const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
      return (await discoverSkills(options.pluginRoots))
        .map((skill) => {
          const name = `${skill.pluginName} ${skill.name}`.toLocaleLowerCase();
          const description = skill.description.toLocaleLowerCase();
          const score = terms.length === 0
            ? 1
            : terms.reduce(
                (total, term) => total + (name.includes(term) ? 3 : 0) + (description.includes(term) ? 1 : 0),
                0,
              );
          return { skill, score };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) =>
          right.score - left.score
          || `${left.skill.pluginName}:${left.skill.name}`.localeCompare(
            `${right.skill.pluginName}:${right.skill.name}`,
          ))
        .slice(0, limit)
        .map(({ skill }) => ({
          id: `${skill.pluginName}:${skill.name}`,
          description: skill.description,
        }));
    },
    async readSkill({ skill }) {
      const match = (await discoverSkills(options.pluginRoots)).find(
        (entry) => `${entry.pluginName}:${entry.name}` === skill,
      );
      if (!match) throw new Error(`Unknown plugin skill: ${skill}`);
      return readFile(match.file, "utf8");
    },
    async readPluginFile({ plugin, path }) {
      const root = options.pluginRoots.find((entry) => entry.name === plugin)?.root;
      if (!root) throw new Error(`Unknown plugin: ${plugin}`);
      return readFile(await resolveReadablePluginFile(root, path), "utf8");
    },
    async browserTabs(input) {
      if (input.action === "list") return listBrowserTabs();
      if (input.action === "new") {
        await browser(["tab", "new", ...(input.url ? [input.url] : [])]);
        return listBrowserTabs();
      }
      const listed = await listBrowserTabs();
      const selected = input.tab_id
        ? listed.tabs.find((tab) => tab.tab_id === input.tab_id)
        : input.index === undefined
          ? undefined
          : listed.tabs[input.index];
      if (!selected) {
        throw new Error(
          input.tab_id
            ? `Unknown browser tab: ${input.tab_id}`
            : `Browser tab index is out of range: ${String(input.index)}`,
        );
      }
      if (input.action === "select") {
        await browser(["tab", selected.tab_id]);
      } else {
        await browser(["tab", "close", selected.tab_id]);
      }
      return listBrowserTabs();
    },
    async browserNavigate({ url }) {
      await browser(["open", url]);
      const listed = await listBrowserTabs();
      const active = listed.tabs.find((tab) => tab.active);
      if (!active) throw new Error("No browser tab is open for this task");
      return {
        tab_id: active.tab_id,
        url: active.url,
        title: active.title,
      };
    },
    async browserScreenshot({ full_page }) {
      const directory = await mkdtemp(join(tmpdir(), "clash-browser-"));
      const path = join(directory, "screenshot.png");
      try {
        await browser(["screenshot", ...(full_page ? ["--full"] : []), path]);
        const listed = await listBrowserTabs();
        const active = listed.tabs.find((tab) => tab.active) ?? listed.tabs[0];
        return {
          media_type: "image/png",
          data: (await readFile(path)).toString("base64"),
          tab_id: active?.tab_id ?? "active",
          url: active?.url ?? "about:blank",
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async browserClick({ selector }) {
      await browser(["click", selector]);
      return `Clicked ${selector}`;
    },
    async browserType({ selector, text, submit }) {
      await browser(["type", selector, text]);
      if (submit) await browser(["press", "Enter"]);
      return `Typed ${text.length} chars into ${selector}${submit ? " and submitted" : ""}`;
    },
    async browserGetText({ selector, max_chars }) {
      const result = objectValue(agentBrowserData(jsonResult(await runBrowser([
        ...sessionArgs,
        "get",
        "text",
        selector ?? "body",
      ]))));
      const value = typeof result.text === "string" ? result.text : "";
      if (!value) return "(empty)";
      if (value.length <= max_chars) return value;
      return `${value.slice(0, max_chars)}\n\n...[truncated; ${value.length - max_chars} more chars]`;
    },
    async browserEval({ expression }) {
      const result = await browser(["eval", expression]);
      const record = objectValue(result);
      return Object.hasOwn(record, "result") ? record.result : result;
    },
    async browserClose() {
      const listed = await listBrowserTabs();
      const active = listed.tabs.find((tab) => tab.active);
      if (!active) throw new Error("No browser tab is open for this task");
      await browser(["tab", "close", active.tab_id]);
      return listBrowserTabs();
    },
    async listSessions({ query, limit }) {
      const normalized = query?.trim().toLocaleLowerCase() ?? "";
      return {
        sessions: (await sessions())
          .filter((session) => session.id !== taskId)
          .filter((session) => !normalized || [session.title, session.id, session.agentId, session.agent_id]
            .some((value) => value?.toLocaleLowerCase().includes(normalized)))
          .slice(0, Math.min(100, Math.max(1, limit ?? 20)))
          .map((session) => ({
            id: session.id,
            title: session.title || session.id,
            agent_id: session.agentId ?? session.agent_id ?? "unknown",
            last_used_at: session.updatedAt ?? session.last_used_at,
          })),
      };
    },
    async readSession(input) {
      const session = (await sessions()).find((candidate) => candidate.id === input.session_id);
      if (!session) throw new Error(`Unknown OpenMA session: ${input.session_id}`);
      const result = objectValue(await options.hostRequest(
        `/api/v1/local-sessions/${encodeURIComponent(input.session_id)}/messages`,
      ));
      const messages = Array.isArray(result.messages) ? result.messages as SessionMessage[] : [];
      return formatHistory(
        {
          id: session.id,
          title: session.title || session.id,
          agent_id: session.agentId ?? session.agent_id ?? "unknown",
          workspace: options.workspace,
        },
        historyEvents(messages),
        input,
      );
    },
  };
}
