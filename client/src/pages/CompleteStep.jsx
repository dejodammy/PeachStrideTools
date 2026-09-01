import { logCsvUrl } from "../api.js";
import { IconCheck, IconDownload, IconSparkle } from "../icons.jsx";

export default function CompleteStep({ campaignId, status, onRestart }) {
  return (
    <div className="card">
      <div className="result-icon">
        <IconCheck />
      </div>
      <h2>Campaign sent</h2>
      <p className="summary">
        <strong>{status.sent}</strong> sent, <strong>{status.failed}</strong> failed, out of {status.total} recipient(s).
      </p>

      {status.failed > 0 && (
        <div className="banner warn">
          Some emails failed to send. Download the log below for the reason for each failure.
        </div>
      )}

      <div className="actions">
        <a className="secondary" href={logCsvUrl(campaignId)}>
          <IconDownload width={15} height={15} /> Download send log
        </a>
        <button type="button" className="primary" onClick={onRestart}>
          <IconSparkle width={14} height={14} /> Start a new campaign
        </button>
      </div>
    </div>
  );
}
