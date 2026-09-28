// Preparing raw staff images for an ID card: lifting a signature off the
// notebook page it was photographed on, and replacing a portrait's background
// with plain white. Both run on the server so every card in a batch gets the
// same treatment, whatever browser the operator happens to use.
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import * as ort from "onnxruntime-node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// MODNet portrait matting (Apache-2.0), exported to ONNX. It predicts a soft
// alpha matte for the person, hair included, which a colour-threshold flood
// fill cannot do: a bright cheek or a white shirt looks exactly like a white wall.
const MODEL_PATH = path.join(__dirname, "..", "..", "assets", "models", "modnet.onnx");
const MODEL_SIZE = 512;

let sessionPromise = null;
function getSession() {
  sessionPromise ||= ort.InferenceSession.create(MODEL_PATH).catch((err) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Replace everything behind the person with white and frame them with room
 * above the head. Returns a square JPEG buffer.
 */
export async function removePhotoBackground(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // MODNet wants each side a multiple of 32, around 512 on the long side.
  const scale = MODEL_SIZE / Math.max(width, height);
  const mw = Math.max(32, Math.round((width * scale) / 32) * 32);
  const mh = Math.max(32, Math.round((height * scale) / 32) * 32);
  const small = await sharp(data, { raw: { width, height, channels: 3 } })
    .resize(mw, mh, { fit: "fill" })
    .raw()
    .toBuffer();

  const plane = mw * mh;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p += 1) {
    for (let c = 0; c < 3; c += 1) input[c * plane + p] = small[p * 3 + c] / 127.5 - 1;
  }
  const session = await getSession();
  const result = await session.run({ input: new ort.Tensor("float32", input, [1, 3, mh, mw]) });
  const matte = result[session.outputNames[0]].data;

  // The matte is soft everywhere, which is right for hair but leaves clothing
  // and walls faintly see-through. Pull the tails in so the person is solid
  // and the background is gone, keeping the gradient only at real edges.
  const small8 = Buffer.alloc(plane);
  for (let p = 0; p < plane; p += 1) small8[p] = Math.round(clamp01((matte[p] - 0.08) / 0.8) * 255);

  // Keep only the person: the model sometimes leaves loose islands (a shadow
  // on the wall, the edge of a printed photo). Each island is judged by its
  // solid core; the largest one, and anything nearly as big, survives, and
  // the soft fringe around a dropped island goes with it.
  const solid = new Uint8Array(plane);
  for (let p = 0; p < plane; p += 1) solid[p] = small8[p] > 128 ? 1 : 0;
  const islands = label(solid, mw, mh);
  if (islands.count > 1) {
    let biggest = 1;
    for (let l = 2; l <= islands.count; l += 1) if (islands.areas[l] > islands.areas[biggest]) biggest = l;
    const keepIsland = new Uint8Array(islands.count + 1);
    for (let l = 1; l <= islands.count; l += 1) {
      if (islands.areas[l] >= islands.areas[biggest] * 0.25) keepIsland[l] = 1;
    }
    const kept = new Float32Array(plane);
    for (let p = 0; p < plane; p += 1) kept[p] = keepIsland[islands.labels[p]] ? 1 : 0;
    // Allow the soft edge within a few pixels of a kept island.
    const near = maxFilter(kept, mw, mh, 4);
    for (let p = 0; p < plane; p += 1) if (!near[p]) small8[p] = 0;
  }

  // Fill holes: glare on a forehead or a white shirt patch can read as
  // background, punching a white spot into the person. Real background always
  // reaches the photo's edge; anything enclosed by the person is the person.
  {
    const clear = new Uint8Array(plane);
    for (let p = 0; p < plane; p += 1) clear[p] = small8[p] < 128 ? 1 : 0;
    const regions = label(clear, mw, mh);
    const outside = new Uint8Array(regions.count + 1);
    for (let x = 0; x < mw; x += 1) {
      outside[regions.labels[x]] = 1;
      outside[regions.labels[(mh - 1) * mw + x]] = 1;
    }
    for (let y = 0; y < mh; y += 1) {
      outside[regions.labels[y * mw]] = 1;
      outside[regions.labels[y * mw + mw - 1]] = 1;
    }
    for (let p = 0; p < plane; p += 1) {
      const l = regions.labels[p];
      if (l && !outside[l]) small8[p] = 255;
    }
  }
  const alpha = await sharp(small8, { raw: { width: mw, height: mh, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "cubic" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const out = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p += 1) {
    const a = alpha[p] / 255;
    for (let c = 0; c < 3; c += 1) {
      out[p * 3 + c] = Math.round(data[p * 3 + c] * a + 255 * (1 - a));
    }
  }
  return frameForCard(out, alpha, width, height);
}

// Headroom above the top of the head, as a share of the framed photo's height.
const HEADROOM = 0.08;

/**
 * Reframe a white-background portrait as a square with the head a fixed
 * distance from the top. Phone portraits are often cropped right at the hair,
 * and the card's photo box then trims that last sliver off the head; with the
 * background now plain white we can simply add the missing headroom. A square
 * fits every card design (Peachstrides' near-square box, FMN's circle) without
 * any vertical cropping. Excess headroom (a person small in a tall shot) is
 * trimmed the same way, so faces come out a consistent size.
 */
async function frameForCard(rgb, alpha, width, height) {
  const encode = (img) => img.jpeg({ quality: 93 }).toBuffer();
  const raw = { raw: { width, height, channels: 3 } };

  // Top of the head: the first row with a real run of person pixels, so a
  // stray fleck of hair or matte noise doesn't count.
  const minRun = Math.max(3, Math.round(width * 0.02));
  let top = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > 128) {
        count += 1;
        if (top >= 0 || count >= minRun) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (top < 0 && count >= minRun) top = y;
  }
  if (top < 0) return encode(sharp(rgb, raw));

  // Square side: the full width, unless there isn't enough photo below the
  // head to fill it, in which case the sides are trimmed around the person.
  const below = height - top;
  let side = Math.min(width, Math.floor(below / (1 - HEADROOM)));
  side = Math.max(1, side);
  const pad = Math.round(side * HEADROOM);
  const centre = Math.round((left + right) / 2);
  const x0 = Math.min(Math.max(0, centre - Math.floor(side / 2)), width - side);
  // Rows above the head that already exist in the photo, and white to add.
  const srcTop = Math.max(0, top - pad);
  const addTop = pad - (top - srcTop);
  const srcHeight = Math.min(height - srcTop, side - addTop);

  let img = sharp(rgb, raw).extract({ left: x0, top: srcTop, width: side, height: srcHeight });
  const addBottom = side - addTop - srcHeight;
  if (addTop > 0 || addBottom > 0) {
    img = sharp(await img.raw().toBuffer(), { raw: { width: side, height: srcHeight, channels: 3 } }).extend({
      top: Math.max(0, addTop),
      bottom: Math.max(0, addBottom),
      background: { r: 255, g: 255, b: 255 },
    });
  }
  return encode(img);
}

const CLASSIFY_SIZE = 256;

/**
 * Photo or signature? Asks the portrait model whether there is a person in the
 * frame, rather than guessing from brightness: a signature on grey, shadowed
 * or coloured paper looks nothing like "mostly white", but it never contains a
 * person. Only the centre of the frame is counted, because screenshots with
 * dark rounded corners can fool the model at the edges. Across 62 labelled
 * staff images, photos scored 0.37 or more and signatures 0.20 or less.
 */
export async function classifyImage(buffer) {
  const S = CLASSIFY_SIZE;
  const data = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(S, S, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const input = new Float32Array(3 * S * S);
  for (let p = 0; p < S * S; p += 1) {
    for (let c = 0; c < 3; c += 1) input[c * S * S + p] = data[p * 3 + c] / 127.5 - 1;
  }
  const session = await getSession();
  const result = await session.run({ input: new ort.Tensor("float32", input, [1, 3, S, S]) });
  const matte = result[session.outputNames[0]].data;
  const border = Math.round(S * 0.12);
  let person = 0;
  let total = 0;
  for (let y = border; y < S - border; y += 1) {
    for (let x = border; x < S - border; x += 1) {
      total += 1;
      if (matte[y * S + x] > 0.5) person += 1;
    }
  }
  return person / total >= 0.3 ? "photo" : "signature";
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const SIG_WORK = 1600; // working resolution; thin pen strokes survive at this size
const SIG_MIN_WORK = 1000; // smaller images are enlarged to this first
const SIG_OUT_W = 1000; // output fits this box (the card's slot is ~3.5:1)
const SIG_OUT_H = 280;
// Stroke width bounds in output pixels. Too thin and the ink breaks up once the
// card is printed; too thick (a small or blurry signature blown up) and loops
// fill in and the signature turns into a blot.
const MIN_STROKE = 6;
const MAX_STROKE = 10;

/** Sliding-window maximum over rows then columns (a square grey dilation). */
function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const q = new Int32Array(Math.max(w, h));
  const pass = (read, write, len, lines, stride, stepLine) => {
    for (let line = 0; line < lines; line += 1) {
      const base = line * stepLine;
      let head = 0;
      let tail = 0;
      for (let i = 0; i < len + r; i += 1) {
        if (i < len) {
          const v = read[base + i * stride];
          while (tail > head && read[base + q[tail - 1] * stride] <= v) tail -= 1;
          q[tail] = i;
          tail += 1;
        }
        const centre = i - r;
        if (centre >= 0) {
          while (q[head] < centre - r) head += 1;
          write[base + centre * stride] = read[base + q[head] * stride];
        }
      }
    }
  };
  pass(src, tmp, w, h, 1, w);
  pass(tmp, out, h, w, w, 1);
  return out;
}

/** Separable box blur with clamped edges. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = r * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x += 1) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Hue of an ink as the share of red, green and blue light it absorbs. Unlike
 * raw RGB this barely changes between a heavy and a light stroke of the same
 * pen, so it separates "blue rule vs. black ink" without being fooled by
 * "faint vs. firm pressure".
 */
function hue([r, g, b]) {
  const a = [1 - r, 1 - g, 1 - b].map((v) => Math.max(0.01, v));
  const sum = a[0] + a[1] + a[2];
  return a.map((v) => v / sum);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/** Sliding-window minimum: a grey erosion. */
function minFilter(src, w, h, r) {
  const neg = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 1) neg[i] = -src[i];
  const out = maxFilter(neg, w, h, r);
  for (let i = 0; i < out.length; i += 1) out[i] = -out[i];
  return out;
}

function transpose(src, w, h) {
  const out = new src.constructor(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[x * h + y] = src[y * w + x];
  return out;
}

/** Otsu's threshold over values in [0, 1]. */
function otsu(values, count) {
  const bins = 256;
  const hist = new Float64Array(bins);
  for (let i = 0; i < count; i += 1) hist[Math.min(bins - 1, Math.floor(values[i] * bins))] += 1;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < bins; i += 1) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = 0;
  for (let i = 0; i < bins; i += 1) {
    wB += hist[i];
    if (!wB || wB === total) continue;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / (total - wB);
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return (threshold + 0.5) / bins;
}

/** 8-connected component labels. Returns { labels, count, areas }. */
function label(mask, w, h) {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const areas = [0];
  let count = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    count += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = count;
    let area = 0;
    while (head < tail) {
      const p = queue[head++];
      area += 1;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (mask[n] && !labels[n]) {
            labels[n] = count;
            queue[tail++] = n;
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, count, areas };
}

/**
 * Find ruled lines running (roughly) left to right and mark the pixels that
 * belong to the rule rather than to handwriting.
 *
 * A notebook rule is long, thin and runs nearly the whole width of the photo,
 * though it can be tilted and gently curved where the page bends. Handwriting
 * strokes are sometimes long and straight too (a flourish underline), but they
 * don't cross the page edge to edge. So: a coarse Hough pass proposes straight
 * candidates within ±12°, each is then followed in short segments allowing
 * a slow drift, and only those traced across most of the width are rules.
 *
 * A dense scribble can also trace edge to edge, so a candidate must also look
 * unlike the signature: lighter than the ink or a different colour (blue
 * rules under black ink, a red margin). Only a line that is both unbroken and
 * genuinely full-width is taken as a rule when it matches the ink exactly.
 *
 * Where a stroke crosses the rule, the ink is kept: a crossing either makes
 * the ink run thicker than the rule, or it continues past it on both sides,
 * and either way it is noticeably darker than the rule itself.
 */
function findHorizontalRules(mask, dark, norm, w, h, ink) {
  const remove = new Uint8Array(w * h);
  const angles = [];
  for (let deg = -12; deg <= 12; deg += 0.5) angles.push(Math.tan((deg * Math.PI) / 180));
  const pad = Math.ceil(w * Math.tan((12 * Math.PI) / 180)) + 2;
  const rhoSize = h + 2 * pad;
  const acc = new Int32Array(angles.length * rhoSize);

  // Subsample columns for the vote; a rule spans the width, so every other
  // column still carries it.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 2) {
      if (!mask[y * w + x]) continue;
      for (let a = 0; a < angles.length; a += 1) {
        const rho = Math.round(y - x * angles[a]) + pad;
        acc[a * rhoSize + rho] += 1;
      }
    }
  }

  // Best angle for each rho, then local maxima along rho.
  const best = new Int32Array(rhoSize);
  const bestAngle = new Int32Array(rhoSize);
  for (let rho = 0; rho < rhoSize; rho += 1) {
    for (let a = 0; a < angles.length; a += 1) {
      const v = acc[a * rhoSize + rho];
      if (v > best[rho]) {
        best[rho] = v;
        bestAngle[rho] = a;
      }
    }
  }
  const minVotes = (w / 2) * 0.2;
  const candidates = [];
  for (let rho = 0; rho < rhoSize; rho += 1) {
    if (best[rho] < minVotes) continue;
    let isPeak = true;
    for (let d = -6; d <= 6 && isPeak; d += 1) {
      const n = rho + d;
      if (d && n >= 0 && n < rhoSize && (best[n] > best[rho] || (best[n] === best[rho] && d < 0))) isPeak = false;
    }
    if (isPeak) candidates.push({ rho: rho - pad, slope: angles[bestAngle[rho]] });
  }

  const SEG = 24;
  const segments = Math.ceil(w / SEG);
  const lines = [];
  for (const { rho, slope } of candidates) {
    // Trace from the best-supported segment outwards in both directions, so a
    // gap at one end can't derail the whole trace.
    const centre = new Float32Array(segments);
    const cover = new Float32Array(segments);
    const coverAt = (s, offset) => {
      let hit = 0;
      let n = 0;
      for (let x = s * SEG; x < Math.min(w, (s + 1) * SEG); x += 1) {
        const y = Math.round(rho + x * slope + offset);
        n += 1;
        if (y < 1 || y >= h - 1) continue;
        if (mask[y * w + x] || mask[(y - 1) * w + x] || mask[(y + 1) * w + x]) hit += 1;
      }
      return n ? hit / n : 0;
    };
    const bestOffset = (s, around, span) => {
      let bo = around;
      let bc = -1;
      for (let o = around - span; o <= around + span; o += 1) {
        const c = coverAt(s, o) - Math.abs(o - around) * 0.01;
        if (c > bc) {
          bc = c;
          bo = o;
        }
      }
      return { offset: bo, cover: coverAt(s, bo) };
    };
    let seed = 0;
    let seedCover = -1;
    for (let s = 0; s < segments; s += 1) {
      const c = coverAt(s, 0);
      if (c > seedCover) {
        seedCover = c;
        seed = s;
      }
    }
    if (seedCover < 0.4) continue;
    for (const dir of [1, -1]) {
      let offset = 0;
      for (let s = seed; s >= 0 && s < segments; s += dir) {
        if (dir === -1 && s === seed) continue;
        const r = bestOffset(s, offset, 2);
        // Only let the trace drift where it actually found the line.
        if (r.cover >= 0.4) offset = r.offset;
        centre[s] = offset;
        cover[s] = r.cover;
      }
    }
    let covered = 0;
    let first = -1;
    let last = -1;
    for (let s = 0; s < segments; s += 1) {
      if (cover[s] >= 0.4) {
        covered += 1;
        if (first < 0) first = s;
        last = s;
      }
    }
    const spanFrac = ((last - first + 1) * SEG) / w;
    const coverFrac = covered / segments;
    if (first < 0 || spanFrac < 0.4 || coverFrac < 0.2) continue;

    // The candidate's typical thickness, darkness and colour.
    const runs = [];
    const darks = [];
    const colour = [[], [], []];
    const runAt = (x) => {
      const s = Math.min(segments - 1, Math.floor(x / SEG));
      const yc = Math.round(rho + x * slope + centre[s]);
      let y0 = -1;
      for (const d of [0, -1, 1, -2, 2]) {
        const y = yc + d;
        if (y >= 0 && y < h && mask[y * w + x]) {
          y0 = y;
          break;
        }
      }
      if (y0 < 0) return null;
      let top = y0;
      let bottom = y0;
      while (top > 0 && mask[(top - 1) * w + x]) top -= 1;
      while (bottom < h - 1 && mask[(bottom + 1) * w + x]) bottom += 1;
      return { top, bottom };
    };
    for (let x = 0; x < w; x += 1) {
      const run = runAt(x);
      if (!run) continue;
      runs.push(run.bottom - run.top + 1);
      let sum = 0;
      for (let y = run.top; y <= run.bottom; y += 1) sum += dark[y * w + x];
      darks.push(sum / (run.bottom - run.top + 1));
      const mid = ((run.top + run.bottom) >> 1) * w + x;
      for (let c = 0; c < 3; c += 1) colour[c].push(norm[c][mid]);
    }
    if (!runs.length) continue;
    const thick = median(runs);
    const lineDark = median(darks);
    const lineColour = colour.map(median);
    const hueDist = Math.hypot(...hue(lineColour).map((v, c) => v - ink.hue[c]));
    // Printed rules are hairlines; a "line" as thick as a marker stroke is ink.
    const thin = thick <= Math.max(12, Math.round(h * 0.012));
    const otherHue = hueDist > 0.12;
    const lighter = lineDark < ink.dark * 0.62;
    const unbroken = spanFrac >= 0.92 && coverFrac >= 0.85;
    const accept =
      thin &&
      (unbroken ||
        // A different colour from the signature is proof enough, even for a
        // rule that only shows in fragments (faint at one side of the page).
        otherHue ||
        (lighter && spanFrac >= 0.72 && coverFrac >= 0.45));
    if (!accept) continue;
    lines.push({ rho, slope, centre, runAt, thick, lineDark, lineHue: otherHue ? hue(lineColour) : null });
  }

  for (const { runAt, thick, lineDark, lineHue } of lines) {
    const maxThick = Math.max(thick * 1.7, thick + 3);
    // A pixel is ink rather than rule when it is clearly darker than the rule.
    const inkLevel = Math.max(lineDark * 1.35 + 0.04, (lineDark + ink.dark) / 2);

    for (let x = 0; x < w; x += 1) {
      const run = runAt(x);
      if (!run) continue;
      const { top, bottom } = run;
      if (bottom - top + 1 > maxThick) continue; // a stroke lies across or along the rule here
      // Ink continuing past the rule on both sides (diagonally) is a crossing.
      let above = false;
      let below = false;
      for (let dx = -3; dx <= 3; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        for (let dy = 2; dy <= 3; dy += 1) {
          if (top - dy >= 0 && mask[(top - dy) * w + nx]) above = true;
          if (bottom + dy < h && mask[(bottom + dy) * w + nx]) below = true;
        }
      }
      // At a crossing, strip only the rule-coloured part around the stroke.
      // Elsewhere a dark spot on the rule is just the rule (a blot, a crease).
      const keepAbove = above && below ? inkLevel * 0.85 : Infinity;
      for (let y = top; y <= bottom; y += 1) {
        if (dark[y * w + x] > keepAbove) continue;
        // On a rule of a different colour, a pixel that looks like the
        // signature's pen rather than the rule is ink crossing it: keep it,
        // however faint.
        if (lineHue) {
          const p = y * w + x;
          const px = hue([norm[0][p], norm[1][p], norm[2][p]]);
          const toInk = Math.hypot(px[0] - ink.hue[0], px[1] - ink.hue[1], px[2] - ink.hue[2]);
          const toLine = Math.hypot(px[0] - lineHue[0], px[1] - lineHue[1], px[2] - lineHue[2]);
          if (toInk < toLine) continue;
        }
        remove[y * w + x] = 1;
      }
    }
  }
  return { remove, count: lines.length };
}

/**
 * Remove marks that belong to the photo's border rather than the page:
 * screenshot corners, a frame, the table around the sheet. They touch the edge
 * and lie almost entirely in the outer band. Taking them out before anything
 * measures "the ink" stops a black corner being mistaken for the pen.
 */
function dropBorderMarks(mask, w, h) {
  const { labels, count, areas } = label(mask, w, h);
  const inMargin = new Int32Array(count + 1);
  const touches = new Uint8Array(count + 1);
  const mx = Math.round(w * 0.08);
  const my = Math.round(h * 0.08);
  for (let p = 0; p < mask.length; p += 1) {
    const l = labels[p];
    if (!l) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches[l] = 1;
    if (x < mx || x >= w - mx || y < my || y >= h - my) inMargin[l] += 1;
  }
  for (let p = 0; p < mask.length; p += 1) {
    const l = labels[p];
    if (l && touches[l] && inMargin[l] > areas[l] * 0.7) mask[p] = 0;
  }
}

/**
 * Lift a photographed signature off its paper: flatten the lighting, find the
 * ink, strip ruled lines, drop stray marks, crop tight, and re-draw it as solid
 * ink on transparency, thick enough to stay legible at card size.
 *
 * Returns a PNG buffer, or null when no signature could be found (the caller
 * then falls back to the untouched upload).
 */
export async function cleanSignature(buffer, { debug = false } = {}) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(async (decoded) => {
      // Work at a consistent size: shrink big photos, and enlarge small ones
      // (a cropped screenshot can be ~250px) so every size-based setting
      // below behaves the same on both.
      const { width: iw, height: ih } = decoded.info;
      const longSide = Math.max(iw, ih);
      const target = longSide > SIG_WORK ? SIG_WORK : longSide < SIG_MIN_WORK ? SIG_MIN_WORK : longSide;
      if (target === longSide) return decoded;
      return sharp(decoded.data, { raw: { width: iw, height: ih, channels: 3 } })
        .resize({ width: target, height: target, fit: "inside", kernel: "cubic" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    });
  const { width: w, height: h } = info;
  const n = w * h;

  // 1. Paper estimate per channel. A max filter wider than any pen stroke
  //    erases the ink, then a blur smooths the blockiness. Dividing by it
  //    turns grey, tinted, shadowed or blue-lit paper into flat white, so
  //    the same thresholds work on every photo.
  const radius = Math.max(8, Math.round(Math.max(w, h) / 45));
  const norm = [0, 1, 2].map((c) => {
    const ch = new Float32Array(n);
    for (let p = 0; p < n; p += 1) ch[p] = data[p * 3 + c];
    // A grey closing: the max filter erases anything thinner than the
    // window (ink), the min filter then shrinks the result back so it hugs
    // shadows and page edges instead of bleeding brightness into them. The
    // pre-smoothing stops it latching onto the brightest noise speck.
    const smooth = boxBlur(ch, w, h, 2);
    const closed = minFilter(maxFilter(smooth, w, h, radius), w, h, radius);
    const paper = boxBlur(closed, w, h, Math.max(2, Math.round(radius / 3)));
    const out = new Float32Array(n);
    for (let p = 0; p < n; p += 1) out[p] = Math.min(1, ch[p] / Math.max(8, paper[p]));
    return out;
  });
  const dark = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    // Darkness uses the darkest channel too, so saturated ink (a blue pen on
    // blue-lit paper) registers as strongly as black ink does.
    const lum = 0.299 * norm[0][p] + 0.587 * norm[1][p] + 0.114 * norm[2][p];
    const minC = Math.min(norm[0][p], norm[1][p], norm[2][p]);
    dark[p] = clamp01(1 - (lum * 0.6 + minC * 0.4));
  }

  // 2. Ink mask by hysteresis: strong pixels seed the strokes, weaker pixels
  //    connected to them carry the faint tail of each stroke along.
  const sample = new Float32Array(n);
  let sampleCount = 0;
  for (let p = 0; p < n; p += 1) if (dark[p] > 0.05) sample[sampleCount++] = dark[p];
  if (sampleCount < 50) return null;
  const hi = Math.max(0.16, otsu(sample, sampleCount));
  const lo = Math.max(0.08, hi * 0.5);
  const hysteresis = (excluded) => {
    const weak = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) weak[p] = dark[p] > lo && !(excluded && excluded[p]) ? 1 : 0;
    const { labels, count } = label(weak, w, h);
    const seeded = new Uint8Array(count + 1);
    for (let p = 0; p < n; p += 1) if (weak[p] && dark[p] > hi) seeded[labels[p]] = 1;
    const out = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) out[p] = labels[p] && seeded[labels[p]] ? 1 : 0;
    return out;
  };
  const mask = hysteresis(null);
  dropBorderMarks(mask, w, h);


  // 3. Ruled lines, horizontal then vertical (margins, graph paper). They are
  //    judged against the signature's own ink: its darkest tenth of pixels.
  const inkDarks = [];
  for (let p = 0; p < n; p += 1) if (mask[p]) inkDarks.push(dark[p]);
  inkDarks.sort((a, b) => a - b);
  const inkDark = inkDarks[Math.floor(inkDarks.length * 0.9)] || hi;
  const inkRef = { dark: inkDark, colour: [[], [], []] };
  for (let p = 0; p < n; p += 1) {
    if (mask[p] && dark[p] >= inkDark * 0.85) for (let c = 0; c < 3; c += 1) inkRef.colour[c].push(norm[c][p]);
  }
  inkRef.colour = inkRef.colour.map(median);
  inkRef.hue = hue(inkRef.colour);
  const horizontal = findHorizontalRules(mask, dark, norm, w, h, inkRef);
  // Vertical rules are looked for with the horizontal ones already gone, so a
  // margin line doesn't mistake every rule it meets for a crossing stroke.
  const afterHorizontal = mask.slice();
  for (let p = 0; p < n; p += 1) if (horizontal.remove[p]) afterHorizontal[p] = 0;
  const vertical = findHorizontalRules(
    transpose(afterHorizontal, w, h),
    transpose(dark, w, h),
    norm.map((c) => transpose(c, w, h)),
    h,
    w,
    inkRef
  );
  const vRemove = transpose(vertical.remove, h, w);
  // Re-run the hysteresis without the rules: faint shading (a crumple, a
  // shadow) that only qualified because it touched a dark rule falls away.
  const ruled = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) ruled[p] = horizontal.remove[p] || vRemove[p] ? 1 : 0;
  mask.set(hysteresis(ruled));
  dropBorderMarks(mask, w, h);

  // 4. Stray marks. Drop specks and rule fragments left behind; then group what
  //    remains into clusters (nearby strokes belong together) and keep the
  //    cluster with the most ink, plus any cluster of comparable weight.
  const diag = Math.hypot(w, h);
  {
    const { labels, count, areas } = label(mask, w, h);
    const minArea = Math.max(12, (diag / 350) ** 2);
    // A thin sliver aligned with the page axes that survived rule removal.
    const minX = new Int32Array(count + 1).fill(w);
    const maxX = new Int32Array(count + 1).fill(-1);
    const minY = new Int32Array(count + 1).fill(h);
    const maxY = new Int32Array(count + 1).fill(-1);
    for (let p = 0; p < n; p += 1) {
      const l = labels[p];
      if (!l) continue;
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX[l]) minX[l] = x;
      if (x > maxX[l]) maxX[l] = x;
      if (y < minY[l]) minY[l] = y;
      if (y > maxY[l]) maxY[l] = y;
    }
    const drop = new Uint8Array(count + 1);
    for (let l = 1; l <= count; l += 1) {
      const bw = maxX[l] - minX[l] + 1;
      const bh = maxY[l] - minY[l] + 1;
      const sliver = (bh <= 6 && bw > bh * 8) || (bw <= 6 && bh > bw * 8);
      // Page edges and letterbox bars: hug a border of the photo along most
      // of its length. A signature running off the edge doesn't do that.
      const edgeBar =
        ((minY[l] <= 1 || maxY[l] >= h - 2) && bw > w * 0.5 && bh < h * 0.12) ||
        ((minX[l] <= 1 || maxX[l] >= w - 2) && bh > h * 0.5 && bw < w * 0.12);
      if (areas[l] < minArea || edgeBar || (sliver && areas[l] < diag * 0.05 * 6)) drop[l] = 1;
    }
    for (let p = 0; p < n; p += 1) if (drop[labels[p]]) mask[p] = 0;
  }

  const gap = Math.max(6, Math.round(diag * 0.025));
  const grown = maxFilter(Float32Array.from(mask), w, h, gap);
  const grownMask = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) grownMask[p] = grown[p] > 0 ? 1 : 0;
  const clusters = label(grownMask, w, h);
  // People frame a signature near the middle of the shot; shadows, page
  // edges and crumples crowd the borders. So a cluster's ink counts for more
  // the closer it sits to the centre, and one touching the photo's edge is
  // kept only if it carries a real share of the ink.
  const mass = new Float64Array(clusters.count + 1);
  const sx = new Float64Array(clusters.count + 1);
  const sy = new Float64Array(clusters.count + 1);
  const touches = new Uint8Array(clusters.count + 1);
  const extent = new Float64Array(clusters.count + 1);
  const inked = new Float64Array(clusters.count + 1);
  for (let p = 0; p < n; p += 1) {
    const l = clusters.labels[p];
    if (!l) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches[l] = 1;
    extent[l] += 1;
    if (!mask[p]) continue;
    inked[l] += 1;
    mass[l] += dark[p];
    sx[l] += x * dark[p];
    sy[l] += y * dark[p];
  }
  const score = new Float64Array(clusters.count + 1);
  let main = 0;
  for (let l = 1; l <= clusters.count; l += 1) {
    if (!mass[l]) continue;
    const dx = sx[l] / mass[l] / w - 0.5;
    const dy = sy[l] / mass[l] / h - 0.5;
    // Pen strokes cover a small share of the area they span; texture beyond
    // the page (gravel, a patterned table, fabric) covers much more of it.
    const textured = touches[l] && inked[l] / extent[l] > 0.3;
    score[l] = mass[l] * Math.exp(-((dx / 0.3) ** 2 + (dy / 0.3) ** 2)) * (textured ? 0.05 : touches[l] ? 0.5 : 1);
    if (score[l] > score[main]) main = l;
  }
  if (!main || mass[main] < 20) return null;
  // Other clusters must also look like the same pen as the main one: same
  // hue, and comparably dark. Paper shading is neutral grey and light.
  const clusterColour = new Map();
  const clusterDark = new Map();
  for (let p = 0; p < n; p += 1) {
    const l = clusters.labels[p];
    if (!mask[p] || !l) continue;
    if (!clusterColour.has(l)) {
      clusterColour.set(l, [[], [], []]);
      clusterDark.set(l, []);
    }
    const cc = clusterColour.get(l);
    for (let c = 0; c < 3; c += 1) cc[c].push(norm[c][p]);
    clusterDark.get(l).push(dark[p]);
  }
  const peak = (arr) => Float64Array.from(arr).sort()[Math.floor(arr.length * 0.9)];
  const mainHue = hue(clusterColour.get(main).map(median));
  const mainPeak = peak(clusterDark.get(main));
  const keep = new Uint8Array(clusters.count + 1);
  for (let l = 1; l <= clusters.count; l += 1) {
    if (l === main) {
      keep[l] = 1;
      continue;
    }
    if (!clusterColour.has(l)) continue;
    const samePen =
      Math.hypot(...hue(clusterColour.get(l).map(median)).map((v, c) => v - mainHue[c])) < 0.1 &&
      peak(clusterDark.get(l)) >= mainPeak * 0.6;
    if (samePen && score[l] >= score[main] * 0.3 && (!touches[l] || mass[l] >= mass[main] * 0.6)) keep[l] = 1;
  }

  for (let p = 0; p < n; p += 1) if (mask[p] && !keep[clusters.labels[p]]) mask[p] = 0;

  // Within what is left, every sizeable stroke must share the hue and weight
  // of the most central, heaviest stroke. That catches paper shading that sits right next
  // to the signature (a crumple, a thumb shadow), which clustering can't.
  {
    const parts = label(mask, w, h);
    const pMass = new Float64Array(parts.count + 1);
    const pX = new Float64Array(parts.count + 1);
    const pY = new Float64Array(parts.count + 1);
    const pCol = Array.from({ length: parts.count + 1 }, () => [[], [], []]);
    for (let p = 0; p < n; p += 1) {
      const l = parts.labels[p];
      if (!l) continue;
      const x = p % w;
      const y = (p - x) / w;
      pMass[l] += dark[p];
      pX[l] += x * dark[p];
      pY[l] += y * dark[p];
      for (let c = 0; c < 3; c += 1) pCol[l][c].push(norm[c][p]);
    }
    let core = 0;
    let coreScore = 0;
    for (let l = 1; l <= parts.count; l += 1) {
      const dx = pX[l] / pMass[l] / w - 0.5;
      const dy = pY[l] / pMass[l] / h - 0.5;
      const sc = pMass[l] * Math.exp(-((dx / 0.3) ** 2 + (dy / 0.3) ** 2));
      if (sc > coreScore) {
        coreScore = sc;
        core = l;
      }
    }
    if (core) {
      const coreHue = hue(pCol[core].map(median));
      const coreDark = pMass[core] / parts.areas[core];
      const minArea = Math.max(40, (diag / 150) ** 2);
      const drop = new Uint8Array(parts.count + 1);
      for (let l = 1; l <= parts.count; l += 1) {
        if (l === core) continue;
        // Shading is much paler than the pen, whatever its size.
        if (pMass[l] / parts.areas[l] < coreDark * 0.6) drop[l] = 1;
        // Hue needs enough pixels to be measured reliably.
        if (parts.areas[l] < minArea) continue;
        const d = Math.hypot(...hue(pCol[l].map(median)).map((v, c) => v - coreHue[c]));
        if (d > 0.12) drop[l] = 1;
      }
      for (let p = 0; p < n; p += 1) if (drop[parts.labels[p]]) mask[p] = 0;
    }
  }

  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  const inkColour = [[], [], []];
  for (let p = 0; p < n; p += 1) {
    if (!mask[p]) continue;
    if (!keep[clusters.labels[p]]) {
      mask[p] = 0;
      continue;
    }
    const x = p % w;
    const y = (p - x) / w;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
    if (dark[p] > hi && (p & 3) === 0) for (let c = 0; c < 3; c += 1) inkColour[c].push(norm[c][p]);
  }
  if (bx1 < bx0) return null;

  // 5. Alpha from how dark each kept pixel is: a soft ramp keeps pen taper,
  //    but reaches solid early so faint ballpoint prints as confident ink.
  const padPx = Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.03) + 2;
  bx0 = Math.max(0, bx0 - padPx);
  by0 = Math.max(0, by0 - padPx);
  bx1 = Math.min(w - 1, bx1 + padPx);
  by1 = Math.min(h - 1, by1 + padPx);
  const cw = bx1 - bx0 + 1;
  const ch = by1 - by0 + 1;
  // Include a one-pixel antialiased fringe around the mask.
  const fringe = maxFilter(Float32Array.from(mask), w, h, 1);
  const alphaCrop = Buffer.alloc(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const p = (y + by0) * w + (x + bx0);
      if (!fringe[p]) continue;
      const hard = mask[p] ? 1 : 0.5;
      const a = clamp01((dark[p] - lo * 0.6) / (hi * 1.1 - lo * 0.6));
      alphaCrop[y * cw + x] = Math.round(hard * Math.pow(a, 0.6) * 255);
    }
  }

  // 6. Scale into the output box (upscaling a tiny signature is fine: it is
  //    going to be drawn at this size anyway), then thicken hairline strokes.
  const scale = Math.min(SIG_OUT_W / cw, SIG_OUT_H / ch, 4);
  const ow = Math.max(1, Math.round(cw * scale));
  const oh = Math.max(1, Math.round(ch * scale));
  const alphaOut = await sharp(alphaCrop, { raw: { width: cw, height: ch, channels: 1 } })
    .resize(ow, oh, { fit: "fill", kernel: "lanczos3" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  let area = 0;
  let perimeter = 0;
  for (let y = 0; y < oh; y += 1) {
    for (let x = 0; x < ow; x += 1) {
      if (alphaOut[y * ow + x] < 128) continue;
      area += 1;
      if (
        x === 0 || y === 0 || x === ow - 1 || y === oh - 1 ||
        alphaOut[y * ow + x - 1] < 128 || alphaOut[y * ow + x + 1] < 128 ||
        alphaOut[(y - 1) * ow + x] < 128 || alphaOut[(y + 1) * ow + x] < 128
      ) perimeter += 1;
    }
  }
  const stroke = perimeter ? (2 * area) / perimeter : 0;
  let finalAlpha = Float32Array.from(alphaOut);
  if (stroke < MIN_STROKE) {
    const grow = Math.max(1, Math.round((MIN_STROKE - stroke) / 2));
    finalAlpha = boxBlur(maxFilter(finalAlpha, ow, oh, grow), ow, oh, 1);
  } else if (stroke > MAX_STROKE) {
    // Never more than 2px: a dense scribble can read as one very thick
    // "stroke", and eroding it hard carves blocky holes in it.
    const shrink = Math.min(2, Math.max(1, Math.round((stroke - MAX_STROKE) / 2)));
    finalAlpha = boxBlur(minFilter(finalAlpha, ow, oh, shrink), ow, oh, 1);
  }

  // Ink colour: the signature's own hue, deepened so it reads like fresh ink.
  let colour = inkColour.map(median).map((v) => v * 255);
  const lum = 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2];
  const target = 45;
  colour = colour.map((v) => Math.round(Math.min(255, (v * target) / Math.max(1, lum))));
  // Grey-ish ink (pencil, faded black) prints as near-black.
  const spread = Math.max(...colour) - Math.min(...colour);
  if (spread < 25) colour = [25, 25, 30];

  const rgba = Buffer.alloc(ow * oh * 4);
  for (let p = 0; p < ow * oh; p += 1) {
    rgba[p * 4] = colour[0];
    rgba[p * 4 + 1] = colour[1];
    rgba[p * 4 + 2] = colour[2];
    rgba[p * 4 + 3] = Math.round(clamp01((finalAlpha[p] / 255) * 1.25) * 255);
  }
  const png = await sharp(rgba, { raw: { width: ow, height: oh, channels: 4 } }).png().toBuffer();
  if (!debug) return png;
  return { png, stats: { w, h, hi, lo, rulesH: horizontal.count, rulesV: vertical.count, stroke, clusters: clusters.count } };
}
