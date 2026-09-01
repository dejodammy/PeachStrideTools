import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "..", "data", "campaigns");

fs.mkdirSync(DATA_DIR, { recursive: true });

export function campaignDir(id) {
  return path.join(DATA_DIR, id);
}

export function campaignExists(id) {
  return fs.existsSync(campaignDir(id));
}

export async function createCampaignDir(id) {
  await fsp.mkdir(campaignDir(id), { recursive: true });
}

export async function writeJson(id, filename, data) {
  await fsp.writeFile(path.join(campaignDir(id), filename), JSON.stringify(data, null, 2), "utf8");
}

export async function readJson(id, filename, fallback = null) {
  try {
    const raw = await fsp.readFile(path.join(campaignDir(id), filename), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeText(id, filename, text) {
  await fsp.writeFile(path.join(campaignDir(id), filename), text ?? "", "utf8");
}

export async function readText(id, filename, fallback = "") {
  try {
    return await fsp.readFile(path.join(campaignDir(id), filename), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export function fileExists(id, filename) {
  return fs.existsSync(path.join(campaignDir(id), filename));
}

export function filePath(id, filename) {
  return path.join(campaignDir(id), filename);
}

const LOG_HEADER = "email,name,status,detail,timestamp\n";

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function appendLogRow(id, row) {
  const logPath = filePath(id, "send_log.csv");
  if (!fs.existsSync(logPath)) {
    await fsp.writeFile(logPath, LOG_HEADER, "utf8");
  }
  const line = [row.email, row.name, row.status, row.detail, row.timestamp].map(csvEscape).join(",") + "\n";
  await fsp.appendFile(logPath, line, "utf8");
}

export async function readSentEmails(id) {
  const logPath = filePath(id, "send_log.csv");
  if (!fs.existsSync(logPath)) return new Set();
  const raw = await fsp.readFile(logPath, "utf8");
  const lines = raw.split("\n").slice(1).filter(Boolean);
  const sent = new Set();
  for (const line of lines) {
    const [email, , status] = line.split(",");
    if (status === "sent") sent.add(email.replace(/^"|"$/g, ""));
  }
  return sent;
}

export async function writeStatus(id, status) {
  await writeJson(id, "status.json", status);
}

export async function readStatus(id) {
  return readJson(id, "status.json", null);
}
