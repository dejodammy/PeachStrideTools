import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderHtml, safeHtml } from "./templating.js";
import { renderPngBatch } from "./pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CARD_WIDTH = 763;
export const CARD_HEIGHT = 1081;

const ASSETS_DIR = path.join(__dirname, "..", "..", "assets");
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "default_idcard.hbs");

// Every agency shares the same card layout (default_idcard.hbs) — only the
// background frame (logos, border, circle style) changes per brand. Add a new
// agency by dropping a blank frame PNG in server/assets and registering it here.
export const BRANDS = {
  fmn: { label: "FMN", framePath: path.join(ASSETS_DIR, "idcard_frame.png") },
  pzwilmar: { label: "PZ Wilmar", framePath: path.join(ASSETS_DIR, "idcard_frame_pzwilmar.png") },
  peachstrides: {
    label: "Peachstrides & Pristine",
    framePath: path.join(ASSETS_DIR, "idcard_frame_peachstrides.png"),
    templatePath: path.join(__dirname, "..", "..", "templates", "peachstrides_idcard.hbs"),
    width: 591,
    height: 1004,
  },
};
export const DEFAULT_BRAND = "fmn";

export function resolveBrand(value) {
  return BRANDS[value] ? value : DEFAULT_BRAND;
}

const frameDataUriCache = new Map();
function getFrameDataUri(brand) {
  if (!frameDataUriCache.has(brand)) {
    const bytes = fs.readFileSync(BRANDS[brand].framePath);
    frameDataUriCache.set(brand, `data:image/png;base64,${bytes.toString("base64")}`);
  }
  return frameDataUriCache.get(brand);
}

export function readDefaultIdCardTemplate(brand = DEFAULT_BRAND) {
  const templatePath = BRANDS[resolveBrand(brand)].templatePath || DEFAULT_TEMPLATE_PATH;
  return fs.readFileSync(templatePath, "utf8");
}

function getCardSize(brand) {
  const definition = BRANDS[resolveBrand(brand)];
  return { width: definition.width || CARD_WIDTH, height: definition.height || CARD_HEIGHT };
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stripExt(filename) {
  return String(filename || "").replace(/\.[^./\\]+$/, "");
}

/**
 * Match one row to an uploaded file: first by an explicit filename named in
 * `columnValue` (e.g. the row's "Photo" column), falling back to matching the
 * file's name against the row's Name column. Returns the matched file or null.
 */
export function matchFile(row, files, columnValue) {
  if (!files || files.length === 0) return null;

  const explicit = columnValue ? String(columnValue).trim() : "";
  if (explicit) {
    const target = normalize(stripExt(explicit));
    const found = files.find((f) => normalize(stripExt(f.originalname)) === target);
    if (found) return found;
  }

  if (row.Name) {
    const target = normalize(row.Name);
    const found = files.find((f) => normalize(stripExt(f.originalname)) === target);
    if (found) return found;
  }

  return null;
}

function toDataUri(file) {
  if (!file) return null;
  return safeHtml(`data:${file.mimetype || "image/jpeg"};base64,${file.buffer.toString("base64")}`);
}

/**
 * Build the per-row template context: the row's own columns plus resolved
 * photo/signature data URIs and a background frame data URI.
 */
export function buildCardContext(row, { photoFile, signatureFile, focal, brand = DEFAULT_BRAND } = {}) {
  return {
    ...row,
    FrameDataUri: safeHtml(getFrameDataUri(resolveBrand(brand))),
    PhotoDataUri: toDataUri(photoFile),
    SignatureDataUri: toDataUri(signatureFile),
    // Where the face sits in the photo, as a percentage, fed straight to CSS
    // object-position. Defaults bias upward: in an uncropped portrait the head
    // is above centre, so 50/50 tends to frame the chest.
    PhotoFocusX: focal?.x ?? 50,
    PhotoFocusY: focal?.y ?? 32,
  };
}

/**
 * Render one card's HTML (for a single preview) or a batch (for the full
 * generate step). `entries` is an array of { row, photoFile, signatureFile, focal }.
 * Returns an array of PNG buffers, same order as `entries`.
 */
export async function renderCards(template, entries, { brand = DEFAULT_BRAND } = {}) {
  const htmls = entries.map(({ row, photoFile, signatureFile, focal }) =>
    renderHtml(template, buildCardContext(row, { photoFile, signatureFile, focal, brand }))
  );
  return renderPngBatch(htmls, getCardSize(brand));
}

export function safeFileBaseName(value) {
  return (
    String(value || "card")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .slice(0, 80) || "card"
  );
}
