import nodemailer from "nodemailer";
import dns from "node:dns";
import { promisify } from "node:util";

const resolve4 = promisify(dns.resolve4);

export async function createTransport({ server, port, sender, password }) {
  // nodemailer 9's own DNS layer resolves both A and AAAA records and picks a
  // RANDOM address to connect to (see lib/shared/index.js formatDNSValue) — it
  // does not honor a top-level `family` option. On hosts without outbound IPv6
  // routing (Render included), landing on the AAAA record fails instantly with
  // ENETUNREACH. Resolving to a literal IPv4 address ourselves and passing that
  // as `host` sidesteps nodemailer's resolver entirely (a literal IP short-
  // circuits it) — `servername` keeps TLS/SNI pointed at the real hostname.
  let host = server;
  try {
    const addresses = await resolve4(server);
    if (addresses?.length) host = addresses[Math.floor(Math.random() * addresses.length)];
  } catch {
    // DNS lookup failed (unusual) — fall back to the hostname and let
    // nodemailer's own resolver handle it.
  }

  return nodemailer.createTransport({
    host,
    servername: server,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 (default) uses STARTTLS
    auth: { user: sender, pass: password },
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
