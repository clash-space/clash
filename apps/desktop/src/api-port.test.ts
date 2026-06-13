import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPortAvailable,
  resolveAvailableDesktopApiPort,
} from "./api-port";

const servers: Server[] = [];

async function occupyPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("failed to reserve port");
  return address.port;
}

describe("desktop API port resolution", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  it("uses the preferred default port when it is available", async () => {
    const port = await occupyPort();
    const defaultPort = port + 1;

    if (!(await isPortAvailable(defaultPort))) return;

    await expect(resolveAvailableDesktopApiPort({ defaultPort })).resolves.toEqual({
      port: defaultPort,
      source: "default",
      preferredPort: defaultPort,
    });
  });

  it("falls back to an ephemeral port when the default port is already in use", async () => {
    const occupiedPort = await occupyPort();

    const resolved = await resolveAvailableDesktopApiPort({ defaultPort: occupiedPort });

    expect(resolved.source).toBe("ephemeral");
    expect(resolved.preferredPort).toBe(occupiedPort);
    expect(resolved.port).toBeGreaterThan(0);
    expect(resolved.port).not.toBe(occupiedPort);
  });

  it("treats an explicit environment port as strict", async () => {
    const occupiedPort = await occupyPort();

    await expect(resolveAvailableDesktopApiPort({ envPort: String(occupiedPort) })).rejects.toThrow(
      `CLASH_LOCAL_API_PORT ${occupiedPort} is already in use`,
    );
  });
});
