import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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

// status.json is only ever written once runExtraction() begins, so its
// presence is exactly "has this job already started" — used to stop more
// files being appended, or a second extraction being kicked off, once it has.
export async function jobStarted(id) {
  return fs.existsSync(path.join(jobDir(id), "status.json"));
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
 * Two CVs sharing an email address are almost always the same person
 * applying more than once — keep the cleanest copy and drop the rest,
 * rather than showing — and risking emailing — the same address twice.
 * A copy a reviewer already approved outranks flag count outright (a human
 * decision beats an automatic one); otherwise fewer flags wins; a tie keeps
 * whichever was uploaded first. cvextract.py already tags every row in such
 * a group with DUPLICATE_IN_BATCH, so an unapproved survivor still carries
 * that flag and stays in "needs a look" — dedup picks a copy, a human still
 * confirms it was the right one. Rows with no email can't be matched this
 * way and are never touched.
 */
function dedupeByEmail(rows) {
  const isBetter = (candidate, current) =>
    candidate.approved !== current.approved ? candidate.approved : candidate.flags.length < current.flags.length;

  const groups = new Map();
  const kept = [];
  for (const r of rows) {
    const key = r.email.toLowerCase();
    if (!key) {
      kept.push(r);
      continue;
    }
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, r);
      kept.push(r);
    } else if (isBetter(r, existing)) {
      kept[kept.indexOf(existing)] = r;
      groups.set(key, r);
    }
  }
  return { rows: kept.sort((a, b) => a.i - b.i), dupesRemoved: rows.length - kept.length };
}

/**
 * Reads the generated workbook back into rows the review UI can render.
 * Flags arrive as a single string from the sheet; split them so the UI can
 * show one chip per flag. "Approved" only exists once a reviewer has
 * confirmed at least one flagged CV — applyEdits adds the column the first
 * time it's needed, so most jobs never have it. Duplicate emails are
 * collapsed to one row each — see dedupeByEmail.
 */
export async function readResults(id) {
  const out = path.join(jobDir(id), "contacts.xlsx");
  if (!fs.existsSync(out)) return null;
  // XLSX.readFile needs fs wired into SheetJS and throws in this ESM context —
  // read the bytes ourselves, the same way excel.js handles uploads.
  const wb = XLSX.read(await fsp.readFile(out), { type: "buffer" });
  const sheet = wb.Sheets["Contacts"] || wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = raw.map((r, i) => ({
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
    approved: String(r["Approved"] ?? "").trim().toLowerCase() === "yes",
  }));
  return dedupeByEmail(rows);
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

// Same binary the .doc text-extraction fallback in cvextract.py already
// relies on — if that's installed, this is too.
function sofficeBin() {
  return process.env.SOFFICE_PATH || (process.platform === "win32" ? "soffice.exe" : "soffice");
}

const CONVERT_TIMEOUT_MS = 60_000;
// Two viewers opening the same .docx moments apart shouldn't both pay for a
// LibreOffice launch — the second request just waits on the first's promise.
const conversionsInFlight = new Map();

async function convertToPdf(sourcePath, id) {
  const outDir = path.join(jobDir(id), "converted");
  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${path.parse(sourcePath).name}.pdf`);
  if (fs.existsSync(outPath)) return outPath;
  if (conversionsInFlight.has(outPath)) return conversionsInFlight.get(outPath);

  // A dedicated profile per run avoids LibreOffice's "another instance is
  // already running" lock error when two conversions land at once.
  const profile = path.join(outDir, `.lo-profile-${randomUUID()}`);

  const job = new Promise((resolve, reject) => {
    const proc = spawn(
      sofficeBin(),
      [
        `-env:UserInstallation=file://${profile.replace(/\\/g, "/")}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        sourcePath,
      ],
      {}
    );
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error("soffice conversion timed out"));
    }, CONVERT_TIMEOUT_MS);

    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error(`soffice exited ${code}: ${stderr.slice(0, 300)}`));
    });
  }).finally(async () => {
    conversionsInFlight.delete(outPath);
    // Awaited (not fire-and-forget): a caller reading the converted/ folder
    // right after this resolves — the retention sweep, a debug listing —
    // should never see a stray profile dir still being torn down.
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  });

  conversionsInFlight.set(outPath, job);
  return job;
}

/**
 * A viewable PDF for an uploaded CV: the file itself if it's already a PDF,
 * or a converted-and-cached copy for .docx/.doc so the reviewer can render it
 * inline instead of forcing a download. Null if conversion isn't possible
 * (LibreOffice missing, or it failed on this particular file) — callers
 * should fall back to serving the original.
 */
export async function previewPdfPath(id, name) {
  const source = sourceFilePath(id, name);
  if (!source) return null;
  if (path.extname(source).toLowerCase() === ".pdf") return source;
  try {
    return await convertToPdf(source, id);
  } catch (err) {
    console.error(`Preview conversion failed for ${name}:`, err.message);
    return null;
  }
}

/**
 * Applies reviewer corrections back into the generated workbook so the
 * downloaded spreadsheet matches what they fixed on screen. Values are written
 * into the existing sheets rather than rebuilding the file, so the structure
 * cvextract produced (including the Flag Guide) survives. "Approved" isn't a
 * column cvextract.py writes — it's added the first time a save actually
 * needs it, so a reviewer confirming a flagged CV survives a reload instead
 * of reverting the moment the page refreshes.
 */
export async function applyEdits(id, edits) {
  const out = resultPath(id);
  if (!fs.existsSync(out)) return false;

  const byFile = new Map(edits.map((e) => [e.file, e]));
  const needsApprovedColumn = edits.some((e) => e.approved !== undefined);
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

    if (needsApprovedColumn && header["Approved"] === undefined) {
      const newCol = range.e.c + 1;
      header["Approved"] = newCol;
      ws[XLSX.utils.encode_cell({ r: range.s.r, c: newCol })] = { t: "s", v: "Approved" };
      range.e.c = newCol;
      ws["!ref"] = XLSX.utils.encode_range(range);
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
      if (edit.approved !== undefined && header["Approved"] !== undefined) {
        const addr = XLSX.utils.encode_cell({ r, c: header["Approved"] });
        ws[addr] = { ...(ws[addr] || {}), t: "s", v: edit.approved ? "Yes" : "" };
      }
    });
  }

  await fsp.writeFile(out, XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }));
  await fsp.writeFile(path.join(jobDir(id), "edits.json"), JSON.stringify(edits, null, 2), "utf8");
  return true;
}

// Every job folder holds the uploaded CVs themselves — real people's names,
// emails and phone numbers — so abandoned batches shouldn't just sit on disk
// forever. Deletes any job whose folder hasn't been touched in `maxAgeDays`.
const DEFAULT_RETENTION_DAYS = Number(process.env.CVEXTRACT_RETENTION_DAYS) || 7;

export async function sweepOldJobs(maxAgeDays = DEFAULT_RETENTION_DAYS) {
  let entries;
  try {
    entries = await fsp.readdir(EXTRACTIONS_DIR, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(EXTRACTIONS_DIR, entry.name);
    try {
      const stat = await fsp.stat(dir);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Job folder disappeared or is mid-write — leave it for the next sweep rather than fail the batch.
    }
  }
  return { removed };
}
