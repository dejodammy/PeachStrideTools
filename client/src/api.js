const BASE = "/api/campaigns";

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function createCampaign(formData) {
  const res = await fetch(BASE, { method: "POST", body: formData });
  return handle(res);
}

export async function getCampaign(id) {
  const res = await fetch(`${BASE}/${id}`);
  return handle(res);
}

export function previewPdfUrl(id) {
  return `${BASE}/${id}/preview.pdf`;
}

export async function startSend(id, payload) {
  const res = await fetch(`${BASE}/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function getStatus(id) {
  const res = await fetch(`${BASE}/${id}/status`);
  return handle(res);
}

export function logCsvUrl(id) {
  return `${BASE}/${id}/log.csv`;
}

export async function getDefaultTemplate() {
  const res = await fetch("/api/templates/default");
  if (!res.ok) throw new Error("Could not load the starter template.");
  return res.text();
}

export async function getSenderUsage(email) {
  const res = await fetch(`/api/senders/usage?email=${encodeURIComponent(email)}`);
  return handle(res);
}

export async function getAccounts() {
  const res = await fetch("/api/senders/accounts");
  return handle(res);
}
