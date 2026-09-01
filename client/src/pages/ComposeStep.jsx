import { useState } from "react";
import { createCampaign, getDefaultTemplate } from "../api.js";

const PLACEHOLDER_HELP =
  'Reference spreadsheet columns as {{ColumnName}} (no spaces) or {{lookup this "Column Name"}} (works for any header, including ones with spaces).';

export default function ComposeStep({ onCreated }) {
  const [recipients, setRecipients] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handlePdfToggle(checked) {
    setPdfEnabled(checked);
    if (checked && !pdfTemplate.trim()) {
      try {
        const starter = await getDefaultTemplate();
        setPdfTemplate(starter);
      } catch {
        // Non-fatal: user can still write their own template from scratch.
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!recipients) return setError("Choose a recipients spreadsheet (.xlsx or .xls).");
    if (!subject.trim()) return setError("Enter an email subject.");
    if (!body.trim()) return setError("Enter the email body.");
    if (pdfEnabled && !pdfTemplate.trim()) return setError("The PDF template is empty.");

    const formData = new FormData();
    formData.append("recipients", recipients);
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("pdfTemplateEnabled", String(pdfEnabled));
    if (pdfEnabled) formData.append("pdfTemplateHtml", pdfTemplate);
    if (attachment) formData.append("attachment", attachment);

    setLoading(true);
    try {
      const campaign = await createCampaign(formData);
      onCreated(campaign);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>1. Compose your campaign</h2>

      <label className="field">
        <span>Recipient spreadsheet (.xlsx or .xls)</span>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setRecipients(e.target.files[0] || null)}
        />
        <small>Must have a column named exactly "Email". Any other columns can be used as placeholders below.</small>
      </label>

      <label className="field">
        <span>Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder='e.g. Request for Supporting Documents - {{lookup this "Role"}}'
        />
      </label>

      <label className="field">
        <span>Body</span>
        <textarea
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Dear {{Name}},\n\nWrite your message here...`}
        />
        <small>{PLACEHOLDER_HELP}</small>
      </label>

      <label className="field">
        <span>Attach a file to every email (optional)</span>
        <input type="file" onChange={(e) => setAttachment(e.target.files[0] || null)} />
        <small>The same file is attached to every recipient (e.g. a guarantor form).</small>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={pdfEnabled}
          onChange={(e) => handlePdfToggle(e.target.checked)}
        />
        <span>Generate a personalized PDF for each recipient</span>
      </label>

      {pdfEnabled && (
        <label className="field">
          <span>PDF template (HTML)</span>
          <textarea
            className="mono"
            rows={16}
            value={pdfTemplate}
            onChange={(e) => setPdfTemplate(e.target.value)}
          />
          <small>{PLACEHOLDER_HELP} A starter letter template has been filled in for you — edit it freely.</small>
        </label>
      )}

      {error && <div className="banner error">{error}</div>}

      <button type="submit" className="primary" disabled={loading}>
        {loading ? "Processing…" : "Continue to preview"}
      </button>
    </form>
  );
}
