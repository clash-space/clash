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
  CLASH_PROJECT_ID   Project override when no cwd marker is available
  CLASH_CANVAS_ID    Canvas scope for canvas node commands
  CLASH_API_KEY      Remote/cloud credential override (not needed for local-api)

Project identity lives in .clash/project.toml. Collaborative state remains in
the Project Loro replica; cwd files are editable projections and drafts.`)
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

program.parse();
