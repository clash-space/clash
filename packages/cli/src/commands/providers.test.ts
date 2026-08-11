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

  it("asks which service issued the key, where a vendor runs more than one", () => {
    // MiniMax's international and domestic services do not share a login, so an account that does
    // not say which one it is gets refused as though its key were wrong. Called service rather
    // than region because Google's two surfaces are products, not places.
    expect(source).toMatch(/--service/);
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

/**
 * Whatever the form can hold, the terminal can hold.
 *
 * The form knew five credential keys — apiKey, baseUrl, accessKey, secretKey, callbackUrl — and the
 * CLI knew one. Volcengine, Suno and custom endpoints could only be connected by opening a window,
 * which is the wrong shape for a product whose whole premise is that an agent works the project
 * from a terminal.
 *
 * The fix is not a flag per credential. Which credentials exist is the provider's business, and a
 * plugin can declare its own, so a CLI enumerating them would be permanently one provider behind.
 * It carries key=value pairs and lets the host validate, which it already does.
 */
describe("credentials the form knows, the CLI can set", () => {
  it("takes any credential as a key=value pair", () => {
    expect(source).toMatch(/--credential <[a-z=]+>/);
  });

  it("collects more than one", () => {
    // accessKey and secretKey arrive together or not at all.
    expect(source).toMatch(/collect|\[\]\)/);
  });

  it("reads a credential from a file too", () => {
    // The same reason --api-key-file exists: an argument is in shell history and in ps.
    expect(source).toMatch(/--credential-file/);
  });
});
