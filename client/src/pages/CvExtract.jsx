import { useEffect, useRef, useState } from "react";
import {
  createExtractionJob,
  appendExtractionFiles,
  beginExtraction,
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
  NO_PHONE: "No phone number, Nigerian or foreign, found outside the referee block.",
  FOREIGN_PHONE: "No Nigerian mobile on this CV — a non-Nigerian number was used instead. Check the country code and digit count.",
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

// The extraction keeps running on the server after a reload — this just
// remembers which job to reconnect to so the browser can catch back up
// instead of stranding a finished (or still-running) batch with no way back.
const JOB_KEY = "cvextract:jobId";
function rememberJob(id) {
  try {
    localStorage.setItem(JOB_KEY, id);
  } catch {
    /* private browsing or storage disabled — resume-on-reload just won't work */
  }
}
function forgetJob() {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    /* nothing to clean up if it never stored */
  }
}
function recalledJob() {
  try {
    return localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
}

// A single request carrying a large batch is what got a 300-file upload
// killed mid-transfer on a slow connection — Caddy and the server both saw
// the browser cancel it partway through. Splitting the selection into
// several smaller requests means one stalled batch is a small, retryable
// loss instead of the whole thing.
const BATCH_TARGET_BYTES = 12 * 1024 * 1024; // ~12MB per request finishes in well under a minute on a poor connection
const BATCH_MAX_FILES = 150; // a ceiling for selections of many tiny files, so one request never carries an unreasonable count

function chunkFiles(files) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const f of files) {
    if (current.length && (currentBytes + f.size > BATCH_TARGET_BYTES || current.length >= BATCH_MAX_FILES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(f);
    currentBytes += f.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

// One retry, after a short pause, before giving up on a batch — most drops
// on a shaky connection are a one-off blip, not a lost cause.
async function withRetry(fn) {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 1200));
    return await fn();
  }
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
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { batch, batches, filesSent, filesTotal }
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Reconnect to a batch that was already running (or already finished) when
  // this tab loaded — a reload or an accidental back-navigation shouldn't
  // strand an in-progress extraction with no way to reach the results.
  useEffect(() => {
    const saved = recalledJob();
    if (!saved) return;
    getExtractionStatus(saved)
      .then(() => {
        setJobId(saved);
        poll(saved);
      })
      .catch(() => forgetJob()); // that job is gone (expired, or server restarted before it started) — nothing to resume
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart(e) {
    e.preventDefault();
    setError("");
    if (!files.length) return setError("Choose some CV files first.");
    if (submitting) return; // already uploading — the button is disabled, but guard the double-submit anyway

    const batches = chunkFiles(files);
    setSubmitting(true);
    setUploadProgress({ batch: 0, batches: batches.length, filesSent: 0, filesTotal: files.length });

    try {
      let id = null;
      let filesSent = 0;
      let skippedTotal = 0;

      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const fd = new FormData();
        for (const f of batch) fd.append("cvs", f);

        const result = await withRetry(() => (id ? appendExtractionFiles(id, fd) : createExtractionJob(fd)));
        id = id || result.id;
        skippedTotal += result.skipped || 0;
        filesSent += batch.length;
        setUploadProgress({ batch: i + 1, batches: batches.length, filesSent, filesTotal: files.length });
      }

      await beginExtraction(id);
      rememberJob(id);
      setJobId(id);
      if (skippedTotal) setError(`${skippedTotal} file(s) skipped — only .pdf, .docx and .doc are read.`);
      poll(id);
    } catch (err) {
      // A batch failed twice in a row — on a batch this small (~12MB) that
      // almost always means the connection itself dropped, not a server fault.
      setError(
        "That upload didn't go through — the connection dropped partway through. " +
          "Try again, ideally on a steadier connection; smaller selections are less likely to be affected."
      );
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  function poll(id, misses = 0) {
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
        // A status check can land in the narrow gap between "extraction was
        // told to start" and its status file actually being written — retry
        // a few times before treating it as a real failure, rather than
        // giving up on what might just be a one-tick race.
        if (misses < 5) {
          timer.current = setTimeout(() => poll(id, misses + 1), 1000);
          return;
        }
        // Whatever broke contact with this job — a dropped connection, or a
        // tab that was open before an update changed how the server expects
        // to be talked to — a reload fixes both: it picks up the current
        // client code, and resumes this exact job if it's still running.
        setError("Lost track of this extraction. Refresh the page and try again — if it's still running, reloading will pick it back up.");
        return;
      }
      timer.current = setTimeout(() => poll(id, 0), 1000);
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
    forgetJob();
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

      <button
        type="submit"
        className="primary"
        style={{ width: "100%", marginTop: 8 }}
        disabled={submitting || !files.length}
      >
        {submitting ? (
          <>
            <span className="btn-spinner" />
            {uploadProgress && uploadProgress.batches > 1
              ? `Uploading ${uploadProgress.filesSent} of ${uploadProgress.filesTotal} files (batch ${uploadProgress.batch} of ${uploadProgress.batches})…`
              : `Uploading ${files.length} file(s)…`}
          </>
        ) : (
          <>
            <IconCheck width={15} height={15} /> Extract from {files.length || 0} file(s)
          </>
        )}
      </button>
    </form>
  );
}
