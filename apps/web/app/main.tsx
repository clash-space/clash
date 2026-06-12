import "./globals.css";
import "./lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router";
import { installViteRuntimeConfig } from "./runtime-env";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

installViteRuntimeConfig(import.meta.env);

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
