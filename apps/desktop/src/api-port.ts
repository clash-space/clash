import { createServer } from "node:net";

export const DEFAULT_DESKTOP_API_PORT = 49321;
const DEFAULT_HOST = "127.0.0.1";

export interface ResolvedDesktopApiPort {
  port: number;
  source: "default" | "env" | "ephemeral";
  preferredPort: number;
}

function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer TCP port between 0 and 65535`);
  }
  return port;
}

function listenOnce(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(resolvedPort);
      });
    });
  });
}

export function isAddressInUse(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "EADDRINUSE";
}

export async function isPortAvailable(port: number, host = DEFAULT_HOST): Promise<boolean> {
  try {
    await listenOnce(port, host);
    return true;
  } catch (error) {
    if (isAddressInUse(error)) return false;
    throw error;
  }
}

export async function resolveAvailableDesktopApiPort({
  envPort,
  defaultPort = DEFAULT_DESKTOP_API_PORT,
  host = DEFAULT_HOST,
}: {
  envPort?: string;
  defaultPort?: number;
  host?: string;
} = {}): Promise<ResolvedDesktopApiPort> {
  const trimmedEnvPort = envPort?.trim();
  if (trimmedEnvPort) {
    const preferredPort = parsePort(trimmedEnvPort, "CLASH_LOCAL_API_PORT");
    if (preferredPort === 0) {
      return {
        port: await listenOnce(0, host),
        source: "ephemeral",
        preferredPort,
      };
    }
    if (!(await isPortAvailable(preferredPort, host))) {
      throw new Error(`CLASH_LOCAL_API_PORT ${preferredPort} is already in use`);
    }
    return { port: preferredPort, source: "env", preferredPort };
  }

  if (await isPortAvailable(defaultPort, host)) {
    return { port: defaultPort, source: "default", preferredPort: defaultPort };
  }

  return {
    port: await listenOnce(0, host),
    source: "ephemeral",
    preferredPort: defaultPort,
  };
}
