import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { parseRecipients } from "../services/excel.js";
import { renderText, renderHtml } from "../services/templating.js";
import { htmlToPdf } from "../services/pdf.js";
import { createTransport, sendOne, sleep } from "../services/mailer.js";
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

router.post(
  "/",
  upload.fields([
    { name: "recipients", maxCount: 1 },
    { name: "attachment", maxCount: 1 },
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
      const pdfTemplateHtml = pdfTemplateEnabled ? req.body.pdfTemplateHtml || "" : "";
      if (pdfTemplateEnabled && !pdfTemplateHtml.trim()) {
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
        hasSharedAttachment: Boolean(attachmentFile),
        sharedAttachmentName: attachmentFile?.originalname || null,
        sharedAttachmentMime: attachmentFile?.mimetype || null,
        createdAt: new Date().toISOString(),
      };
      await writeJson(id, "meta.json", meta);

      if (attachmentFile) {
        await fs.promises.writeFile(filePath(id, "attachment.bin"), attachmentFile.buffer);
      }
      if (pdfTemplateEnabled) {
        await writeText(id, "template.html", pdfTemplateHtml);
      }

      const sampleRow = rows[0];
      const subjectPreview = renderText(subject, sampleRow);
      const bodyPreview = renderText(body, sampleRow);

      let pdfPreviewError = null;
      if (pdfTemplateEnabled) {
        try {
          const html = renderHtml(pdfTemplateHtml, sampleRow);
          const pdfBuffer = await htmlToPdf(html);
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

  const { sender, password, smtpServer, smtpPort, delaySeconds, confirmation } = req.body;
  if (confirmation !== "SEND") {
    return res.status(400).json({ error: 'Type SEND (all caps) to confirm.' });
  }
  if (!sender || !password) {
    return res.status(400).json({ error: "Enter the sender email and app password." });
  }
  const port = Number(smtpPort) || 587;
  const delayMs = Math.max(0, Number(delaySeconds) || 0) * 1000;

  const meta = await readJson(id, "meta.json");
  const rows = await readJson(id, "recipients.json", []);
  const template = meta.hasPdfTemplate ? await readText(id, "template.html") : null;
  const sharedAttachment = meta.hasSharedAttachment
    ? {
        filename: meta.sharedAttachmentName,
        content: await fs.promises.readFile(filePath(id, "attachment.bin")),
        contentType: meta.sharedAttachmentMime,
      }
    : null;

  const alreadySent = await readSentEmails(id);
  const remaining = rows.filter((r) => !alreadySent.has(r.Email));

  const transport = createTransport({ server: smtpServer || "smtp.gmail.com", port, sender, password });
  try {
    await transport.verify();
  } catch (err) {
    return res.status(400).json({ error: `Could not log in to ${smtpServer}: ${err.message}` });
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
    for (let i = 0; i < remaining.length; i += 1) {
      const row = remaining[i];
      try {
        const subject = renderText(meta.subject, row);
        const text = renderText(meta.body, row);
        const attachments = [];
        if (sharedAttachment) attachments.push(sharedAttachment);
        if (template) {
          const html = renderHtml(template, row);
          const pdfBuffer = await htmlToPdf(html);
          attachments.push({
            filename: `${safeFilenamePart(row.Name || row.Email)}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          });
        }
        await sendOne(transport, { from: sender, to: row.Email, subject, text, attachments });
        sent += 1;
        await appendLogRow(id, {
          email: row.Email,
          name: row.Name || "",
          status: "sent",
          detail: "",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        failed += 1;
        await appendLogRow(id, {
          email: row.Email,
          name: row.Name || "",
          status: "failed",
          detail: err.message,
          timestamp: new Date().toISOString(),
        });
      }
      await writeStatus(id, { total: rows.length, sent, failed, done: false, started: true });
      if (i < remaining.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    await writeStatus(id, { total: rows.length, sent, failed, done: true, finishedAt: new Date().toISOString() });
    runningCampaigns.delete(id);
    transport.close();
  })().catch(async (err) => {
    await writeStatus(id, { total: rows.length, sent: 0, failed: 0, done: true, error: err.message });
    runningCampaigns.delete(id);
  });
});

export default router;
