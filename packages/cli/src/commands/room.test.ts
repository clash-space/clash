import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomApiErrorMessage } from "./room";

const roomSource = readFileSync(fileURLToPath(new URL("./room.ts", import.meta.url)), "utf8");

function commandBlock(source: string, command: string): string {
  const start = source.indexOf(`.command("${command}")`);
  assert.notEqual(start, -1, `${command} command not found`);
  const next = source.indexOf(".command(", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test("room 404 explains missing room API support", () => {
  const message = roomApiErrorMessage(
    new Error("API error 404: {\"error\":\"Not found\"}"),
    "project-room",
  );

  assert.match(message ?? "", /Room messages are not available/);
  assert.match(message ?? "", /current local-api\/cloud API with room support/);
  assert.match(message ?? "", /project-room/);
});

test("room non-404 errors keep their original handling", () => {
  assert.equal(
    roomApiErrorMessage(new Error("API error 401: unauthorized"), "project-room"),
    null,
  );
});

test("room read json preserves local/cloud sync metadata", () => {
  const readSource = commandBlock(roomSource, "read");

  assert.match(readSource, /apiJson<\{ messages: RoomMessage\[\]; sync\?: RoomSyncMeta \}>/);
  assert.match(readSource, /printJson\(data\)/);
});
