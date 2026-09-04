import { DAILY_SEND_CAP } from "./senderUsage.js";

// Sender accounts come from environment variables (server/.env), never from the
// client. Two transports are supported per account:
//
//   SMTP (default) — sends through any SMTP relay.
//     MAIL_ACCOUNT_1_EMAIL / _PASSWORD / _LABEL
//     Optional: _SMTP_HOST, _SMTP_PORT, _SMTP_USER
//
//     Gmail needs none of the optional three (host/port fall back to whatever
//     the send form supplies, and the login name is the address itself).
//
//     Amazon SES needs all three, because its login name is an IAM key rather
//     than the From address, and DigitalOcean blocks 25/465/587 — SES's
//     alternate ports 2587 (STARTTLS) and 2465 (TLS) get through:
//       MAIL_ACCOUNT_1_EMAIL=recruitment@yourdomain.com   <- the From address
//       MAIL_ACCOUNT_1_SMTP_HOST=email-smtp.eu-west-1.amazonaws.com
//       MAIL_ACCOUNT_1_SMTP_PORT=2587
//       MAIL_ACCOUNT_1_SMTP_USER=AKIA...                  <- SES SMTP username
//       MAIL_ACCOUNT_1_PASSWORD=...                       <- SES SMTP password
//
//   Brevo — sends over their HTTPS API, so it works even where SMTP is blocked.
//     MAIL_ACCOUNT_1_TRANSPORT=brevo
//     MAIL_ACCOUNT_1_EMAIL / _API_KEY / _LABEL
//
// Optional per account: _DAILY_CAP (Gmail ~500/24h, Brevo free 300/day, SES
// production typically far higher — so the safe ceiling differs by provider).
function loadAccounts() {
  const accounts = [];
  let i = 1;
  while (process.env[`MAIL_ACCOUNT_${i}_EMAIL`]) {
    const email = process.env[`MAIL_ACCOUNT_${i}_EMAIL`].trim();
    const label = (process.env[`MAIL_ACCOUNT_${i}_LABEL`] || email).trim();
    const transport = (process.env[`MAIL_ACCOUNT_${i}_TRANSPORT`] || "smtp").trim().toLowerCase();
    const password = process.env[`MAIL_ACCOUNT_${i}_PASSWORD`] || "";
    const apiKey = process.env[`MAIL_ACCOUNT_${i}_API_KEY`] || "";
    const smtpHost = (process.env[`MAIL_ACCOUNT_${i}_SMTP_HOST`] || "").trim();
    const smtpPortRaw = Number(process.env[`MAIL_ACCOUNT_${i}_SMTP_PORT`]);
    const smtpPort = Number.isFinite(smtpPortRaw) && smtpPortRaw > 0 ? smtpPortRaw : null;
    // Most relays log in as the address itself (Gmail); SES uses a separate key.
    const smtpUser = (process.env[`MAIL_ACCOUNT_${i}_SMTP_USER`] || "").trim() || email;
    // Optional: send from the domain (good deliverability) but route replies to
    // an inbox that is actually monitored.
    const replyTo = (process.env[`MAIL_ACCOUNT_${i}_REPLY_TO`] || "").trim();
    const capRaw = Number(process.env[`MAIL_ACCOUNT_${i}_DAILY_CAP`]);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DAILY_SEND_CAP;

    const usable = transport === "brevo" ? Boolean(email && apiKey) : Boolean(email && password);
    if (usable) {
      accounts.push({
        id: `account_${i}`,
        label,
        email,
        transport,
        password,
        apiKey,
        smtpHost,
        smtpPort,
        smtpUser,
        replyTo,
        cap,
      });
    }
    i += 1;
  }
  return accounts;
}

export const ACCOUNTS = loadAccounts();

export function getAccount(id) {
  return ACCOUNTS.find((a) => a.id === id);
}

// Safe to send to the browser: never includes the password, API key, or SMTP login.
export function publicAccounts() {
  return ACCOUNTS.map(({ id, label, email, transport, cap }) => ({ id, label, email, transport, cap }));
}
