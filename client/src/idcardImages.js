import { classifyIdCardImage, prepareIdCardImage } from "./api.js";

// Preparing an uploaded pile of images for the ID card matcher. Classification,
// thumbnailing and face-finding run once per file in the browser, sharing one
// decode; the heavy image clean-up (signature ink, photo backgrounds) is done
// by the server.

const THUMB_MAX = 400; // big enough to identify a face by eye, small enough to be cheap
const SAMPLE = 64; // analysis resolution — detail beyond this doesn't change the answer

/**
 * Skin detection in YCbCr rather than raw RGB. The common RGB rule set is tuned
 * for light skin and misses darker tones badly; the chroma window below holds
 * across the range, because skin varies mostly in luminance, not chroma.
 *
 * A blown-out, warm-toned background (a cream wall behind a phone photo, say)
 * can land in that same chroma window — overexposure crushes it toward white
 * without evening out the warm cast that makes it look skin-like to Cb/Cr
 * alone. Real skin, even under flash, rarely averages this bright, so a
 * brightness ceiling filters out the background without costing real skin.
 */
function isSkin(r, g, b) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const bright = (r + g + b) / 3;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && bright <= 225;
}

/**
 * Find where the face sits, returned as CSS object-position percentages.
 *
 * Skin pixels alone aren't enough — neck, arms and hands are skin too, and their
 * centroid drags the crop down onto the chest. So we find the topmost band with
 * real skin content and take the centroid of just that band, which is the head.
 * Returns null when there's too little skin to be confident, and the caller
 * falls back to a fixed upper-centre default.
 */
function findFace(data, w, h) {
  const rowCounts = new Array(h).fill(0);
  const skin = new Uint8Array(w * h);
  let total = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128 && isSkin(data[i], data[i + 1], data[i + 2])) {
        skin[y * w + x] = 1;
        rowCounts[y] += 1;
        total += 1;
      }
    }
  }

  if (total < w * h * 0.015) return null;

  // First row where skin stops being stray noise.
  const minPerRow = Math.max(2, w * 0.06);
  let top = rowCounts.findIndex((count) => count >= minPerRow);
  if (top < 0) return null;

  // A head occupies roughly the top third of a portrait; bound the band so a
  // torso below can't pull the centroid down.
  const bandEnd = Math.min(h, top + Math.round(h * 0.35));
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = top; y < bandEnd; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (skin[y * w + x]) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }
  if (!count) return null;

  return {
    x: Math.min(85, Math.max(15, ((sumX / count) / w) * 100)),
    y: Math.min(60, Math.max(8, ((sumY / count) / h) * 100)),
  };
}

/**
 * Photo or signature? The server's portrait model answers this reliably ("is
 * there a person in it?"); the brightness heuristic below is only the fallback
 * for when the server can't be reached.
 */
async function detectKind(file, data, width, height) {
  try {
    return await classifyIdCardImage(file);
  } catch {
    return classify(data, SAMPLE * SAMPLE, width / Math.max(1, height));
  }
}

/**
 * Fallback photo-or-signature guess. A signature is ink on paper — overwhelmingly near-white,
 * and usually wider than it is tall. Cheap and roughly right; the operator can
 * flip any wrong guess with one click.
 */
function classify(data, pixels, aspect) {
  let nearWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) nearWhite += 1;
  }
  const whiteRatio = nearWhite / pixels;
  if (whiteRatio > 0.62) return "signature";
  if (whiteRatio > 0.45 && aspect > 1.6) return "signature";
  return "photo";
}

/**
 * A small preview of a prepared image, drawn from the server's full-size result.
 * PNG keeps a signature's transparency; photos are fine as JPEG.
 */
async function blobThumb(blob, type) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, 0.8);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Lift a signature off the paper it was photographed on. This runs on the
 * server (flattening the lighting, removing notebook rules and stray marks,
 * cropping tight and setting a legible stroke weight), so every card in a
 * batch is cleaned the same way. Returns null when nothing could be done, and
 * the caller keeps the original rather than showing a blank.
 */
async function cleanSignature(file) {
  try {
    const blob = await prepareIdCardImage(file, "signature");
    return blob ? { blob, thumb: await blobThumb(blob, "image/png") } : null;
  } catch {
    return null;
  }
}

/**
 * Replace a portrait's background with plain white, using a portrait-matting
 * model on the server. Slower than the rest of the analysis (about a second a
 * photo), so it only runs when the operator asks for white backgrounds.
 */
export async function whitenPhoto(file) {
  const blob = await prepareIdCardImage(file, "photo");
  return blob ? { blob, thumb: await blobThumb(blob, "image/jpeg") } : null;
}

async function decode(file) {
  // createImageBitmap decodes off the main thread and honours EXIF rotation, so
  // sideways phone photos come in upright.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

async function analyzeOne(file, forcedKind) {
  const bitmap = await decode(file);
  if (!bitmap) return { name: file.name, kind: "photo", thumb: null, focal: null, unreadable: true };

  try {
    const { width, height } = bitmap;

    // One small canvas for analysis.
    const sample = document.createElement("canvas");
    sample.width = SAMPLE;
    sample.height = SAMPLE;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
    const { data } = sctx.getImageData(0, 0, SAMPLE, SAMPLE);

    // A labelled export is more reliable than image heuristics. For example,
    // a signature photographed on a dark page can look like a portrait to a
    // pixel-only classifier. Operators can upload `Name - Photo.jpg` and
    // `Name - Signature.jpg` together and have the intended type respected.
    const label = normalizeKey(stripExt(file.name));
    const namedKind = label.endsWith("signature") ? "signature" : label.endsWith("photo") ? "photo" : null;
    const kind = forcedKind || namedKind || (await detectKind(file, data, width, height));
    const focal = kind === "photo" ? findFace(data, SAMPLE, SAMPLE) : null;
    const cleaned = kind === "signature" ? await cleanSignature(file) : null;

    // One display-sized thumbnail. The UI never touches the original again, so
    // a pile of 4000px phone photos stops mattering.
    const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = Math.max(1, Math.round(width * scale));
    thumbCanvas.height = Math.max(1, Math.round(height * scale));
    thumbCanvas.getContext("2d").drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);

    return {
      name: file.name,
      kind,
      // Signatures preview as the cleaned cut-out, so the review grid shows
      // what the card will actually print rather than the original snapshot.
      thumb: cleaned ? cleaned.thumb : thumbCanvas.toDataURL("image/jpeg", 0.72),
      cleanedBlob: cleaned ? cleaned.blob : null,
      // Filled in later by whitenPhoto, only if white backgrounds are wanted.
      whiteBackgroundBlob: null,
      whiteBackgroundThumb: null,
      focal,
      unreadable: false,
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Analyze a pile of files with bounded concurrency, reporting progress as it
 * goes. Sequential decoding is what made a large upload feel frozen; four at a
 * time keeps the main thread responsive without thrashing memory.
 */
export async function analyzeFiles(files, onProgress) {
  const results = new Array(files.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < files.length) {
      const index = next;
      next += 1;
      results[index] = await analyzeOne(files[index]);
      done += 1;
      onProgress?.(done, files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return results;
}

/** Re-run analysis for one file with the kind the operator chose by hand. */
export async function reanalyzeAs(file, kind) {
  return analyzeOne(file, kind);
}

export function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function stripExt(name) {
  return String(name || "").replace(/\.[^./\\]+$/, "");
}

export const DEFAULT_FOCAL = { x: 50, y: 32 };
