import express from "express";
import crypto from "node:crypto";
import {
  authConfigured,
  generateAuthUrl,
  verifyOAuthCode,
  isEmailAllowed,
  createSessionToken,
  verifySessionToken,
} from "../services/auth.js";

const router = express.Router();

const COOKIE_NAME = "session";
const STATE_COOKIE = "oauth_state";
const isProd = process.env.NODE_ENV === "production";

function cookieOpts(maxAgeMs) {
  return { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: maxAgeMs, path: "/" };
}

router.get("/google", (req, res) => {
  if (!authConfigured) return res.status(500).send("Google sign-in is not configured on this server yet.");
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOpts(5 * 60 * 1000));
  res.redirect(generateAuthUrl(state));
});

router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (error) return res.redirect("/?auth_error=" + encodeURIComponent(String(error)));
  if (!code || !state || state !== expectedState) {
    return res.redirect("/?auth_error=" + encodeURIComponent("Sign-in expired or was tampered with — try again."));
  }

  try {
    const email = await verifyOAuthCode(String(code));
    if (!isEmailAllowed(email)) {
      return res.redirect("/?auth_error=" + encodeURIComponent(`${email} is not on the approved list for this tool.`));
    }
    res.cookie(COOKIE_NAME, createSessionToken(email), cookieOpts(30 * 24 * 60 * 60 * 1000));
    res.redirect("/");
  } catch (err) {
    res.redirect("/?auth_error=" + encodeURIComponent("Sign-in failed: " + err.message));
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const email = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  if (!email) return res.status(401).json({ error: "Not signed in." });
  res.json({ email });
});

export default router;
