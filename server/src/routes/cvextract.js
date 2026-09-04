import express from "express";
import multer from "multer";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  jobDir,
  runExtraction,
  readStatus,
  readResults,
  resultPath,
  sourceFilePath,
  applyEdits,
} from "../services/cvExtract.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 500 },
});
const router = express.Router();

const SUPPORTED = new Set([".pdf", ".docx", ".doc"]);
const running = new Set();

// Keep the uploaded name but strip any path components — these land on disk.
function safeName(name, i) {
  const base = path.basename(String(name || `file_${i}`)).replace(/[\\/:*?"<>|]/g, "_");
  return base.slice(0, 120) || `file_${i}`;
}

router.post("/", upload.array("cvs", 500), async (req, res) => {
  const files = (req.files || []).filter((f) => SUPPORTED.has(path.extname(f.originalname).toLowerCase()));
  if (files.length === 0) {
    return res.status(400).json({ error: "Upload at least one .pdf, .docx or .doc file." });
  }

  const id = randomUUID();
  const input = path.join(jobDir(id), "input");
  await fsp.mkdir(input, { recursive: true });

  const seen = new Set();
  for (const [i, f] of files.entries()) {
    let name = safeName(f.originalname, i);
    // Two CVs can legitimately share a filename; don't let one overwrite the other.
    while (seen.has(name.toLowerCase())) name = `${path.parse(name).name}_${i}${path.extname(name)}`;
    seen.add(name.toLowerCase());
    await fsp.writeFile(path.join(input, name), f.buffer);
  }

  res.status(202).json({ id, total: files.length, skipped: (req.files || []).length - files.length });

  // Fire-and-forget; the browser polls /status.
  running.add(id);
  runExtraction(id).finally(() => running.delete(id));
});

router.get("/:id/status", async (req, res) => {
  const status = await readStatus(req.params.id);
  if (!status) return res.status(404).json({ error: "Extraction not found." });
  res.json(status);
});

router.get("/:id/results", async (req, res) => {
  const rows = await readResults(req.params.id);
  if (!rows) return res.status(404).json({ error: "No results yet." });
  res.json({ rows });
});

// Serves an uploaded CV so the reviewer can read the actual document while
// correcting what was extracted from it. inline so the browser renders PDFs.
router.get("/:id/file/:name", (req, res) => {
  const p = sourceFilePath(req.params.id, req.params.name);
  if (!p) return res.status(404).send("File not found.");
  const ext = path.extname(p).toLowerCase();
  if (ext === ".pdf") res.type("application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(p)}"`);
  res.sendFile(p);
});

// Writes reviewer corrections into the workbook, so the download matches what
// they fixed on screen rather than the original guesses.
router.post("/:id/rows", express.json({ limit: "2mb" }), async (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Expected { rows: [...] }." });
  const ok = await applyEdits(req.params.id, rows);
  if (!ok) return res.status(404).json({ error: "No spreadsheet to update." });
  res.json({ saved: rows.length });
});

router.get("/:id/download", (req, res) => {
  const p = resultPath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).send("No spreadsheet yet.");
  res.download(p, "cv_contacts.xlsx");
});

export default router;
