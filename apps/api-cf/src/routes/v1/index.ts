import { Hono } from "hono";
import type { Env } from "../../config";
import { projectRoutes } from "./projects";
import { varsRoutes } from "./vars";
import { sessionRoutes } from "./sessions";
import { cliAuthRoutes } from "./cli-auth";
import { assetsRoutes } from "./assets";
import { editsRoutes } from "./edits";
import { runtimesRoutes } from "./runtimes";
import { sessionsRuntimeRoutes } from "./sessions-runtime";
import { crewRoutes } from "./crew";

export const v1Routes = new Hono<{ Bindings: Env }>();

v1Routes.route("/projects", projectRoutes);
v1Routes.route("/vars", varsRoutes);
v1Routes.route("/sessions", sessionRoutes);
v1Routes.route("/cli-auth", cliAuthRoutes);
v1Routes.route("/assets", assetsRoutes);
v1Routes.route("/edits", editsRoutes);
v1Routes.route("/runtimes", runtimesRoutes);
v1Routes.route("/crew", crewRoutes);
// Local-runtime session lifecycle (BYO local agent; distinct from cloud
// /api/v1/sessions). Browser opens WS to /api/v1/local-sessions/:id/_stream
// for the duplex event/prompt stream. Session creation lives next to it
// at POST /api/v1/runtimes/:rid/sessions (registered inside runtimes.ts).
v1Routes.route("/local-sessions", sessionsRuntimeRoutes);

// Health check
v1Routes.get("/", (c) => c.json({ version: "v1", status: "ok" }));
