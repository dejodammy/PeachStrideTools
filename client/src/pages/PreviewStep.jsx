import { useState } from "react";
import { previewPdfUrl, startSend } from "../api.js";

export default function PreviewStep({ campaign, onStarted, onBack }) {
  const [sender, setSender] = useState("");
  const [password, setPassword] = useState("");
  const [smtpServer, setSmtpServer] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [delaySeconds, setDelaySeconds] = useState("2");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSend(e) {
    e.preventDefault();
    setError("");
    if (confirmation !== "SEND") return setError('Type SEND (all caps) to confirm.');
    if (!sender.trim() || !password) return setError("Enter the sender email and app password.");

    setLoading(true);
    try {
      await startSend(campaign.id, {
        sender: sender.trim(),
        password,
        smtpServer: smtpServer.trim(),
        smtpPort: Number(smtpPort),
        delaySeconds: Number(delaySeconds),
        confirmation,
      });
      onStarted(campaign.id);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  const columns = campaign.columns || [];

  return (
    <div className="card">
      <h2>2. Preview &amp; send</h2>

      <p className="summary">
        <strong>{campaign.recipientCount}</strong> recipient(s) ready to send.
        {campaign.droppedCount > 0 && ` (${campaign.droppedCount} row(s) skipped — no email address.)`}
      </p>

      <div className="preview-block">
        <h3>Sample email (recipient #1)</h3>
        <div className="preview-subject">{campaign.subjectPreview}</div>
        <div className="preview-body">{campaign.bodyPreview}</div>
      </div>

      {campaign.hasPdfTemplate && (
        <div className="preview-block">
          <h3>Personalized PDF attachment</h3>
          {campaign.pdfPreviewError ? (
            <div className="banner error">Template failed to render: {campaign.pdfPreviewError}</div>
          ) : (
            <a className="secondary" href={previewPdfUrl(campaign.id)} target="_blank" rel="noreferrer">
              Open PDF preview (recipient #1) ↗
            </a>
          )}
        </div>
      )}

      {campaign.hasSharedAttachment && (
        <div className="preview-block">
          <h3>Shared attachment</h3>
          <p>{campaign.sharedAttachmentName} (sent to every recipient)</p>
        </div>
      )}

      <div className="preview-block">
        <h3>Recipients (first {Math.min(10, campaign.sampleRows.length)} of {campaign.recipientCount})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaign.sampleRows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c}>{String(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="send-form" onSubmit={handleSend}>
        <h3>Send campaign</h3>
        <p className="hint">This sends real emails immediately once confirmed. Use a Gmail App Password, not your normal password — it is never stored.</p>

        <div className="row">
          <label className="field">
            <span>Sender email</span>
            <input type="email" value={sender} onChange={(e) => setSender(e.target.value)} />
          </label>
          <label className="field">
            <span>App password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>SMTP server</span>
            <input type="text" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} />
          </label>
          <label className="field">
            <span>Port</span>
            <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
          </label>
          <label className="field">
            <span>Delay between emails (seconds)</span>
            <input type="number" min="0" step="0.5" value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Type SEND to confirm</span>
          <input type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="SEND" />
        </label>

        {error && <div className="banner error">{error}</div>}

        <div className="actions">
          <button type="button" className="secondary" onClick={onBack}>
            ← Start over
          </button>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Starting…" : `Send to ${campaign.recipientCount} recipient(s)`}
          </button>
        </div>
      </form>
    </div>
  );
}
