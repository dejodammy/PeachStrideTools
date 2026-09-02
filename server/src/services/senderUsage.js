import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_DIR = path.join(__dirname, "..", "..", "data", "senders");
fs.mkdirSync(USAGE_DIR, { recursive: true });

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Gmail enforces a rolling 24h send cap per account (500 for a regular Gmail
// account); we stay under it with a configurable safety margin.
export const DAILY_SEND_CAP = Number(process.env.SEND_DAILY_CAP) || 450;

function usageFile(email) {
  const key = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
  return path.join(USAGE_DIR, `${key}.log`);
}

/**
 * How many sends this address has made in the trailing 24h. Prunes older
 * entries from disk while it's at it, so the file never grows unbounded.
 */
export async function getUsage(email) {
  const file = usageFile(email);
  if (!fs.existsSync(file)) return 0;
  const raw = await fsp.readFile(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const cutoff = Date.now() - WINDOW_MS;
  const kept = lines.map(Number).filter((ts) => Number.isFinite(ts) && ts > cutoff);
  if (kept.length !== lines.length) {
    await fsp.writeFile(file, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  }
  return kept.length;
}

export async function recordSend(email) {
  await fsp.appendFile(usageFile(email), `${Date.now()}\n`, "utf8");
}

export async function getRemaining(email) {
  const used = await getUsage(email);
  return { used, cap: DAILY_SEND_CAP, remaining: Math.max(0, DAILY_SEND_CAP - used) };
}
