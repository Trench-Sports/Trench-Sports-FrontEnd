import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Web Bluetooth requires a secure context (HTTPS) and a Permissions-Policy allowlist.
// Keep this header permissive for same-origin usage.
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "bluetooth=(self)");
  next();
});

// Health check endpoint (handy for EB / load balancers)
app.get("/health", (req, res) => res.status(200).send("ok"));

const distPath = path.join(__dirname, "dist");
const indexHtml = path.join(distPath, "index.html");

if (!fs.existsSync(distPath) || !fs.existsSync(indexHtml)) {
  console.warn(
    "[WARN] ./dist not found. Build the Vite app first (npm run build) or enable devDependencies on EB."
  );
}

app.use(express.static(distPath, {
  // Cache static assets aggressively; index.html is handled below.
  maxAge: "1y",
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

// SPA fallback: serve index.html for any non-file route
app.get("*", (req, res) => {
  res.sendFile(indexHtml);
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Trench Sports FrontEnd running on port ${port}`);
});
