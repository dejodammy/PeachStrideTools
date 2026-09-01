// Reads just the header row of an uploaded spreadsheet, entirely client-side —
// no server round-trip needed before the user has even finished composing.
// xlsx is loaded lazily (dynamic import) so its ~350KB isn't in the initial bundle.
export async function readSpreadsheetColumns(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const header = rows[0] || [];
  return header.map((h) => String(h ?? "").trim()).filter(Boolean);
}
