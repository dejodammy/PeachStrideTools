import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export const authConfigured = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI && SESSION_SECRET);

const oauthClient = authConfigured ? new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) : null;

export function isEmailAllowed(email) {
  return ALLOWED_EMAILS.has(String(email || "").toLowerCase());
}

export function generateAuthUrl(state) {
  return oauthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
}

/**
 * Exchanges the OAuth code for tokens and verifies the ID token's signature,
 * audience, and issuer against Google's public keys. Returns the verified
 * email, or throws if anything about the token doesn't check out.
 */
export async function verifyOAuthCode(code) {
  const { tokens } = await oauthClient.getToken(code);
  const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("Google did not return a verified email address.");
  }
  return payload.email;
}

// --- Stateless signed session cookie: HMAC(email + expiry), no server-side store ---
// Sessions survive restarts/redeploys since nothing is kept in memory; they stop
// being valid only if SESSION_SECRET changes or the expiry passes.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

export function createSessionToken(email) {
  const payload = `${email}:${Date.now() + SESSION_TTL_MS}`;
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = sign(encoded);
  const a = Buffer.from(signature || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [email, expiryStr] = Buffer.from(encoded, "base64url").toString().split(":");
  const expiry = Number(expiryStr);
  if (!email || !Number.isFinite(expiry) || Date.now() > expiry) return null;
  if (!isEmailAllowed(email)) return null; // revoked/removed since the cookie was issued
  return email;
}
