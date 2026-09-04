import { useEffect, useRef, useState } from "react";
import { createCampaign, getDefaultTemplate } from "../api.js";
import { IconUpload, IconPaperclip, IconSparkle } from "../icons.jsx";
import PlaceholderChips from "../components/PlaceholderChips.jsx";
import PdfRegionPicker from "../components/PdfRegionPicker.jsx";
import { readSpreadsheetColumns } from "../utils/readSpreadsheetColumns.js";
import { insertAtCursor, placeholderToken } from "../utils/placeholders.js";

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

export default function ComposeStep({ onCreated, presetRecipients }) {
  const [recipients, setRecipients] = useState(null);
  const [columns, setColumns] = useState([]);
  const [columnsError, setColumnsError] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [pdfMode, setPdfMode] = useState("html"); // "html" | "overlay"
  const [pdfTemplate, setPdfTemplate] = useState("");
  const [overlayFile, setOverlayFile] = useState(null);
  const [overlayRegions, setOverlayRegions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Recipients handed over from CV extraction arrive as a File, so run them
  // through the same path a manual upload takes — column chips included.
  useEffect(() => {
    if (presetRecipients) handleRecipientsChange(presetRecipients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRecipients]);

  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const templateRef = useRef(null);

  async function handleRecipientsChange(file) {
    setRecipients(file);
    setColumns([]);
    setColumnsError("");
    if (!file) return;
    try {
      const cols = await readSpreadsheetColumns(file);
      if (!cols.includes("Email")) {
        setColumnsError('No column named exactly "Email" was found — check your spreadsheet headers.');
      }
      setColumns(cols);
    } catch {
      setColumnsError("Could not read that file's columns — it will still be validated when you continue.");
    }
  }

  function insertInto(ref, value, setValue, column) {
    insertAtCursor(ref.current, value, setValue, placeholderToken(column));
  }

  async function loadStarterTemplateIfEmpty() {
    if (!pdfTemplate.trim()) {
      try {
        setPdfTemplate(await getDefaultTemplate());
      } catch {
        // Non-fatal: user can still write their own template from scratch.
      }
    }
  }

  async function handlePdfToggle(checked) {
    setPdfEnabled(checked);
    if (checked && pdfMode === "html") await loadStarterTemplateIfEmpty();
  }

  async function handleModeToggle(mode) {
    setPdfMode(mode);
    if (mode === "html") await loadStarterTemplateIfEmpty();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!recipients) return setError("Choose a recipients spreadsheet (.xlsx or .xls).");
    if (!subject.trim()) return setError("Enter an email subject.");
    if (!body.trim()) return setError("Enter the email body.");
    if (pdfEnabled && pdfMode === "html" && !pdfTemplate.trim()) return setError("The PDF template is empty.");
    if (pdfEnabled && pdfMode === "overlay") {
      if (!overlayFile) return setError("Upload the PDF you want to mark up.");
      if (overlayRegions.length === 0) return setError("Drag a box over at least one spot on the PDF (e.g. the name).");
    }

    const formData = new FormData();
    formData.append("recipients", recipients);
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("pdfTemplateEnabled", String(pdfEnabled));
    if (pdfEnabled) {
      formData.append("pdfMode", pdfMode);
      if (pdfMode === "html") {
        formData.append("pdfTemplateHtml", pdfTemplate);
      } else {
        formData.append("overlaySource", overlayFile);
        formData.append("overlayRegions", JSON.stringify(overlayRegions));
      }
    }
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
          onChange={handleRecipientsChange}
          icon={<IconUpload />}
        />
        {columnsError && <small style={{ color: "var(--danger)" }}>{columnsError}</small>}
      </label>

      <hr className="section-divider" />

      <label className="field">
        <span>Subject</span>
        <input
          ref={subjectRef}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Request for Supporting Documents"
        />
        <PlaceholderChips
          columns={columns}
          onInsert={(col) => insertInto(subjectRef, subject, setSubject, col)}
          emptyHint="Choose a spreadsheet above to insert its columns here."
        />
      </label>

      <label className="field">
        <span>Body</span>
        <textarea
          ref={bodyRef}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Dear ...,\n\nWrite your message here...`}
        />
        <PlaceholderChips columns={columns} onInsert={(col) => insertInto(bodyRef, body, setBody, col)} />
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
          <span className="desc">One unique PDF is attached to each email.</span>
        </label>
      </div>

      {pdfEnabled && (
        <div style={{ marginTop: 20 }}>
          <div className="pdf-mode-toggle">
            <button type="button" className={pdfMode === "html" ? "active" : ""} onClick={() => handleModeToggle("html")}>
              Write a letter
            </button>
            <button
              type="button"
              className={pdfMode === "overlay" ? "active" : ""}
              onClick={() => handleModeToggle("overlay")}
            >
              Use an existing PDF
            </button>
          </div>

          {pdfMode === "html" ? (
            <label className="field">
              <span>PDF template (HTML)</span>
              <textarea
                ref={templateRef}
                className="mono"
                rows={16}
                value={pdfTemplate}
                onChange={(e) => setPdfTemplate(e.target.value)}
              />
              <PlaceholderChips
                columns={columns}
                onInsert={(col) => insertInto(templateRef, pdfTemplate, setPdfTemplate, col)}
              />
              <small>A starter letter template has been filled in for you — edit it freely, or click a field above to insert it at your cursor.</small>
            </label>
          ) : columns.length === 0 ? (
            <p className="chip-row-empty">Upload your recipient spreadsheet above first, so there are fields to mark on the PDF.</p>
          ) : (
            <PdfRegionPicker
              columns={columns}
              file={overlayFile}
              onFileChange={setOverlayFile}
              regions={overlayRegions}
              onRegionsChange={setOverlayRegions}
            />
          )}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <button type="submit" className="primary" disabled={loading} style={{ width: "100%", marginTop: 8 }}>
        {loading ? "Processing…" : "Continue to preview"}
      </button>
    </form>
  );
}
