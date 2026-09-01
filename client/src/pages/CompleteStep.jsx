import { logCsvUrl } from "../api.js";

export default function CompleteStep({ campaignId, status, onRestart }) {
  return (
    <div className="card">
      <h2>4. Done</h2>
      <p className="summary">
        Finished — <strong>{status.sent}</strong> sent, <strong>{status.failed}</strong> failed, out of {status.total} recipient(s).
      </p>

      {status.failed > 0 && (
        <div className="banner warn">
          Some emails failed to send. Download the log below for the reason for each failure.
        </div>
      )}

      <div className="actions">
        <a className="secondary" href={logCsvUrl(campaignId)}>
          Download send log (CSV)
        </a>
        <button type="button" className="primary" onClick={onRestart}>
          Start a new campaign
        </button>
      </div>
    </div>
  );
}
