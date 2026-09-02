import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { parseRecipients } from "../services/excel.js";
import { renderText, renderHtml } from "../services/templating.js";
import { htmlToPdf } from "../services/pdf.js";
import { stampPdf } from "../services/pdfOverlay.js";
import { createTransport, sendOne, sleep } from "../services/mailer.js";
import { DAILY_SEND_CAP, getUsage, recordSend } from "../services/senderUsage.js";
import { getAccount } from "../services/accounts.js";
import {
  campaignExists,
  createCampaignDir,
  writeJson,
  readJson,
  writeText,
  readText,
  fileExists,
  filePath,
  appendLogRow,
  readSentEmails,
  writeStatus,
  readStatus,
} from "../services/storage.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const router = express.Router();

// Guards against starting the same campaign twice concurrently. Source of truth for
// "is this actually still running" beyond a server restart is status.json on disk.
const runningCampaigns = new Set();

function safeFilenamePart(value) {
  return String(value || "recipient")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 80) || "recipient";
}

// Renders the campaign's personalized PDF for one recipient row, whichever
// mode it's using: a hand-written HTML template, or an existing PDF with
// marked regions to stamp values onto.
async function generateCampaignPdf(id, meta, row) {
  if (meta.pdfMode === "overlay") {
    const sourceBytes = await fs.promises.readFile(filePath(id, "overlay_source.pdf"));
    const regions = await readJson(id, "overlay_regions.json", []);
    return Buffer.from(await stampPdf(sourceBytes, regions, row));
  }
  const template = await readText(id, "template.html");
  const html = renderHtml(template, row);
  return htmlToPdf(html);
}

