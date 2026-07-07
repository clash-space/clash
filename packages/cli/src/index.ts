import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { initCommand, projectsCommand } from "./commands/projects";
import { canvasCommand } from "./commands/canvas";
import { tasksCommand } from "./commands/tasks";
import { actionsCommand } from "./commands/actions";
import { varsCommand } from "./commands/vars";
import { modelsCommand } from "./commands/models";
import { roomCommand } from "./commands/room";
import { hostCommand } from "./commands/host";
import { timelineCommand } from "./commands/timeline";
import { doctorCommand } from "./commands/doctor";
import { textCommand } from "./commands/text";
import { productionCommand } from "./commands/production";
import { assetsCommand } from "./commands/assets";

const program = new Command();

program
  .name("clash")
  .description(`Clash CLI — AI video production from your terminal

Setup:
  1. Create an API token at your Clash Settings page (avatar → Settings → API Tokens)
  2. clash auth login            # paste your clsh_... token
  3. clash auth status            # verify connection

Environment variables (override config file):
  CLASH_API_KEY     API token (clsh_...)
  CLASH_API_URL     Server URL (default: http://localhost:8788)
  CLASH_HOME        Local Clash home (default: ~/.clash)

Config file: $CLASH_HOME/config.json, or ~/.clash/config.json by default`)
  .version("0.1.0");

program.addCommand(authCommand);
program.addCommand(initCommand);
program.addCommand(projectsCommand);
program.addCommand(canvasCommand);
program.addCommand(tasksCommand);
program.addCommand(actionsCommand);
program.addCommand(varsCommand);
program.addCommand(modelsCommand);
program.addCommand(roomCommand);
program.addCommand(hostCommand);
program.addCommand(timelineCommand);
program.addCommand(doctorCommand);
program.addCommand(textCommand);
program.addCommand(productionCommand);
program.addCommand(assetsCommand);

program.parse();
