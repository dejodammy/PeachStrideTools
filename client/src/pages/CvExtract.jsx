import { useEffect, useRef, useState } from "react";
import {
  startExtraction,
  getExtractionStatus,
  getExtractionResults,
  extractionDownloadUrl,
  saveExtractionRows,
} from "../api.js";
import { IconUpload, IconDownload, IconCheck, IconMail, IconFileText } from "../icons.jsx";
import CvReviewer from "../components/CvReviewer.jsx";

// Plain-English explanations for the flags cvextract raises, so a reviewer
// knows what to actually check rather than decoding a constant name.
const FLAG_HELP = {
  NO_EMAIL: "No address found anywhere in the document.",
  MULTI_EMAIL: "Several addresses found — the best name match was used.",
  OCR_USED: "No text layer; read from the page image. Check the characters.",
  NAME_LOW_CONFIDENCE: "No line looked clearly like a name.",
  NAME_FROM_FILENAME: "No name in the document — taken from the file name.",
  NAME_JOINED_FROM_TWO_LINES: "Name was split across lines and rejoined.",
  EMAIL_LABEL_STRIPPED: "A label was glued to the address and removed. Confirm it.",
  EMAIL_ONLY_IN_REFEREE_BLOCK: "The only address sits under REFEREES — may be the referee's, not the candidate's.",
  DUPLICATE_IN_BATCH: "The same address appears on more than one CV.",
  NO_PHONE: "No Nigerian mobile found outside the referee block.",
  UNSUPPORTED_FORMAT: "File type not supported.",
  NO_TEXT_FOUND: "Nothing could be extracted from this file.",
  READ_FAILED: "The file could not be read.",
  DOC_NEEDS_WORD_OR_LIBREOFFICE: "Legacy .doc needs Word or LibreOffice, which this server does not have.",
};

function flagHelp(flag) {
  if (FLAG_HELP[flag]) return FLAG_HELP[flag];
  if (flag.startsWith("DOMAIN_NEAR_")) return `Domain is 1–2 letters off ${flag.replace("DOMAIN_NEAR_", "")} — typo, or a rarer host.`;
  if (flag.startsWith("READ_FAILED")) return FLAG_HELP.READ_FAILED;
  return flag;
}

function Row({ row, onChange, onView }) {
  return (
    <tr className={row.flags.length ? "row-flagged" : ""}>
      <td>
        <button type="button" className="view-btn" onClick={onView} title={`Open ${row.file}`}>
          <IconFileText width={14} height={14} /> View
        </button>
      </td>
      <td>
        <input className="cell-input" value={row.name} onChange={(e) => onChange({ ...row, name: e.target.value })} />
      </td>
      <td>
        <input className="cell-input" value={row.email} onChange={(e) => onChange({ ...row, email: e.target.value })} />
      </td>
      <td>
        <input className="cell-input" value={row.phone} onChange={(e) => onChange({ ...row, phone: e.target.value })} />
      </td>
      <td className="cell-file" title={row.file}>{row.file}</td>
      <td className="cell-flags">
        {row.flags.map((f) => (
          <span className="flag-chip" key={f} title={flagHelp(f)}>
            {f}
          </span>
        ))}
      </td>
    </tr>
  );
}