router.post(
  "/",
  upload.fields([
    { name: "recipients", maxCount: 1 },
    { name: "attachment", maxCount: 1 },
    { name: "overlaySource", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const recipientsFile = req.files?.recipients?.[0];
      if (!recipientsFile) {
        return res.status(400).json({ error: "Upload a recipients spreadsheet (.xlsx or .xls)." });
      }
      const { subject, body } = req.body;
      if (!subject || !subject.trim()) return res.status(400).json({ error: "Subject is required." });
      if (!body || !body.trim()) return res.status(400).json({ error: "Email body is required." });

      const { columns, rows, dropped } = parseRecipients(recipientsFile.buffer);

      const pdfTemplateEnabled = req.body.pdfTemplateEnabled === "true";
      const pdfMode = req.body.pdfMode === "overlay" ? "overlay" : "html";
      const pdfTemplateHtml = pdfTemplateEnabled && pdfMode === "html" ? req.body.pdfTemplateHtml || "" : "";
      const overlaySourceFile = req.files?.overlaySource?.[0];
      let overlayRegions = [];
      if (pdfTemplateEnabled && pdfMode === "overlay") {
        if (!overlaySourceFile) {
          return res.status(400).json({ error: "Upload the PDF you want to mark up." });
        }
        try {
          overlayRegions = JSON.parse(req.body.overlayRegions || "[]");
        } catch {
          return res.status(400).json({ error: "Marked regions were malformed — try marking them again." });
        }
        if (!Array.isArray(overlayRegions) || overlayRegions.length === 0) {
          return res.status(400).json({ error: "Mark at least one region on the PDF (e.g. drag a box over the name)." });
        }
        const badColumn = overlayRegions.find((r) => !columns.includes(r.column));
        if (badColumn) {
          return res.status(400).json({ error: `A marked region refers to a column that isn't in your spreadsheet: "${badColumn.column}".` });
        }
      } else if (pdfTemplateEnabled && !pdfTemplateHtml.trim()) {
        return res.status(400).json({ error: "PDF template is enabled but the template is empty." });
      }

      const attachmentFile = req.files?.attachment?.[0];

      const id = randomUUID();
      await createCampaignDir(id);
      await writeJson(id, "recipients.json", rows);

      const meta = {
        subject,
        body,
        columns,
        droppedRows: dropped,
        hasPdfTemplate: pdfTemplateEnabled,
        pdfMode: pdfTemplateEnabled ? pdfMode : null,
        overlaySourceName: overlaySourceFile?.originalname || null,
        overlayRegionCount: overlayRegions.length,
        hasSharedAttachment: Boolean(attachmentFile),
        sharedAttachmentName: attachmentFile?.originalname || null,
        sharedAttachmentMime: attachmentFile?.mimetype || null,
        createdAt: new Date().toISOString(),
      };
      await writeJson(id, "meta.json", meta);

      if (attachmentFile) {
        await fs.promises.writeFile(filePath(id, "attachment.bin"), attachmentFile.buffer);
      }
      if (pdfTemplateEnabled && pdfMode === "html") {
        await writeText(id, "template.html", pdfTemplateHtml);
      }
      if (pdfTemplateEnabled && pdfMode === "overlay") {
        await fs.promises.writeFile(filePath(id, "overlay_source.pdf"), overlaySourceFile.buffer);
        await writeJson(id, "overlay_regions.json", overlayRegions);
      }

      const sampleRow = rows[0];
      const subjectPreview = renderText(subject, sampleRow);
      const bodyPreview = renderText(body, sampleRow);

      let pdfPreviewError = null;
      if (pdfTemplateEnabled) {
        try {
          const pdfBuffer = await generateCampaignPdf(id, meta, sampleRow);
          await fs.promises.writeFile(filePath(id, "preview.pdf"), pdfBuffer);
        } catch (err) {
          pdfPreviewError = err.message;
        }
      }

      res.json({
        id,
        columns,
        recipientCount: rows.length,
        droppedCount: dropped,
        sampleRows: rows.slice(0, 10),
        subjectPreview,
        bodyPreview,
        hasPdfTemplate: pdfTemplateEnabled,
        pdfMode: pdfTemplateEnabled ? pdfMode : null,
        hasSharedAttachment: Boolean(attachmentFile),
        sharedAttachmentName: attachmentFile?.originalname || null,
        pdfPreviewError,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);


router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!campaignExists(id)) return res.status(404).json({ error: "Campaign not found." });
  const meta = await readJson(id, "meta.json");
  const rows = await readJson(id, "recipients.json", []);
  const sampleRow = rows[0] || {};
  const status = await readStatus(id);
  res.json({
    id,
    columns: meta.columns,
    recipientCount: rows.length,
    sampleRows: rows.slice(0, 10),
    subjectPreview: renderText(meta.subject, sampleRow),
    bodyPreview: renderText(meta.body, sampleRow),
    hasPdfTemplate: meta.hasPdfTemplate,
    pdfMode: meta.pdfMode,
    hasSharedAttachment: meta.hasSharedAttachment,
    sharedAttachmentName: meta.sharedAttachmentName,
    status,
  });
});

router.get("/:id/preview.pdf", async (req, res) => {
  const { id } = req.params;
  if (!fileExists(id, "preview.pdf")) return res.status(404).send("No PDF preview available.");
  res.sendFile(filePath(id, "preview.pdf"));
});

router.get("/:id/status", async (req, res) => {
  const { id } = req.params;
  if (!campaignExists(id)) return res.status(404).json({ error: "Campaign not found." });
  const status = await readStatus(id);
  if (!status) {
    const rows = await readJson(id, "recipients.json", []);
    return res.json({ total: rows.length, sent: 0, failed: 0, done: false, started: false });
  }
  res.json(status);
});

router.get("/:id/log.csv", async (req, res) => {
  const { id } = req.params;
  if (!fileExists(id, "send_log.csv")) return res.status(404).send("No log yet.");
  res.download(filePath(id, "send_log.csv"), "campaign_send_log.csv");
});

router.post("/:id/send", express.json(), async (req, res) => {
  const { id } = req.params;
  if (!campaignExists(id)) return res.status(404).json({ error: "Campaign not found." });
  if (runningCampaigns.has(id)) {
    return res.status(409).json({ error: "This campaign is already sending." });
  }
  const existingStatus = await readStatus(id);
  if (existingStatus?.done && !req.body.force) {
    return res.status(409).json({ error: "This campaign already finished sending. Create a new campaign to resend." });
  }

  const { accountId, backupAccountId, smtpServer, smtpPort, delaySeconds, confirmation } = req.body;
  if (confirmation !== "SEND") {
    return res.status(400).json({ error: 'Type SEND (all caps) to confirm.' });
  }
  const primaryAccount = getAccount(accountId);
  if (!primaryAccount) {
    return res.status(400).json({ error: "Choose a sender account (configure one in server/.env if the list is empty)." });
  }
  let backupAccount = null;
  if (backupAccountId) {
    backupAccount = getAccount(backupAccountId);
    if (!backupAccount) return res.status(400).json({ error: "Unknown backup account." });
    if (backupAccount.id === primaryAccount.id) {
      return res.status(400).json({ error: "Backup account must be different from the sender account." });
    }
  }
  const port = Number(smtpPort) || 587;
  const delayMs = Math.max(0, Number(delaySeconds) || 0) * 1000;
  const server = smtpServer || "smtp.gmail.com";

  const meta = await readJson(id, "meta.json");
  const rows = await readJson(id, "recipients.json", []);
  const sharedAttachment = meta.hasSharedAttachment
    ? {
        filename: meta.sharedAttachmentName,
        content: await fs.promises.readFile(filePath(id, "attachment.bin")),
        contentType: meta.sharedAttachmentMime,
      }
    : null;

  const alreadySent = await readSentEmails(id);
  const remaining = rows.filter((r) => !alreadySent.has(r.Email));

  // Each Gmail account has its own rolling-24h send cap. Verify every configured
  // account up front and load its current usage, so a login problem is caught
  // before anything is sent, not partway through the campaign.
  const accountDefs = [{ ...primaryAccount, label: "sender" }];
  if (backupAccount) accountDefs.push({ ...backupAccount, label: "backup account" });

  const accounts = [];
  for (const def of accountDefs) {
    const transport = await createTransport({ server, port, sender: def.email, password: def.password });
    try {
      await transport.verify();
    } catch (err) {
      return res.status(400).json({ error: `Could not log in with the ${def.label} (${def.email}): ${err.message}` });
    }
    const used = await getUsage(def.email);
    accounts.push({ email: def.email, transport, used });
  }
  if (accounts.every((a) => a.used >= DAILY_SEND_CAP)) {
    return res.status(400).json({
      error: `All configured account(s) have already reached the ${DAILY_SEND_CAP}/24h sending limit. Wait for the rolling window to free up, or add a different account.`,
    });
  }

  runningCampaigns.add(id);
  await writeStatus(id, {
    total: rows.length,
    sent: alreadySent.size,
    failed: existingStatus?.failed || 0,
    done: false,
    started: true,
    startedAt: new Date().toISOString(),
  });
  res.status(202).json({ started: true, remaining: remaining.length });

  // Fire-and-forget: the browser polls GET /:id/status for progress.
  (async () => {
    let sent = alreadySent.size;
    let failed = existingStatus?.failed || 0;
    let accountIndex = 0;
    let capped = false;

    for (let i = 0; i < remaining.length; i += 1) {
      // Advance past any account that has hit its rolling-24h cap.
      while (accounts[accountIndex] && accounts[accountIndex].used >= DAILY_SEND_CAP) accountIndex += 1;
      if (!accounts[accountIndex]) {
        capped = true;
        break;
      }
      const account = accounts[accountIndex];
      const row = remaining[i];
      try {
        const subject = renderText(meta.subject, row);
        const text = renderText(meta.body, row);
        const attachments = [];
        if (sharedAttachment) attachments.push(sharedAttachment);
        if (meta.hasPdfTemplate) {
          const pdfBuffer = await generateCampaignPdf(id, meta, row);
          attachments.push({
            filename: `${safeFilenamePart(row.Name || row.Email)}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          });
        }
        await sendOne(account.transport, { from: account.email, to: row.Email, subject, text, attachments });
        sent += 1;
        account.used += 1;
        await recordSend(account.email);
        await appendLogRow(id, {
          email: row.Email,
          name: row.Name || "",
          status: "sent",
          detail: "",
          timestamp: new Date().toISOString(),
          sender: account.email,
        });
      } catch (err) {
        failed += 1;
        await appendLogRow(id, {
          email: row.Email,
          name: row.Name || "",
          status: "failed",
          detail: err.message,
          timestamp: new Date().toISOString(),
          sender: account.email,
        });
      }
      await writeStatus(id, { total: rows.length, sent, failed, done: false, started: true });
      if (i < remaining.length - 1 && delayMs > 0) await sleep(delayMs);
    }

    const processed = sent + failed;
    await writeStatus(id, {
      total: rows.length,
      sent,
      failed,
      done: true,
      capped,
      remaining: rows.length - processed,
      senders: accounts.map((a) => ({ email: a.email, used: a.used, cap: DAILY_SEND_CAP })),
      finishedAt: new Date().toISOString(),
    });
    runningCampaigns.delete(id);
    accounts.forEach((a) => a.transport.close());
  })().catch(async (err) => {
    await writeStatus(id, { total: rows.length, sent: 0, failed: 0, done: true, error: err.message });
    runningCampaigns.delete(id);
  });
});

export default router;
