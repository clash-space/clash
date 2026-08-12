import { Command } from "commander";
import { getHostDiscoveryStatus } from "../lib/host-discovery";
import { resolveClashProfile, type ClashRuntimeProfile } from "@clash/shared-runtime/local-paths";

export interface HostStatusOutput {
  status: "active" | "inactive";
  profile: ClashRuntimeProfile;
  endpoint?: string;
  launchMode?: string;
  pid?: number;
  hostId?: string;
  protocolVersion?: number;
  dataSchemaVersion?: number;
}

export async function runHostStatus(options: {
  json?: boolean;
  runDir?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
} = {}): Promise<HostStatusOutput> {
  const stdout = options.stdout ?? console.log;
  const state = await getHostDiscoveryStatus({ runDir: options.runDir });
  const profile = resolveClashProfile();
  const output: HostStatusOutput = state.status === "active"
    ? {
      status: "active",
      profile,
      endpoint: state.record.endpoint,
      launchMode: state.record.launchMode,
      pid: state.record.pid,
      hostId: state.record.hostId,
      protocolVersion: state.record.protocolVersion,
      dataSchemaVersion: state.record.dataSchemaVersion,
    }
    : { status: "inactive", profile };

  if (options.json) {
    stdout(JSON.stringify(output, null, 2));
    return output;
  }

  if (output.status === "active") {
    stdout(`Host: active`);
    stdout(`Profile: ${output.profile}`);
    stdout(`Endpoint: ${output.endpoint}`);
    stdout(`Launch mode: ${output.launchMode}`);
    stdout(`PID: ${output.pid}`);
    stdout(`Protocol: ${output.protocolVersion}`);
  } else {
    stdout("Host: inactive");
    stdout(`Profile: ${output.profile}`);
    stdout("No local-api host is active; open Clash Desktop or start local-api first.");
  }

  return output;
}

export const hostCommand = new Command("host")
  .description("Inspect the local Clash host");

hostCommand
  .command("status")
  .description("Show local host discovery status")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    await runHostStatus({ json: options.json });
  });
