import { Command } from "commander";
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

const program = new Command();

program
  .name("clash")
  .description("Clash CLI — bundled command runtime for the Codex plugin")
  .version("0.1.0");

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
program.parse(process.argv, { from: "node" });
