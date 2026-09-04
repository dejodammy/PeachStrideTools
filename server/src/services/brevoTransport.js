// Brevo (formerly Sendinblue) transport, speaking their HTTPS API instead of SMTP.
//
// Why this exists: many hosts (Render's free tier included) block outbound SMTP
// on every port, so nodemailer can't connect at all. Brevo's REST API runs over
// 443, which is never blocked. This object deliberately mirrors the small slice
// of the nodemailer transport interface that the send loop uses — verify(),
// sendMail(), close() — so campaigns.js doesn't care which one it's handed.

const API_BASE = "https://api.brevo.com/v3";

async function brevoFetch(apiKey, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const message = payload?.message || payload?.raw || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/**
 * Splits "Display Name <a@b.com>" into Brevo's { name, email } shape.
 */
function parseAddress(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(value || ""));
  if (match) return { name: match[1] || undefined, email: match[2] };
  return { email: String(value || "").trim() };
}

export function createBrevoTransport({ apiKey, senderName }) {
  return {
    /** Validates the API key, so a bad key fails before any sending starts. */
    async verify() {
      await brevoFetch(apiKey, "/account", { method: "GET" });
      return true;
    },

    async sendMail({ from, to, subject, text, attachments, replyTo }) {
      const sender = parseAddress(from);
      if (senderName && !sender.name) sender.name = senderName;

      const body = {
        sender,
        to: [parseAddress(to)],
        subject,
        textContent: text,
        ...(replyTo ? { replyTo: parseAddress(replyTo) } : {}),
      };

      if (attachments?.length) {
        body.attachment = attachments.map((a) => ({
          name: a.filename,
          content: Buffer.from(a.content).toString("base64"),
        }));
      }

      return brevoFetch(apiKey, "/smtp/email", { method: "POST", body: JSON.stringify(body) });
    },

    /** No persistent connection to tear down — here so the send loop can call it uniformly. */
    close() {},
  };
}
