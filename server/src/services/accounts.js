import { DAILY_SEND_CAP } from "./senderUsage.js";

// Sender accounts come from environment variables (server/.env), never from the
// client. Two transports are supported per account:
//
//   SMTP (default) — sends directly through e.g. Gmail. Works locally and on a
//   VPS, but many PaaS hosts (Render free tier) block outbound SMTP entirely.
//     MAIL_ACCOUNT_1_EMAIL / _PASSWORD / _LABEL
//
//   Brevo — sends over their HTTPS API, so it works on hosts that block SMTP.
//     MAIL_ACCOUNT_1_TRANSPORT=brevo
//     MAIL_ACCOUNT_1_EMAIL / _API_KEY / _LABEL
//
// Optional per account: _DAILY_CAP (Gmail allows ~500/24h, Brevo's free tier
// allows 300/day — so the safe ceiling differs by provider).
function loadAccounts() {
  const accounts = [];
  let i = 1;
  while (process.env[`MAIL_ACCOUNT_${i}_EMAIL`]) {
    const email = process.env[`MAIL_ACCOUNT_${i}_EMAIL`].trim();
    const label = (process.env[`MAIL_ACCOUNT_${i}_LABEL`] || email).trim();
    const transport = (process.env[`MAIL_ACCOUNT_${i}_TRANSPORT`] || "smtp").trim().toLowerCase();
    const password = process.env[`MAIL_ACCOUNT_${i}_PASSWORD`] || "";
    const apiKey = process.env[`MAIL_ACCOUNT_${i}_API_KEY`] || "";
    const capRaw = Number(process.env[`MAIL_ACCOUNT_${i}_DAILY_CAP`]);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DAILY_SEND_CAP;

    const usable = transport === "brevo" ? Boolean(email && apiKey) : Boolean(email && password);
    if (usable) {
      accounts.push({ id: `account_${i}`, label, email, transport, password, apiKey, cap });
    }
    i += 1;
  }
  return accounts;
}

export const ACCOUNTS = loadAccounts();

export function getAccount(id) {
  return ACCOUNTS.find((a) => a.id === id);
}

// Safe to send to the browser: never includes the password or API key.
export function publicAccounts() {
  return ACCOUNTS.map(({ id, label, email, transport, cap }) => ({ id, label, email, transport, cap }));
}