export default function CvExtract({ onUseContacts }) {
  const [files, setFiles] = useState([]);
  const [viewing, setViewing] = useState(null); // index into `rows`
  const [saveState, setSaveState] = useState("");
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleStart(e) {
    e.preventDefault();
    setError("");
    if (!files.length) return setError("Choose some CV files first.");

    const fd = new FormData();
    for (const f of files) fd.append("cvs", f);

    try {
      const { id, skipped } = await startExtraction(fd);
      setJobId(id);
      if (skipped) setError(`${skipped} file(s) skipped — only .pdf, .docx and .doc are read.`);
      poll(id);
    } catch (err) {
      setError(err.message);
    }
  }

  function poll(id) {
    (async function tick() {
      try {
        const s = await getExtractionStatus(id);
        setStatus(s);
        if (s.state === "done") {
          const { rows } = await getExtractionResults(id);
          setRows(rows);
          return;
        }
        if (s.state === "error") {
          setError(s.error || "Extraction failed.");
          return;
        }
      } catch (err) {
        setError(err.message);
        return;
      }
      timer.current = setTimeout(tick, 1000);
    })();
  }

  async function handleSave(updated) {
    const toSave = updated || rows;
    setSaveState("saving");
    try {
      await saveExtractionRows(jobId, toSave);
      setSaveState("saved");
      setTimeout(() => setSaveState(""), 2500);
    } catch (err) {
      setSaveState("");
      setError("Could not save your corrections: " + err.message);
    }
  }

  function reset() {
    clearTimeout(timer.current);
    setFiles([]);
    setJobId(null);
    setStatus(null);
    setRows(null);
    setError("");
  }

  // ---- Results: flagged first, because guessing at a contact address is the
  // one failure this tool exists to prevent. ----
  if (rows) {
    const flagged = rows.filter((r) => r.flags.length);
    const clean = rows.filter((r) => !r.flags.length);
    const sendable = rows.filter((r) => r.email.trim());

    return (
      <div className="card">
        <h2>Extracted contacts</h2>
        <p className="summary">
          <strong>{rows.length}</strong> CV(s) read — <strong>{clean.length}</strong> clean,{" "}
          <strong>{flagged.length}</strong> need a look.
        </p>

        {flagged.length > 0 && (
          <div className="preview-block">
            <h3>Needs review — {flagged.length}</h3>
            <p className="hint">
              These were flagged rather than guessed at. Hover a flag to see why. Correct anything
              wrong here — your edits are included when you continue.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th></th><th>Name</th><th>Email</th><th>Phone</th><th>Source file</th><th>Flags</th></tr>
                </thead>
                <tbody>
                  {flagged.map((r) => (
                    <Row
                      key={r.i}
                      row={r}
                      onView={() => setViewing(rows.findIndex((x) => x.i === r.i))}
                      onChange={(u) => setRows(rows.map((x) => (x.i === u.i ? u : x)))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {clean.length > 0 && (
          <div className="preview-block">
            <h3>Clean — {clean.length}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th></th><th>Name</th><th>Email</th><th>Phone</th><th>Source file</th><th>Flags</th></tr>
                </thead>
                <tbody>
                  {clean.map((r) => (
                    <Row
                      key={r.i}
                      row={r}
                      onView={() => setViewing(rows.findIndex((x) => x.i === r.i))}
                      onChange={(u) => setRows(rows.map((x) => (x.i === u.i ? u : x)))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {viewing !== null && (
          <CvReviewer
            jobId={jobId}
            rows={rows}
            index={viewing}
            flagHelp={flagHelp}
            onIndexChange={setViewing}
            onClose={() => {
              setViewing(null);
              handleSave();
            }}
            onChange={(u) => setRows(rows.map((x) => (x.i === u.i ? u : x)))}
          />
        )}

        {error && <div className="banner error">{error}</div>}

        <div className="actions">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <a className="secondary" href={extractionDownloadUrl(jobId)}>
              <IconDownload width={15} height={15} /> Download spreadsheet
            </a>
            <button type="button" className="secondary" onClick={() => handleSave()} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to spreadsheet" : "Save corrections"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="secondary" onClick={reset}>
              Extract another batch
            </button>
            <button
              type="button"
              className="primary"
              disabled={!sendable.length}
              onClick={() => onUseContacts(sendable)}
              title={sendable.length ? "" : "No rows have an email address"}
            >
              <IconMail width={15} height={15} /> Use {sendable.length} contact(s) in a campaign
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Running ----
  if (jobId && status && status.state === "running") {
    const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
    return (
      <div className="card">
        <h2>
          <span className="pulse-dot" />
          Reading CVs
        </h2>
        <div className="progress-header">
          <span className="hint" style={{ margin: 0 }}>{status.done} of {status.total}</span>
          <span className="progress-pct">{pct}%</span>
        </div>
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        <div className="progress-stats">
          <div className="stat"><div className="num">{status.done - status.flagged}</div><div className="label">Clean</div></div>
          <div className="stat"><div className="num">{status.flagged}</div><div className="label">Flagged</div></div>
        </div>
        {status.current && <p className="hint">{status.current}</p>}
      </div>
    );
  }

  // ---- Upload ----
  return (
    <form className="card" onSubmit={handleStart}>
      <h2>Extract contacts from CVs</h2>
      <p className="lede">
        Reads names, emails and phone numbers out of a folder of CVs. Anything it isn't sure of is
        flagged for you rather than guessed at.
      </p>

      <label className="field">
        <span>CV files</span>
        <label className="file-drop">
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.doc"
            onChange={(e) => setFiles([...e.target.files])}
          />
          <span className="icon"><IconUpload /></span>
          <span className="text">
            <span className="primary-text">
              {files.length ? `${files.length} file(s) selected` : "Choose CV files"}
            </span>
            <span className="secondary-text">
              {files.length
                ? "Click to change selection"
                : "Select many at once — .pdf, .docx and .doc"}
            </span>
          </span>
        </label>
        <small>
          Scanned PDFs need OCR, which this server doesn't have — those will be flagged as
          unreadable rather than silently returning nothing.
        </small>
      </label>

      {error && <div className="banner error">{error}</div>}

      <button type="submit" className="primary" style={{ width: "100%", marginTop: 8 }}>
        <IconCheck width={15} height={15} /> Extract from {files.length || 0} file(s)
      </button>
    </form>
  );
}
