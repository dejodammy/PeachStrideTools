import fs from "node:fs";
import puppeteer from "puppeteer-core";

// puppeteer-core does not download its own Chromium (avoids a ~300MB install and native
// dependency headaches). Instead it drives whichever Chromium-based browser is already
// on the machine. Checked in order of preference.
const CANDIDATE_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findBrowserExecutable() {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No Chrome or Edge installation was found. Install Google Chrome or Microsoft Edge to enable PDF generation."
  );
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = findBrowserExecutable();
    browserPromise = puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
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
