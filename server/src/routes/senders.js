import express from "express";
import { getRemaining } from "../services/senderUsage.js";

const router = express.Router();

router.get("/usage", async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) return res.status(400).json({ error: "email query param is required." });
  const usage = await getRemaining(email);
  res.json({ email, ...usage });
});

export default router;
