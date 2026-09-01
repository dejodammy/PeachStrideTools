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
      <h2>3. Sending…</h2>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="summary">
        {processed} / {status.total} processed — <strong>{status.sent}</strong> sent, <strong>{status.failed}</strong> failed
      </p>
      {error && <div className="banner error">{error}</div>}
      <p className="hint">You can leave this page open — sending continues on the server either way.</p>
    </div>
  );
}
