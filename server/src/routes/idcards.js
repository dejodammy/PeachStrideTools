import express from "express";
import multer from "multer";
import { ZipArchive } from "archiver";

import { parseIdCardRows } from "../services/excel.js";
import {
  matchFile,
  renderCards,
  readDefaultIdCardTemplate,
  safeFileBaseName,
  BRANDS,
  resolveBrand,
} from "../services/idcards.js";
import { classifyImage, cleanSignature, removePhotoBackground } from "../services/imagePrep.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const router = express.Router();

const uploadFields = upload.fields([
  { name: "roster", maxCount: 1 },
  { name: "photos", maxCount: 500 },
  { name: "signatures", maxCount: 500 },
  { name: "images", maxCount: 1000 },
]);

/**
 * Parse the client's explicit row-to-image assignment, used when the images
 * arrive as one unsorted pile (WhatsApp exports, whose filenames say nothing
 * about who is in them) rather than as named photo/signature files. Shape is
 * one entry per roster row, in row order: { photo, signature }, each an index
 * into the uploaded `images` array or null.
 */
function parseAssignments(body) {
  if (!body.assignments) return null;
  let parsed;
  try {
    parsed = JSON.parse(body.assignments);
  } catch {
    throw Object.assign(new Error("The image assignment could not be read. Reload the page and try again."), {
      status: 400,
    });
  }
  return Array.isArray(parsed) ? parsed : null;
}

function pickImage(files, index) {
  return Number.isInteger(index) && index >= 0 && index < files.length ? files[index] : null;
}

// Focal points are computed in the browser (where the images already are) and
// sent alongside, one per uploaded image, aligned to the `images` array.
function parseFocals(body) {
  if (!body.focals) return [];
  try {
    const parsed = JSON.parse(body.focals);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRequest(req) {
  const rosterFile = req.files?.roster?.[0];
  if (!rosterFile) {
    throw Object.assign(new Error("Upload a staff spreadsheet (.xlsx or .xls) with Name and Role columns."), {
      status: 400,
    });
  }

  const { columns, rows, dropped } = parseIdCardRows(rosterFile.buffer);
  const photoColumn = req.body.photoColumn && columns.includes(req.body.photoColumn) ? req.body.photoColumn : "Photo";
  const signatureColumn =
    req.body.signatureColumn && columns.includes(req.body.signatureColumn) ? req.body.signatureColumn : "Signature";

  const photoFiles = req.files?.photos || [];
  const signatureFiles = req.files?.signatures || [];
  const imageFiles = req.files?.images || [];
  const assignments = parseAssignments(req.body);
  const focals = parseFocals(req.body);

  const brand = resolveBrand(req.body.brand);
  const template = (req.body.template || "").trim() || readDefaultIdCardTemplate(brand);

  // Two intake modes. When the client sends an explicit assignment it has
  // already decided which image belongs to which row (the operator clicked them
  // together), so trust it outright. Otherwise fall back to matching separately
  // uploaded photo/signature files by filename or employee name.
  const entries = rows.map((row, index) => {
    if (assignments) {
      const assigned = assignments[index] || {};
      return {
        row,
        photoFile: pickImage(imageFiles, assigned.photo),
        signatureFile: pickImage(imageFiles, assigned.signature),
        focal: focals[assigned.photo] || null,
      };
    }
    return {
      row,
      photoFile: matchFile(row, photoFiles, row[photoColumn]),
      signatureFile: matchFile(row, signatureFiles, row[signatureColumn]),
    };
  });

  const uploadedCount = assignments ? imageFiles.length : photoFiles.length;
  return { columns, rows, dropped, entries, template, uploadedCount, brand };
}

// Is this upload a portrait or a signature? Answered by the server's portrait
// model, which copes with signatures on grey or coloured paper far better than
// a brightness guess in the browser.
router.post("/classify-image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error("No image was uploaded."), { status: 400 });
    }
    res.json({ kind: await classifyImage(req.file.buffer) });
  } catch (err) {
    next(err);
  }
});

// Prepare one uploaded image for the card: a signature comes back as clean ink
// on transparency, a photo with its background replaced by white. The client
// calls this per image while the operator is sorting them, so the review grid
// shows exactly what will print.
router.post("/prepare-image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error("No image was uploaded."), { status: 400 });
    }
    if (req.body.kind === "photo") {
      const jpeg = await removePhotoBackground(req.file.buffer);
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(jpeg);
    }
    const png = await cleanSignature(req.file.buffer);
    if (!png) {
      throw Object.assign(new Error("No signature could be found in this image."), { status: 422 });
    }
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// The list of agencies the client can offer in the brand picker.
router.get("/brands", (req, res) => {
  res.json({
    brands: Object.entries(BRANDS).map(([id, { label }]) => ({ id, label })),
  });
});

// Parse the roster alone, without rendering anything. The client needs the
// names up front to draw the assignment grid the operator clicks through.
router.post("/roster", upload.single("roster"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error("Upload a staff spreadsheet (.xlsx or .xls) with Name and Role columns."), {
        status: 400,
      });
    }
    const { columns, rows, dropped } = parseIdCardRows(req.file.buffer);
    res.json({ columns, rows, droppedRows: dropped });
  } catch (err) {
    next(err);
  }
});

router.post("/preview", uploadFields, async (req, res, next) => {
  try {
    const { columns, rows, dropped, entries, template, uploadedCount, brand } = parseRequest(req);

    // The operator can ask to preview any row (clicking a name in the roster);
    // default to the first one that actually has a photo, so the first preview
    // shows a finished card rather than a placeholder.
    const requested = Number.parseInt(req.body.previewIndex, 10);
    const index = Number.isInteger(requested) && entries[requested]
      ? requested
      : Math.max(0, entries.findIndex((e) => e.photoFile));
    const [png] = await renderCards(template, [entries[index]], { brand });

    res.json({
      columns,
      rowCount: rows.length,
      droppedRows: dropped,
      photosUploaded: uploadedCount,
      photosMatched: entries.filter((e) => e.photoFile).length,
      signaturesMatched: entries.filter((e) => e.signatureFile).length,
      previewIndex: index,
      previewName: entries[index].row.Name,
      template,
      brand,
      previewImage: `data:image/png;base64,${png.toString("base64")}`,
    });
  } catch (err) {
    next(err);
  }
});

// One card as a plain PNG, for saving a single file without going through a zip.
router.post("/card", uploadFields, async (req, res, next) => {
  try {
    const { entries, template, brand } = parseRequest(req);
    const index = Number.parseInt(req.body.previewIndex, 10);
    const entry = Number.isInteger(index) ? entries[index] : null;
    if (!entry) {
      throw Object.assign(new Error("No such employee in the spreadsheet."), { status: 400 });
    }

    const [png] = await renderCards(template, [entry], { brand });
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFileBaseName(entry.row.Name)}.png"`
    );
    res.send(png);
  } catch (err) {
    next(err);
  }
});

router.post("/generate", uploadFields, async (req, res, next) => {
  try {
    const { entries, template, brand } = parseRequest(req);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="id-cards.zip"');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err) => res.destroy(err));
    archive.pipe(res);

    // Render in chunks so memory stays bounded on large rosters, streaming each
    // card into the zip as soon as it's ready rather than holding all in memory.
    const CHUNK = 20;
    const used = new Map();
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const pngs = await renderCards(template, chunk, { brand });
      chunk.forEach((entry, idx) => {
        const base = safeFileBaseName(entry.row.Name);
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const name = count === 0 ? `${base}.png` : `${base}-${count + 1}.png`;
        archive.append(pngs[idx], { name });
      });
    }

    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

export default router;
