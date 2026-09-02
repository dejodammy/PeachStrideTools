import { previewPdfUrl, startSend } from "../api.js";
import { IconExternal, IconFileText, IconPaperclip } from "../icons.jsx";
import SendForm from "../components/SendForm.jsx";

export default function PreviewStep({ campaign, onStarted, onBack }) {
  const columns = campaign.columns || [];

  async function handleSend(values) {
    await startSend(campaign.id, values);
    onStarted(campaign.id);
  }

  return (
    <div className="card">
      <h2>Preview &amp; send</h2>
      <p className="summary">
        <strong>{campaign.recipientCount}</strong> recipient{campaign.recipientCount === 1 ? "" : "s"} ready to send.
        {campaign.droppedCount > 0 && ` (${campaign.droppedCount} row(s) skipped — no email address.)`}
      </p>

      <div className="preview-block">
        <h3>Sample email — recipient #1</h3>
        <div className="email-preview">
          <div className="email-subject">{campaign.subjectPreview}</div>
          <div className="email-body">{campaign.bodyPreview}</div>
        </div>
      </div>

      {campaign.hasPdfTemplate && (
        <div className="preview-block">
          <h3>Personalized PDF attachment</h3>
          {campaign.pdfPreviewError ? (
            <div className="banner error">Template failed to render: {campaign.pdfPreviewError}</div>
          ) : (
            <div className="attachment-row">
              <span className="icon"><IconFileText /></span>
              <span className="meta">
                <span className="name">Generated per recipient</span>
                <span className="sub">One unique PDF attached to each email</span>
              </span>
              <a className="link" href={previewPdfUrl(campaign.id)} target="_blank" rel="noreferrer">
                Preview <IconExternal width={13} height={13} />
              </a>
            </div>
          )}
        </div>
      )}

      {campaign.hasSharedAttachment && (
        <div className="preview-block">
          <h3>Shared attachment</h3>
          <div className="attachment-row">
            <span className="icon"><IconPaperclip /></span>
            <span className="meta">
              <span className="name">{campaign.sharedAttachmentName}</span>
              <span className="sub">Sent to every recipient</span>
            </span>
          </div>
        </div>
      )}

      <div className="preview-block">
        <h3>Recipients — first {Math.min(10, campaign.sampleRows.length)} of {campaign.recipientCount}</h3>
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

      <hr className="section-divider" />

      <SendForm recipientCount={campaign.recipientCount} submitLabel="Send to" onSubmit={handleSend} onCancel={onBack} />
    </div>
  );
}
