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

export async function getMe() {
  const res = await fetch("/auth/me");
  if (res.status === 401) return null;
  return handle(res);
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
}

// ---- CV extraction ----
// A big batch is uploaded as several smaller requests against one job, so a
// single slow or flaky connection can't lose the whole thing at once:
// createExtractionJob (first batch) -> appendExtractionFiles (rest) -> beginExtraction.

export async function createExtractionJob(formData) {
  const res = await fetch("/api/cvextract", { method: "POST", body: formData });
  return handle(res);
}

export async function appendExtractionFiles(id, formData) {
  const res = await fetch(`/api/cvextract/${id}/files`, { method: "POST", body: formData });
  return handle(res);
}

export async function beginExtraction(id) {
  const res = await fetch(`/api/cvextract/${id}/start`, { method: "POST" });
  return handle(res);
}

export async function getExtractionStatus(id) {
  const res = await fetch(`/api/cvextract/${id}/status`);
  return handle(res);
}

export async function getExtractionResults(id) {
  const res = await fetch(`/api/cvextract/${id}/results`);
  return handle(res);
}

export function extractionDownloadUrl(id) {
  return `/api/cvextract/${id}/download`;
}

export function cvFileUrl(id, name) {
  return `/api/cvextract/${id}/file/${encodeURIComponent(name)}`;
}

export async function saveExtractionRows(id, rows) {
  const res = await fetch(`/api/cvextract/${id}/rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  return handle(res);
}

// ---- ID cards ----

export async function getIdCardBrands() {
  const res = await fetch("/api/idcards/brands");
  return handle(res);
}

export async function readIdCardRoster(file) {
  const formData = new FormData();
  formData.append("roster", file);
  const res = await fetch("/api/idcards/roster", { method: "POST", body: formData });
  return handle(res);
}

export async function previewIdCards(formData) {
  const res = await fetch("/api/idcards/preview", { method: "POST", body: formData });
  return handle(res);
}

// Not JSON — the response body is one card's PNG.
export async function downloadIdCard(formData) {
  const res = await fetch("/api/idcards/card", { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.blob();
}

// Not JSON — the response body is the zip file itself, so this doesn't go through handle().
export async function generateIdCards(formData) {
  const res = await fetch("/api/idcards/generate", { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.blob();
}

// Not JSON — the response body is the prepared image. Resolves to null when the
// server found nothing to work with (no ink in a "signature"), so the caller
// can fall back to the original upload.
export async function prepareIdCardImage(file, kind) {
  const formData = new FormData();
  formData.append("kind", kind);
  formData.append("image", file);
  const res = await fetch("/api/idcards/prepare-image", { method: "POST", body: formData });
  if (res.status === 422) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.blob();
}

export async function classifyIdCardImage(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/idcards/classify-image", { method: "POST", body: formData });
  return (await handle(res)).kind;
}
