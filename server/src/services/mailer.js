import nodemailer from "nodemailer";

export function createTransport({ server, port, sender, password }) {
  return nodemailer.createTransport({
    host: server,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 (default) uses STARTTLS
    auth: { user: sender, pass: password },
    // smtp.gmail.com resolves to both an IPv4 and IPv6 address. Many hosts (Render
    // included) don't route outbound IPv6, so picking the AAAA record fails instantly
    // with ENETUNREACH rather than timing out. Force IPv4.
    family: 4,
    // Generous timeouts: reaching smtp.gmail.com from cloud-hosting IP ranges (Render,
    // Heroku, etc.) is sometimes just slower than from a home/office connection.
    connectionTimeout: 60_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

/**
 * Send one email. `attachments` is an array of { filename, content (Buffer), contentType }.
 */
export async function sendOne(transport, { from, to, subject, text, attachments }) {
  await transport.sendMail({ from, to, subject, text, attachments });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
