import { useState } from "react";
import { IconDownload } from "../icons.jsx";
import { buildContactsSpreadsheet, triggerDownload } from "../utils/downloadSpreadsheet.js";

export const DOWNLOAD_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "file", label: "Source File" },
  { key: "readAs", label: "Read As" },
  { key: "otherEmails", label: "Other Emails" },
  { key: "flags", label: "Flags" },
  { key: "approved", label: "Approved" },
];

const STORAGE_KEY = "cvextract:downloadColumns";

// Defaults to everything checked, so a first download matches what the old
// fixed-column export used to give — narrowing it down is opt-out, not
// opt-in, and whatever's picked is remembered for next time.
function loadSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return new Set(saved);
  } catch {
    /* ignore — fall through to the default */
  }
  return new Set(DOWNLOAD_COLUMNS.map((c) => c.key));
}

export default function DownloadPicker({ rows, onClose }) {
  const [selected, setSelected] = useState(loadSelection);
  const [saving, setSaving] = useState(false);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDownload() {
    const columns = DOWNLOAD_COLUMNS.filter((c) => selected.has(c.key));
    if (!columns.length) return;
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...selected]));
    } catch {
      /* private browsing or storage disabled — the choice just won't be remembered */
    }
    const file = await buildContactsSpreadsheet(rows, columns);
    triggerDownload(file);
    setSaving(false);
    onClose();
  }

  return (
    <div className="reviewer-overlay" onClick={onClose}>
      <div className="download-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Download spreadsheet</h3>
        <p className="hint">Choose which columns to include — {rows.length} contact(s).</p>

        <div className="download-picker-columns">
          {DOWNLOAD_COLUMNS.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>

        <div className="download-picker-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={selected.size === 0 || saving} onClick={handleDownload}>
            <IconDownload width={15} height={15} /> {saving ? "Preparing…" : "Download .xlsx"}
          </button>
        </div>
      </div>
    </div>
  );
}
