import { createApp } from "./app";
import { ProjectRoom } from "./agents/project-room";
import { SupervisorAgent } from "./agents/supervisor";
import { GenerationWorkflow } from "./agents/generation";

// OSS entry: no plugins. Downstream / hosted entry points
// (e.g. apps/api-cf-hosted) call createApp({ plugins: [...] })
// to install billing / quota / BYOK key resolution.
const app = createApp();

export default app;

// Export Durable Object classes, Workflow, and Container
export { ProjectRoom, SupervisorAgent, GenerationWorkflow };
export { RenderContainer } from "./containers/render";
