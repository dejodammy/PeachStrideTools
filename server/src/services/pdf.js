import fs from "node:fs";
import puppeteer from "puppeteer-core";

// puppeteer-core does not download its own Chromium (avoids a ~300MB install and native
// dependency headaches). Instead it drives whichever Chromium-based browser is already
// on the machine. Checked in order of preference, Windows first then Linux (the server
// installs chromium via apt — see deploy/setup.sh).
const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
].filter(Boolean);

function findBrowserExecutable() {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No Chrome/Chromium installation was found. Install Chrome or Chromium (or set CHROME_PATH) to enable HTML-template PDF generation. The 'existing PDF' mode does not need a browser."
  );
}

let browserPromise = null;

function isAlive(browser) {
  // `connected` on current puppeteer, `isConnected()` on older builds.
  return typeof browser.connected === "boolean" ? browser.connected : browser.isConnected?.() ?? false;
}

async function getBrowser() {
  // The handle is cached for speed, but a cached *dead* browser is worse than
  // no cache: Chrome can be closed by the OS, a crash, or someone tidying up
  // processes, and without this check every later render fails with
  // "Connection closed" until the server itself is restarted.
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (isAlive(existing)) return existing;
    } catch {
      // Launch itself failed earlier; fall through and try again.
    }
    browserPromise = null;
  }

  const executablePath = findBrowserExecutable();
  const launching = puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  browserPromise = launching;

  try {
    const browser = await launching;
    // Drop the handle the moment Chrome goes away, so the next call relaunches
    // instead of queueing behind a corpse.
    browser.on("disconnected", () => {
      if (browserPromise === launching) browserPromise = null;
    });
    return browser;
  } catch (err) {
    if (browserPromise === launching) browserPromise = null;
    throw err;
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

/**
 * Render a batch of HTML strings to PNG bytes at one fixed pixel size, sharing a
 * single browser across the batch. Used for ID cards, where every employee
 * renders at the same size.
 */
export async function renderPngBatch(htmls, { width, height, scale = 2 } = {}) {
  let browser = await getBrowser();
  const results = [];

  for (const html of htmls) {
    // A fresh page per card. Reusing one page and calling setContent again
    // hangs: the second call never reaches its lifecycle target, because a
    // page whose content is entirely inline (our images are data URIs) fires
    // no further network activity for the watcher to settle on. Pages are
    // cheap; the expensive part — the browser itself — is still shared.
    let page;
    try {
      page = await browser.newPage();
    } catch {
      // Chrome died partway through a long batch. getBrowser() has already
      // dropped the dead handle, so one retry gets a fresh browser rather than
      // failing the whole run.
      browser = await getBrowser();
      page = await browser.newPage();
    }
    try {
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: "load" });
      // "load" can resolve a beat before webfonts and image decoding finish,
      // which would screenshot a half-painted card.
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map((img) => new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }))
        );
      });
      results.push(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } }));
    } finally {
      await page.close();
    }
  }

  return results;
}

/**
 * Render a single HTML string to PNG bytes at a fixed pixel size.
 */
export async function htmlToPng(html, { width, height, scale = 2 } = {}) {
  const [buffer] = await renderPngBatch([html], { width, height, scale });
  return buffer;
}

/**
 * Render an HTML string to PDF bytes (A4, print backgrounds enabled so letterhead
 * colors/borders show up).
 */
export async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}
