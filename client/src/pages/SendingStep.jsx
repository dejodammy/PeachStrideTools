import { useEffect, useState, useRef } from "react";
import { getStatus } from "../api.js";

export default function SendingStep({ campaignId, onDone }) {
  const [status, setStatus] = useState({ total: 0, sent: 0, failed: 0, done: false });
  const [error, setError] = useState("");
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await getStatus(campaignId);
        if (cancelled) return;
        setStatus(s);
        if (s.error) setError(s.error);
        if (s.done) {
          onDone(s);
          return;
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      timerRef.current = setTimeout(poll, 1500);
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const processed = status.sent + status.failed;
  const pct = status.total ? Math.round((processed / status.total) * 100) : 0;

  return (
    <div className="card">
      <h2>
        <span className="pulse-dot" />
        Sending your campaign
      </h2>
      <p className="lede">Keep this tab open, or come back later — sending continues on the server either way.</p>

      <div className="progress-header">
        <span className="hint" style={{ margin: 0 }}>
          {processed} of {status.total} processed
        </span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="progress-stats">
        <div className="stat">
          <div className="num">{status.sent}</div>
          <div className="label">Sent</div>
        </div>
        <div className="stat">
          <div className="num">{status.failed}</div>
          <div className="label">Failed</div>
        </div>
        <div className="stat">
          <div className="num">{status.total - processed}</div>
          <div className="label">Remaining</div>
        </div>
      </div>

      {error && <div className="banner error" style={{ marginTop: 20 }}>{error}</div>}
    </div>
  );
}
