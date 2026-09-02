import { useState } from "react";
import { logCsvUrl, startSend } from "../api.js";
import { IconCheck, IconClock, IconDownload, IconSparkle } from "../icons.jsx";
import SendForm from "../components/SendForm.jsx";

export default function CompleteStep({ campaignId, status, onRestart, onResumed }) {
  const [resuming, setResuming] = useState(false);

  async function handleResume(values) {
    await startSend(campaignId, { ...values, force: true });
    onResumed();
  }

  return (
    <div className="card">
      <div className={`result-icon${status.capped ? " warn" : ""}`}>
        {status.capped ? <IconClock /> : <IconCheck />}
      </div>
      <h2>{status.capped ? "Daily sending limit reached" : "Campaign sent"}</h2>
      <p className="summary">
        <strong>{status.sent}</strong> sent, <strong>{status.failed}</strong> failed, out of {status.total} recipient(s).
      </p>

      {status.capped && (
        <div className="banner warn">
          {status.remaining} recipient(s) were not yet emailed — every configured account is at its 450/24h limit.
          Come back once the rolling window frees up (or add a different account below) to send the rest.
        </div>
      )}

      {!status.capped && status.failed > 0 && (
        <div className="banner warn">
          Some emails failed to send. Download the log below for the reason for each failure.
        </div>
      )}

      {status.senders?.length > 0 && (
        <div className="preview-block">
          <h3>Account usage</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Used (24h)</th>
                </tr>
              </thead>
              <tbody>
                {status.senders.map((s) => (
                  <tr key={s.email}>
                    <td>{s.email}</td>
                    <td>{s.used} / {s.cap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="actions">
        <a className="secondary" href={logCsvUrl(campaignId)}>
          <IconDownload width={15} height={15} /> Download send log
        </a>
        {status.capped ? (
          <button type="button" className="primary" onClick={() => setResuming((v) => !v)}>
            {resuming ? "Hide" : "Resume remaining sends"}
          </button>
        ) : (
          <button type="button" className="primary" onClick={onRestart}>
            <IconSparkle width={14} height={14} /> Start a new campaign
          </button>
        )}
      </div>

      {status.capped && resuming && (
        <>
          <hr className="section-divider" />
          <SendForm recipientCount={status.remaining} submitLabel="Resume sending to" onSubmit={handleResume} />
        </>
      )}
    </div>
  );
}
