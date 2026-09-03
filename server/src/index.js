import "dotenv/config"; // must load before anything that reads MAIL_ACCOUNT_* / GOOGLE_* env vars
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import campaignsRouter from "./routes/campaigns.js";
import sendersRouter from "./routes/senders.js";
import diagnosticsRouter from "./routes/diagnostics.js";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { closeBrowser } from "./services/pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use("/auth", authRouter);

// Everything that can read/send campaign data or list accounts requires sign-in.
// Health and the default PDF template stay public — neither is sensitive, and
// the health check is more useful reachable without a session.
app.use("/api/campaigns", requireAuth, campaignsRouter);
app.use("/api/senders", requireAuth, sendersRouter);
app.use("/api/diagnostics", requireAuth, diagnosticsRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/templates/default", (req, res) => {
  const templatePath = path.join(__dirname, "..", "templates", "default_letter.hbs");
  res.type("text/plain").sendFile(templatePath);
});

// Serve the built React app in production (npm run build inside /client first).
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
}

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large (limit 40MB)." });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Bulk Mailer server running at http://localhost:${PORT}`);
});

async function shutdown() {
  await closeBrowser();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
