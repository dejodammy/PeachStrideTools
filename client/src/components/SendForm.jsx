import { useEffect, useState } from "react";
import { getAccounts, getSenderUsage } from "../api.js";
import { IconArrowLeft } from "../icons.jsx";

function QuotaHint({ usage, checking }) {
  if (checking) return <small>Checking today's usage…</small>;
  if (!usage) return null;
  const { used, cap, remaining } = usage;
  if (remaining <= 0) {
    return <small style={{ color: "var(--danger)" }}>{used}/{cap} used in the last 24h — this account is at its daily limit right now.</small>;
  }
  return <small>{used}/{cap} used in the last 24h — {remaining} left before the daily limit.</small>;
}

export default function SendForm({ recipientCount, submitLabel, onSubmit, onCancel, cancelLabel = "← Start over" }) {
  const [accounts, setAccounts] = useState(null); // null = still loading
  const [accountId, setAccountId] = useState("");
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupAccountId, setBackupAccountId] = useState("");
  const [smtpServer, setSmtpServer] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [delaySeconds, setDelaySeconds] = useState("2");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(null);
  const [backupUsage, setBackupUsage] = useState(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [checkingBackupUsage, setCheckingBackupUsage] = useState(false);

  useEffect(() => {
    getAccounts()
      .then(({ accounts: list }) => {
        setAccounts(list);
        if (list.length > 0) {
          setAccountId(list[0].id);
          checkUsage(list[0].email, setUsage, setCheckingUsage);
        }
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkUsage(email, setUsageFn, setCheckingFn) {
    if (!email) return setUsageFn(null);
    setCheckingFn(true);
    try {
      setUsageFn(await getSenderUsage(email));
    } catch {
      setUsageFn(null);
    } finally {
      setCheckingFn(false);
    }
  }

  function handleAccountChange(id) {
    setAccountId(id);
    const acc = accounts?.find((a) => a.id === id);
    if (acc) checkUsage(acc.email, setUsage, setCheckingUsage);
  }

  function handleBackupChange(id) {
    setBackupAccountId(id);
    const acc = accounts?.find((a) => a.id === id);
    if (acc) checkUsage(acc.email, setBackupUsage, setCheckingBackupUsage);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (confirmation !== "SEND") return setError("Type SEND (all caps) to confirm.");
    if (!accountId) return setError("Choose a sender account.");
    if (backupEnabled && !backupAccountId) return setError("Choose a backup account (or turn the toggle off).");

    setLoading(true);
    try {
      await onSubmit({
        accountId,
        backupAccountId: backupEnabled ? backupAccountId : undefined,
        smtpServer: smtpServer.trim(),
        smtpPort: Number(smtpPort),
        delaySeconds: Number(delaySeconds),
        confirmation,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (accounts === null) {
    return (
      <div className="send-form">
        <h3>Send campaign</h3>
        <p className="hint">Loading sender accounts…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="send-form">
        <h3>Send campaign</h3>
        <div className="banner error">
          No sender accounts are configured. Add MAIL_ACCOUNT_1_EMAIL / MAIL_ACCOUNT_1_PASSWORD (and optionally a
          second account) to <code>server/.env</code>, then restart the server.
        </div>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            <IconArrowLeft width={15} height={15} /> {cancelLabel}
          </button>
        )}
      </div>
    );
  }

  const backupOptions = accounts.filter((a) => a.id !== accountId);

  return (
    <form className="send-form" onSubmit={handleSubmit}>
      <h3>Send campaign</h3>
      <p className="hint">
        This sends real emails immediately once confirmed. Each account is capped at 450 sends per rolling 24h; add a
        second account below to combine capacity.
      </p>

      <div className="row">
        <label className="field">
          <span>Sender account</span>
          <select value={accountId} onChange={(e) => handleAccountChange(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.email}
              </option>
            ))}
          </select>
          <QuotaHint usage={usage} checking={checkingUsage} />
        </label>
      </div>

      {accounts.length > 1 && (
        <div className="field checkbox-field">
          <input
            id="backup-toggle"
            type="checkbox"
            checked={backupEnabled}
            onChange={(e) => {
              setBackupEnabled(e.target.checked);
              if (e.target.checked && !backupAccountId) {
                const fallback = accounts.find((a) => a.id !== accountId);
                if (fallback) handleBackupChange(fallback.id);
              }
            }}
          />
          <label htmlFor="backup-toggle">
            <span className="title">Use a second account for extra capacity</span>
            <span className="desc">
              Once the sender above hits its daily limit, remaining recipients automatically continue on this account.
            </span>
          </label>
        </div>
      )}

      {backupEnabled && (
        <div className="row">
          <label className="field">
            <span>Backup account</span>
            <select value={backupAccountId} onChange={(e) => handleBackupChange(e.target.value)}>
              {backupOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.email}
                </option>
              ))}
            </select>
            <QuotaHint usage={backupUsage} checking={checkingBackupUsage} />
          </label>
        </div>
      )}

      <div className="row">
        <label className="field">
          <span>SMTP server</span>
          <input type="text" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} />
        </label>
        <label className="field">
          <span>Port</span>
          <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
        </label>
        <label className="field">
          <span>Delay between emails (sec)</span>
          <input type="number" min="0" step="0.5" value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Type SEND to confirm</span>
        <input type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="SEND" />
      </label>

      {error && <div className="banner error">{error}</div>}

      <div className="actions">
        {onCancel ? (
          <button type="button" className="secondary" onClick={onCancel}>
            <IconArrowLeft width={15} height={15} /> {cancelLabel}
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="primary" disabled={loading}>
          {loading
            ? "Starting…"
            : recipientCount != null
            ? `${submitLabel} ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`
            : submitLabel}
        </button>
      </div>
    </form>
  );
}
