import express from "express";
import { getUsage, DAILY_SEND_CAP } from "../services/senderUsage.js";
import { publicAccounts, ACCOUNTS } from "../services/accounts.js";

const router = express.Router();

router.get("/accounts", (req, res) => {
  res.json({ accounts: publicAccounts() });
});

router.get("/usage", async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) return res.status(400).json({ error: "email query param is required." });

  // Caps differ per account (Gmail ~500/24h, Brevo's free tier 300/day), so
  // report the configured account's own ceiling rather than a global default.
  const account = ACCOUNTS.find((a) => a.email.toLowerCase() === email.toLowerCase());
  const cap = account?.cap || DAILY_SEND_CAP;
  const used = await getUsage(email);

  res.json({ email, used, cap, remaining: Math.max(0, cap - used) });
});

export default router;
