import { useState } from "react";
import { createCampaign, getDefaultTemplate } from "../api.js";
import { IconUpload, IconPaperclip, IconSparkle } from "../icons.jsx";

const PLACEHOLDER_HELP = (
  <>
    Reference spreadsheet columns as <code>{"{{ColumnName}}"}</code> (no spaces) or{" "}
    <code>{'{{lookup this "Column Name"}}'}</code> (works for any header, including ones with spaces).
  </>
);

function FileDrop({ label, hint, file, accept, onChange, icon }) {
  return (
    <label className="file-drop">
      <input type="file" accept={accept} onChange={(e) => onChange(e.target.files[0] || null)} />
      <span className="icon">{icon}</span>
      <span className="text">
        <span className="primary-text">{file ? file.name : label}</span>
        <span className="secondary-text">{file ? `${(file.size / 1024).toFixed(0)} KB — click to change` : hint}</span>
      </span>
    </label>
  );
}

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
      <h2>Compose your campaign</h2>
      <p className="lede">Set up the recipient list and the message once — it's personalized per recipient at send time.</p>

      <label className="field">
        <span>Recipient spreadsheet</span>
        <FileDrop
          label="Choose a .xlsx or .xls file"
          hint='Must have a column named exactly "Email".'
          file={recipients}
          accept=".xlsx,.xls"
          onChange={setRecipients}
          icon={<IconUpload />}
        />
      </label>

      <hr className="section-divider" />

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
        <FileDrop
          label="Choose a file"
          hint="The same file is attached to every recipient (e.g. a guarantor form)."
          file={attachment}
          onChange={setAttachment}
          icon={<IconPaperclip />}
        />
      </label>

      <hr className="section-divider" />

      <div className="field checkbox-field">
        <input
          id="pdf-toggle"
          type="checkbox"
          checked={pdfEnabled}
          onChange={(e) => handlePdfToggle(e.target.checked)}
        />
        <label htmlFor="pdf-toggle">
          <span className="title">
            <IconSparkle width={14} height={14} style={{ marginRight: 5, verticalAlign: -2 }} />
            Generate a personalized PDF for each recipient
          </span>
          <span className="desc">Attaches a unique PDF built from the template below, filled in per recipient.</span>
        </label>
      </div>

      {pdfEnabled && (
        <label className="field" style={{ marginTop: 20 }}>
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

      <button type="submit" className="primary" disabled={loading} style={{ width: "100%", marginTop: 8 }}>
        {loading ? "Processing…" : "Continue to preview"}
      </button>
    </form>
  );
}
