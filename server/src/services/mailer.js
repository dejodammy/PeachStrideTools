import nodemailer from "nodemailer";

export function createTransport({ server, port, sender, password }) {
  return nodemailer.createTransport({
    host: server,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 (default) uses STARTTLS
    auth: { user: sender, pass: password },
    connectionTimeout: 30_000,
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
