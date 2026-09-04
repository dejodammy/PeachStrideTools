import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
export const EXTRACTIONS_DIR = path.join(__dirname, "..", "..", "data", "extractions");

fs.mkdirSync(EXTRACTIONS_DIR, { recursive: true });

const SCRIPT = path.join(REPO_ROOT, "cvextract", "cvextract.py");

// cvextract needs pymupdf/openpyxl/etc, which live in a venv on the server.
// CVEXTRACT_PYTHON overrides; otherwise try the deployed venv, then PATH.
function pythonBin() {
  if (process.env.CVEXTRACT_PYTHON) return process.env.CVEXTRACT_PYTHON;
  const venv = "/home/app/cvenv/bin/python";
  if (fs.existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

export function jobDir(id) {
  return path.join(EXTRACTIONS_DIR, id);
}

export async function readStatus(id) {
  try {
    return JSON.parse(await fsp.readFile(path.join(jobDir(id), "status.json"), "utf8"));
  } catch {
    return null;
  }
}

async function writeStatus(id, status) {
  await fsp.writeFile(path.join(jobDir(id), "status.json"), JSON.stringify(status, null, 2), "utf8");
}

// Each processed file prints e.g. "! [ 3/19] cv.pdf   Name   email   phone"
const PROGRESS = /^([! ])\s*\[\s*(\d+)\s*\/\s*(\d+)\]\s+(.*)$/;

/**
 * Runs cvextract over the job's input folder. Resolves when the process exits;
 * progress is written to status.json as it goes so the browser can poll.
 */
export async function runExtraction(id) {
  const dir = jobDir(id);
  const input = path.join(dir, "input");
  const out = path.join(dir, "contacts.xlsx");

  const total = (await fsp.readdir(input)).length;
  await writeStatus(id, { state: "running", done: 0, total, flagged: 0, current: "" });

  return new Promise((resolve) => {
    const proc = spawn(pythonBin(), [SCRIPT, input, "-o", out], {
      cwd: dir,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });

    let stderr = "";
    let buf = "";
    let allOut = "";

    // Deliberately synchronous: awaiting inside this handler races the 'close'
    // handler, which then writes a final status from counters that haven't been
    // updated yet. Progress writes are fire-and-forget; 'close' re-parses the
    // full output for the authoritative counts.
    function parseChunk(text) {
      const lines = text.split("\n");
      const out = [];
      for (const line of lines) {
        const m = PROGRESS.exec(line.replace(/\r$/, ""));
        if (m) out.push({ flagged: m[1] === "!", done: Number(m[2]), total: Number(m[3]), file: m[4].trim() });
      }
      return out;
    }

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      allOut += text;
      buf += text;
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // keep the partial line for the next chunk
      const parsed = parseChunk(lines.join("\n"));
      if (!parsed.length) return;
      const last = parsed[parsed.length - 1];
      const flaggedSoFar = parseChunk(allOut).filter((p) => p.flagged).length;
      writeStatus(id, {
        state: "running",
        done: last.done,
        total: last.total || total,
        flagged: flaggedSoFar,
        current: last.file.slice(0, 60),
      }).catch(() => {});
    });

    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });

    proc.on("error", async (err) => {
      // Most likely Python or its dependencies are missing on this machine.
      await writeStatus(id, { state: "error", done: 0, total, flagged: 0, error: err.message });
      resolve();
    });

    proc.on("close", async (code) => {
      // Authoritative counts from the complete output, not from counters that
      // may have been mid-update when the process exited.
      const rows = parseChunk(allOut + buf);
      const done = rows.length;
      const flagged = rows.filter((r) => r.flagged).length;

      if (code === 0 && fs.existsSync(out)) {
        await writeStatus(id, { state: "done", done, total, flagged });
      } else {
        await writeStatus(id, {
          state: "error",
          done,
          total,
          flagged,
          error: stderr.trim().split("\n").slice(-4).join("\n") || `cvextract exited with code ${code}`,
        });
      }
      resolve();
    });
  });
}

/**
 * Reads the generated workbook back into rows the review UI can render.
 * Flags arrive as a single string from the sheet; split them so the UI can
 * show one chip per flag.
 */
export async function readResults(id) {
  const out = path.join(jobDir(id), "contacts.xlsx");
  if (!fs.existsSync(out)) return null;
  // XLSX.readFile needs fs wired into SheetJS and throws in this ESM context —
  // read the bytes ourselves, the same way excel.js handles uploads.
  const wb = XLSX.read(await fsp.readFile(out), { type: "buffer" });
  const sheet = wb.Sheets["Contacts"] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((r, i) => ({
    i,
    name: String(r["Name"] ?? "").trim(),
    email: String(r["Email"] ?? "").trim(),
    phone: String(r["Phone"] ?? "").trim(),
    file: String(r["Source File"] ?? "").trim(),
    readAs: String(r["Read As"] ?? "").trim(),
    otherEmails: String(r["Other Emails"] ?? "").trim(),
    flags: String(r["Flags"] ?? "")
      .split(/[,;]\s*/)
      .map((f) => f.trim())
      .filter(Boolean),
  }));
}

export function resultPath(id) {
  return path.join(jobDir(id), "contacts.xlsx");
}

/**
 * Resolves an uploaded CV inside a job, refusing anything that escapes the
 * job's own input folder — the filename arrives from the URL.
 */
export function sourceFilePath(id, name) {
  const input = path.resolve(jobDir(id), "input");
  const p = path.resolve(input, path.basename(String(name || "")));
  if (!p.startsWith(input + path.sep)) return null;
  return fs.existsSync(p) ? p : null;
}

/**
 * Applies reviewer corrections back into the generated workbook so the
 * downloaded spreadsheet matches what they fixed on screen. Values are written
 * into the existing sheets rather than rebuilding the file, so the structure
 * cvextract produced (including the Flag Guide) survives.
 */
export async function applyEdits(id, edits) {
  const out = resultPath(id);
  if (!fs.existsSync(out)) return false;

  const byFile = new Map(edits.map((e) => [e.file, e]));
  const wb = XLSX.read(await fsp.readFile(out), { type: "buffer", cellStyles: true });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!rows.length || !("Source File" in rows[0])) continue; // skip Flag Guide

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const header = {};
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
      if (cell?.v) header[String(cell.v)] = c;
    }

    rows.forEach((row, i) => {
      const edit = byFile.get(String(row["Source File"]));
      if (!edit) return;
      const r = range.s.r + 1 + i;
      for (const [col, value] of [["Name", edit.name], ["Email", edit.email], ["Phone", edit.phone]]) {
        if (header[col] === undefined || value === undefined) continue;
        const addr = XLSX.utils.encode_cell({ r, c: header[col] });
        ws[addr] = { ...(ws[addr] || {}), t: "s", v: String(value ?? "") };
      }
    });
  }

  await fsp.writeFile(out, XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }));
  await fsp.writeFile(path.join(jobDir(id), "edits.json"), JSON.stringify(edits, null, 2), "utf8");
  return true;
}
