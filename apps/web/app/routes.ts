import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// /api/* and /dev-log are handled in workers/app.ts directly (SPA mode
// doesn't allow server loader/action on routes). Putting them here would
// break `react-router build`.
export default [
  layout("layouts/AppLayout.tsx", [
    index("routes/home.tsx"),
    route("landing", "routes/landing.tsx"),
    route("login", "routes/login.tsx"),
    route("projects", "routes/projects.tsx"),
    route("projects/:id", "routes/project.$id.tsx"),
    route("settings", "routes/settings.tsx"),
    route("marketplace", "routes/marketplace.tsx"),
    route("editor-standalone", "routes/editor-standalone.tsx"),
    route("auth/cli", "routes/auth.cli.tsx"),
    route("terms", "routes/terms.tsx"),
    route("privacy", "routes/privacy.tsx"),
  ]),
] satisfies RouteConfig;
