import { createBrowserRouter } from "react-router";
import AppLayout, { loader as appLayoutLoader } from "./layouts/AppLayout";
import { ErrorBoundary, HydrateFallback } from "./root";

// Object Route Module shim: route files export the page component as
// `default` and (optionally) a `loader`. createBrowserRouter's `lazy`
// expects { Component, loader, ... }; only set fields the module
// actually exports (passing { ErrorBoundary: undefined } makes react-
// router try to render <undefined /> → React #130).
function lazyRoute(importer: () => Promise<any>) {
  return async () => {
    const m = await importer();
    const out: Record<string, unknown> = { Component: m.default };
    if (m.loader) out.loader = m.loader;
    if (m.ErrorBoundary) out.ErrorBoundary = m.ErrorBoundary;
    if (m.HydrateFallback) out.HydrateFallback = m.HydrateFallback;
    return out;
  };
}

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    loader: appLayoutLoader,
    HydrateFallback,
    ErrorBoundary,
    children: [
      { index: true, lazy: lazyRoute(() => import("./routes/home")) },
      { path: "landing", lazy: lazyRoute(() => import("./routes/landing")) },
      { path: "login", lazy: lazyRoute(() => import("./routes/login")) },
      { path: "projects", lazy: lazyRoute(() => import("./routes/projects")) },
      {
        path: "projects/:id",
        lazy: lazyRoute(() => import("./routes/project.$id")),
      },
      { path: "settings", lazy: lazyRoute(() => import("./routes/settings")) },
      { path: "billing", lazy: lazyRoute(() => import("./routes/billing")) },
      {
        path: "marketplace",
        lazy: lazyRoute(() => import("./routes/marketplace")),
      },
      {
        path: "editor-standalone",
        lazy: lazyRoute(() => import("./routes/editor-standalone")),
      },
      { path: "auth/cli", lazy: lazyRoute(() => import("./routes/auth.cli")) },
      { path: "connect-daemon", lazy: lazyRoute(() => import("./routes/connect-daemon")) },
      { path: "terms", lazy: lazyRoute(() => import("./routes/terms")) },
      { path: "privacy", lazy: lazyRoute(() => import("./routes/privacy")) },
    ],
  },
]);
