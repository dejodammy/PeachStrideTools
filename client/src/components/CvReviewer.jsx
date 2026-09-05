import { useEffect, useState } from "react";
import { cvFileUrl } from "../api.js";
import { IconArrowLeft, IconCheck, IconExternal } from "../icons.jsx";

/**
 * Side-by-side reviewer: the actual CV on the left, the extracted fields on the
 * right. The point is to read the document and correct the values without
 * losing your place — the flags tell you *what* to distrust, this shows you the
 * evidence to fix it against.
 */
export default function CvReviewer({ jobId, rows, index, onChange, onIndexChange, onClose, onApprove, flagHelp }) {
  const row = rows[index];
  const [draft, setDraft] = useState(row);

  useEffect(() => setDraft(rows[index]), [index, rows]);

  if (!row) return null;

  // .docx/.doc are converted to PDF server-side (and cached), so they render
  // the same way as a native PDF here — only a genuinely unsupported format
  // falls back to "open it yourself".
  const previewable = /\.(pdf|docx?)$/i.test(row.file);
  const url = cvFileUrl(jobId, row.file);

  function commit(next) {
    setDraft(next);
    onChange(next);
  }

  function step(delta) {
    const next = index + delta;
    if (next >= 0 && next < rows.length) onIndexChange(next);
  }

  // `rows` arrives flagged-first-then-clean (an approved row counts as
  // clean even though it still carries its original flags), so the first
  // row that's not still-needing-review is exactly where the clean section
  // starts — offer a shortcut there instead of making someone step through
  // every remaining flagged CV first.
  const stillFlagged = row.flags.length > 0 && !row.approved;
  const firstCleanIndex = rows.findIndex((r) => r.flags.length === 0 || r.approved);
  const canJumpToClean = stillFlagged && firstCleanIndex !== -1 && firstCleanIndex !== index;

  return (
    <div className="reviewer-overlay" onClick={onClose}>
      <div className="reviewer" onClick={(e) => e.stopPropagation()}>
        <div className="reviewer-head">
          <div>
            <strong>{row.file}</strong>
            <span className="reviewer-count">
              {index + 1} of {rows.length}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {canJumpToClean && (
              <button type="button" className="link-button" onClick={() => onIndexChange(firstCleanIndex)}>
                Skip to Clean list →
              </button>
            )}
            <button type="button" className="link-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="reviewer-body">
          <div className="reviewer-doc">
            {previewable ? (
              <iframe src={url} title={row.file} />
            ) : (
              <div className="reviewer-nopreview">
                <p>This file can't be previewed here. Open it to read the contact details, then type them in on the right.</p>
                <a className="secondary" href={url} target="_blank" rel="noreferrer">
                  Open {row.file} <IconExternal width={13} height={13} />
                </a>
              </div>
            )}
          </div>

          <div className="reviewer-fields">
            {row.flags.length > 0 && (
              <div className="reviewer-flags">
                {row.approved && (
                  <p className="reviewer-approved-note">
                    <span className="flag-chip flag-chip-approved">Approved</span> Confirmed fine despite:
                  </p>
                )}
                {row.flags.map((f) => (
                  <div className="reviewer-flag" key={f}>
                    <span className="flag-chip">{f}</span>
                    <span className="reviewer-flag-help">{flagHelp(f)}</span>
                  </div>
                ))}
              </div>
            )}

            {stillFlagged && (
              <button type="button" className="approve-btn" onClick={() => onApprove(row.i)}>
                <IconCheck width={15} height={15} /> No issues — approve &amp; continue
              </button>
            )}

            <label className="field">
              <span>Name</span>
              <input type="text" value={draft.name} onChange={(e) => commit({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="text" value={draft.email} onChange={(e) => commit({ ...draft, email: e.target.value })} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input type="text" value={draft.phone} onChange={(e) => commit({ ...draft, phone: e.target.value })} />
            </label>

            {row.otherEmails && (
              <p className="hint">
                Other addresses found: <strong>{row.otherEmails}</strong>
              </p>
            )}

            <div className="actions" style={{ marginTop: "auto" }}>
              <button type="button" className="secondary" disabled={index === 0} onClick={() => step(-1)}>
                <IconArrowLeft width={15} height={15} /> Previous
              </button>
              {index < rows.length - 1 ? (
                <button type="button" className="primary" onClick={() => step(1)}>
                  Next CV
                </button>
              ) : (
                <button type="button" className="primary" onClick={onClose}>
                  <IconCheck width={15} height={15} /> Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
