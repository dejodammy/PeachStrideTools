import { useState } from "react";
import { getSenderUsage } from "../api.js";
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
  const [sender, setSender] = useState("");
  const [password, setPassword] = useState("");
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupSender, setBackupSender] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
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

  async function checkUsage(email, setUsageFn, setCheckingFn) {
    if (!email.trim() || !email.includes("@")) return;
    setCheckingFn(true);
    try {
      const result = await getSenderUsage(email.trim());
      setUsageFn(result);
    } catch {
      setUsageFn(null);
    } finally {
      setCheckingFn(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (confirmation !== "SEND") return setError("Type SEND (all caps) to confirm.");
    if (!sender.trim() || !password) return setError("Enter the sender email and app password.");
    if (backupEnabled && (!backupSender.trim() || !backupPassword)) {
      return setError("The backup account needs both an email and an app password (or turn it off).");
    }

    setLoading(true);
    try {
      await onSubmit({
        sender: sender.trim(),
        password,
        backupSender: backupEnabled ? backupSender.trim() : undefined,
        backupPassword: backupEnabled ? backupPassword : undefined,
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

  return (
    <form className="send-form" onSubmit={handleSubmit}>
      <h3>Send campaign</h3>
      <p className="hint">
        This sends real emails immediately once confirmed. Use a Gmail App Password, not your normal password — it is
        never stored. Each Gmail account is capped at 450 sends per rolling 24h; add a second account below to combine
        capacity.
      </p>

      <div className="row">
        <label className="field">
          <span>Sender email</span>
          <input
            type="email"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            onBlur={(e) => checkUsage(e.target.value, setUsage, setCheckingUsage)}
          />
          <QuotaHint usage={usage} checking={checkingUsage} />
        </label>
        <label className="field">
          <span>App password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>

      <div className="field checkbox-field">
        <input
          id="backup-toggle"
          type="checkbox"
          checked={backupEnabled}
          onChange={(e) => setBackupEnabled(e.target.checked)}
        />
        <label htmlFor="backup-toggle">
          <span className="title">Use a second Gmail account for extra capacity</span>
          <span className="desc">
            Once the sender above hits its daily limit, remaining recipients automatically continue on this account.
          </span>
        </label>
      </div>

      {backupEnabled && (
        <div className="row">
          <label className="field">
            <span>Backup sender email</span>
            <input
              type="email"
              value={backupSender}
              onChange={(e) => setBackupSender(e.target.value)}
              onBlur={(e) => checkUsage(e.target.value, setBackupUsage, setCheckingBackupUsage)}
            />
            <QuotaHint usage={backupUsage} checking={checkingBackupUsage} />
          </label>
          <label className="field">
            <span>Backup app password</span>
            <input type="password" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} />
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
