// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./styles.css";

import { initTheme } from "./lib/themeManager";
import { installErrorReporting, ErrorBoundary } from "./lib/errorReporting";
import { initTelemetry, track } from "./lib/telemetry";

initTheme();
// Install global error capture + telemetry before anything renders, so a crash
// during the first render is still reported.
installErrorReporting();
initTelemetry();
track("app.opened", { cold_start: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);
