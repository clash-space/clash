import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");
const entrypoint = readFileSync(join(__dirname, "..", "index.ts"), "utf8");

/**
 * Connecting an account is something a person does, so it belongs on the CLI.
 *
 * Until now it did not exist there. An account could only be created by hand-writing JSON to a
 * PATCH endpoint that first requires reading a token back out of a GET — a concurrency handshake
 * that is the host's business and that no workflow should ever see. Anyone without the desktop app
 * had no way to use their own key.
 */
describe("provider account commands", () => {
  it("is registered on the CLI", () => {
    expect(entrypoint).toMatch(/registerProviderCommands/);
  });

  it("lists what is connected", () => {
    expect(source).toMatch(/\.command\("list"\)/);
  });

  it("connects an account with a key", () => {
    expect(source).toMatch(/\.command\("add <providerId>"\)/);
    expect(source).toMatch(/--api-key/);
  });

  it("takes the key from a file or stdin, not only an argument", () => {
    // A key pasted as an argument is recorded by the shell's history and visible in the process
    // list to every other user on the machine.
    expect(source).toMatch(/--api-key-file|readFileSync|stdin/);
  });

  it("offers region where an upstream answers on more than one host", () => {
    // MiniMax's international and domestic services do not share a login, so an account that does
    // not say which one it is gets refused as though its key were wrong.
    expect(source).toMatch(/--region/);
  });

  it("never asks the operator for a concurrency token", () => {
    // The read-before-write handshake is the host's business. Exposing it turns "connect my
    // account" into a two-step protocol whose failure mode is a stale-token error.
    expect(source).not.toMatch(/--if-match|--read-token|--force/);
  });

  it("reads the current token itself before writing", () => {
    // Which means the CLI must do that handshake internally rather than skipping it.
    expect(source).toMatch(/readToken/);
  });

  it("removes an account", () => {
    expect(source).toMatch(/\.command\("remove <accountId>"\)/);
  });
});
