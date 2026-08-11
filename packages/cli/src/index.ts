import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { initCommand, projectsCommand } from "./commands/projects";
import { canvasCommand } from "./commands/canvas";
import { canvasesCommand } from "./commands/canvases";
import { tasksCommand } from "./commands/tasks";
import { actionsCommand } from "./commands/actions";
import { modelsCommand } from "./commands/models";
import { hostCommand } from "./commands/host";
import { registerProviderCommands } from "./commands/providers";
import { timelineCommand } from "./commands/timeline";
import { doctorCommand } from "./commands/doctor";
import { textCommand } from "./commands/text";
import { projectionCommand } from "./commands/projection";
import { assetsCommand } from "./commands/assets";
import { auditCommand } from "./commands/audit";
import { mcpCommand } from "./commands/mcp";
import { effectCommand } from "./commands/effects";
import { directorCommand } from "./commands/director";
import { resolveClashProfile } from "@clash/shared-runtime/local-paths";
import { installCliTrace } from "./lib/cli-trace";

installCliTrace();

const program = new Command();

program
  .name("clash")
  .description(`Clash CLI — AI video production from your terminal

Local setup:
  1. Open Clash Desktop or start the local-api host
  2. clash init --project <id>    # link this cwd through .clash/project.toml
  3. clash canvas connect         # keep one local Project replica connected

Local commands do not require cloud authentication.
Optional cloud sync: clash auth login

Environment variables:
  CLASH_API_URL      Local or cloud API URL (default: http://localhost:8788)
  CLASH_HOME         Local Clash home (default: ~/.clash)
  CLASH_PROFILE      Runtime profile: dev or prod (default: prod)
  CLASH_PROJECT_ID   Project override when no cwd marker is available
  CLASH_CANVAS_ID    Canvas scope for canvas node commands
  CLASH_API_KEY      Remote/cloud credential override (not needed for local-api)

Project identity lives in .clash/project.toml. Collaborative state remains in
the Project Loro replica; cwd files are editable projections and drafts.`)
  .option("--profile <profile>", "Runtime profile: dev or prod")
  .version("0.1.0");

program.hook("preAction", () => {
  const requested = program.opts<{ profile?: string }>().profile;
  process.env.CLASH_PROFILE = resolveClashProfile({
    ...process.env,
    ...(requested ? { CLASH_PROFILE: requested } : {}),
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
registerProviderCommands(program);
program.addCommand(timelineCommand);
program.addCommand(doctorCommand);
program.addCommand(textCommand);
program.addCommand(projectionCommand);
program.addCommand(assetsCommand);
program.addCommand(auditCommand);
program.addCommand(mcpCommand);
program.addCommand(effectCommand);
program.addCommand(directorCommand);

// Commander auto-detects Electron and otherwise treats argv[1] as the first
// user command. Clash Desktop intentionally runs this entry with
// ELECTRON_RUN_AS_NODE, whose argv is Node-compatible, so force that contract.
/**
 * Reports a failure the CLI understands as a sentence, not a stack.
 *
 * Nothing caught anything here, so a stopped host, a rejected key or a conflict the host described
 * in words all arrived as `throw new Error(` with a caret and a dozen frames of bundled JavaScript.
 * The message was in there, in the middle, looking like the CLI had crashed rather than like
 * something needed doing.
 *
 * The stack stays one environment variable away: a message is right for a condition we understand,
 * and an unexpected error still needs its frames.
 */
function reportFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (process.env.CLASH_DEBUG && error instanceof Error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(message);
  }
  process.exit(1);
}

// Commander actions are async, so a rejection escapes as an unhandled rejection rather than through
// a try around parse. Both doors need the same handler.
process.on("unhandledRejection", reportFailure);
process.on("uncaughtException", reportFailure);

program.parseAsync(process.argv, { from: "node" }).catch(reportFailure);
