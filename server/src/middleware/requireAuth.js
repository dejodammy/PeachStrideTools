import { authConfigured, verifySessionToken } from "../services/auth.js";

/**
 * Protects the API routes that actually matter — creating/sending campaigns,
 * account info. Deliberately does NOT gate the SPA shell or static assets:
 * the React app itself checks /api/auth/me and shows a sign-in screen when
 * unauthenticated, which avoids server-side redirect loops on a client-routed
 * app. Health and the default-template endpoint stay public — neither leaks
 * anything sensitive, and the health check is useful unauthenticated.
 */
export function requireAuth(req, res, next) {
  if (!authConfigured) {
    // Auth isn't set up yet (no GOOGLE_CLIENT_ID etc.) — fail closed with a
    // clear message rather than silently leaving the API open.
    return res.status(503).json({ error: "Sign-in is not configured on this server yet." });
  }
  const email = verifySessionToken(req.cookies?.session);
  if (!email) return res.status(401).json({ error: "Sign in required." });
  req.userEmail = email;
  next();
}
