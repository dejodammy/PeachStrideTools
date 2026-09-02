import express from "express";
import net from "node:net";
import dns from "node:dns";
import { promisify } from "node:util";

const resolve4 = promisify(dns.resolve4);
const router = express.Router();

// Host and ports are hardcoded on purpose — this must never become a
// general-purpose port scanner reachable from a public URL.
const SMTP_HOST = "smtp.gmail.com";
const PORTS = [587, 465, 25];
const PROBE_TIMEOUT_MS = 8000;

function probe(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, ms: Date.now() - started });
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => done({ ok: true, result: "connected" }));
    socket.once("timeout", () => done({ ok: false, result: "timeout (likely blocked)" }));
    socket.once("error", (err) => done({ ok: false, result: err.code || err.message }));
    socket.connect({ host, port, family: 4 });
  });
}

router.get("/smtp", async (req, res) => {
  let addresses = [];
  let dnsError = null;
  try {
    addresses = await resolve4(SMTP_HOST);
  } catch (err) {
    dnsError = err.message;
  }

  const target = addresses[0] || SMTP_HOST;
  const ports = {};
  for (const port of PORTS) {
    ports[port] = await probe(target, port);
  }

  res.json({ host: SMTP_HOST, resolvedIPv4: addresses, dnsError, probedAgainst: target, ports });
});

export default router;
