/**
 * Enumerate Claude Code session transcripts on disk.
 *
 * CC writes one .jsonl per chat to `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl`.
 * Each file is a sequence of JSON-RPC-ish records — typically the first line is
 * a `{type: "summary"}` or the user's first message; the filename (sans .jsonl)
 * is the sessionId. We surface a flat top-N list (across all projects) ordered
 * by mtime so the chat dialog can offer "resume previous conversation".
 *
 * Best-effort: if `~/.claude/projects/` doesn't exist (user has never run CC),
 * we return []. If a transcript is malformed, we just skip its summary and
 * fall back to the sessionId.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CcSessionInfo {
  /** ACP sessionId — same string `session/load` accepts to resume. */
  id: string;
  /** First user message or `summary` field if present, else "". */
  title: string;
  /** Cwd the session was started in (decoded from CC's directory naming). */
  cwd: string;
  /** Unix seconds of the file's last modification (proxy for "last active"). */
  modifiedAt: number;
}

const ROOT = join(homedir(), ".claude", "projects");

export async function listLocalCcSessions(limit = 20): Promise<CcSessionInfo[]> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(ROOT);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const all: CcSessionInfo[] = [];
  for (const projDir of projectDirs) {
    const projPath = join(ROOT, projDir);
    let entries: string[] = [];
    try { entries = await readdir(projPath); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = join(projPath, entry);
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        const id = entry.slice(0, -".jsonl".length);
        const title = await readFirstSummary(file);
        all.push({
          id,
          title,
          cwd: decodeCcProjectDir(projDir),
          modifiedAt: Math.floor(st.mtimeMs / 1000),
        });
      } catch {
        /* unreadable file; skip */
      }
    }
  }
  all.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return all.slice(0, limit);
}

/**
 * Read just enough of the file to extract a summary or first user message.
 * Bounded to ~16 KiB so we don't pull a multi-MB transcript into memory
 * just for a dropdown label.
 */
async function readFirstSummary(file: string): Promise<string> {
  let text: string;
  try {
    // readFile is fine for tiny prefixes — files are ndjson; we only parse
    // the first ~few lines anyway, but Node has no easy "read N bytes" API
    // without going to fs.open + read. For typical transcripts (few KB to
    // MB) this is acceptable; if we ever care, swap to a streaming read.
    const buf = await readFile(file, { encoding: "utf-8" });
    text = buf;
  } catch { return ""; }

  const lines = text.split("\n", 5); // first 5 lines is enough
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: { type?: string; summary?: string; message?: { role?: string; content?: unknown } };
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj.summary === "string" && obj.summary.trim()) {
      return obj.summary.trim().slice(0, 120);
    }
    if (obj.message?.role === "user") {
      const c = obj.message.content;
      let s = "";
      if (typeof c === "string") s = c;
      else if (Array.isArray(c)) {
        for (const p of c) {
          if (p && typeof p === "object" && "text" in p && typeof (p as { text: unknown }).text === "string") {
            s = (p as { text: string }).text;
            break;
          }
        }
      }
      if (s.trim()) return s.trim().slice(0, 120);
    }
  }
  return "";
}

/**
 * CC encodes a cwd like /Users/xiaoyang/Proj/clash → -Users-xiaoyang-Proj-clash.
 * Decode is best-effort; we only use it for display, not as a path.
 */
function decodeCcProjectDir(name: string): string {
  return name.startsWith("-") ? name.slice(1).replace(/-/g, "/") : name;
}
