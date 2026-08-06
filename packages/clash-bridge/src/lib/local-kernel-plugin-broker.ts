import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isLocalHostDiscoveryRecord } from "@clash/shared-runtime";
import {
  ExecutablePluginBrokerResponseSchema,
  type ExecutablePluginJsonValue,
} from "@clash/shared-types";

import type { PluginBroker } from "./plugin-stdio-runner.js";
import { paths } from "./platform.js";

export interface LocalKernelPluginBrokerOptions {
  discoveryPath?: string;
  fetch?: typeof fetch;
}

/**
 * Bridge-side transport to the self-hosted Kernel broker. The bearer is read
 * from the 0600 host discovery file for every request, so host restarts rotate
 * authority without restarting a separately managed Bridge daemon.
 */
export function createLocalKernelPluginBroker(
  options: LocalKernelPluginBrokerOptions = {},
): PluginBroker {
  const discoveryPath = options.discoveryPath ?? join(paths().configDir, "run", "host.json");
  const brokerFetch = options.fetch ?? fetch;
  return async (request, context): Promise<ExecutablePluginJsonValue> => {
    let discovery: unknown;
    try {
      discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Local Clash Kernel discovery is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isLocalHostDiscoveryRecord(discovery) || !discovery.pluginBrokerToken) {
      throw new Error("Local Clash Kernel does not advertise a plugin capability broker.");
    }
    const response = await brokerFetch(
      new URL("/api/v1/local/plugin-broker", discovery.endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-clash-local-plugin-broker-token": discovery.pluginBrokerToken,
        },
        body: JSON.stringify({ request, ...context }),
        redirect: "error",
      },
    );
    if (!response.ok) {
      throw new Error(`Local Clash Kernel broker returned HTTP ${response.status}.`);
    }
    const brokerResponse = ExecutablePluginBrokerResponseSchema.parse(await response.json());
    if (brokerResponse.requestId !== request.requestId) {
      throw new Error(`Local Clash Kernel broker response does not match request ${request.requestId}.`);
    }
    if (brokerResponse.status === "error") {
      throw new Error(`${brokerResponse.error.code}: ${brokerResponse.error.message}`);
    }
    return brokerResponse.result;
  };
}
