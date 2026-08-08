import { Command } from "commander";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authCommand } from "./commands/auth";
import { initCommand, projectsCommand } from "./commands/projects";
import { canvasCommand } from "./commands/canvas";
import { canvasesCommand } from "./commands/canvases";
import { tasksCommand } from "./commands/tasks";
import { actionsCommand } from "./commands/actions";
import { modelsCommand } from "./commands/models";
import { hostCommand } from "./commands/host";
import { timelineCommand } from "./commands/timeline";
import { doctorCommand } from "./commands/doctor";
import { textCommand } from "./commands/text";
import { productionCommand } from "./commands/production";
import { assetsCommand } from "./commands/assets";
import { auditCommand } from "./commands/audit";
import { effectCommand } from "./commands/effects";
import { directorCommand } from "./commands/director";
import { ensureCliLocalDaemon } from "./lib/local-daemon-bootstrap";
import { resolveClashProfile } from "@clash/shared-runtime/local-paths";
import { installCliTrace } from "./lib/cli-trace";

installCliTrace();

const program = new Command();

program
  .name("clash")
  .description("Clash CLI — bundled command runtime for the Codex plugin")
  .option("--profile <profile>", "Runtime profile: dev or prod")
  .version("0.1.0");

program.hook("preAction", async () => {
  const requested = program.opts<{ profile?: string }>().profile;
  process.env.CLASH_PROFILE = resolveClashProfile({
    ...process.env,
    ...(requested ? { CLASH_PROFILE: requested } : {}),
  });
  const cliEntryPath = fileURLToPath(import.meta.url);
  const runtimeDir = dirname(cliEntryPath);
  await ensureCliLocalDaemon({
    daemonEntryPath: join(runtimeDir, "local-api.cjs"),
    cliEntryPath,
    agentBundleRoot: join(runtimeDir, "agents"),
    builtinPluginRoot: dirname(runtimeDir),
  });
});

program.addCommand(authCommand);
program.addCommand(initCommand);
program.addCommand(projectsCommand);
program.addCommand(canvasCommand);
program.addCommand(canvasesCommand);
program.addCommand(tasksCommand);
program.addCommand(actionsCommand);
program.addCommand(modelsCommand);
program.addCommand(hostCommand);
program.addCommand(timelineCommand);
program.addCommand(doctorCommand);
program.addCommand(textCommand);
program.addCommand(productionCommand);
program.addCommand(assetsCommand);
program.addCommand(auditCommand);
program.addCommand(effectCommand);
program.addCommand(directorCommand);

// The bundled host may execute this entry through Electron's Node mode.
// Its argv still includes the script path, so Commander must parse as Node.
void program.parseAsync(process.argv, { from: "node" }).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
