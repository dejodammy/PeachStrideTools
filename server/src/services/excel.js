import XLSX from "xlsx";

/**
 * Parse an uploaded recipients spreadsheet buffer into row objects.
 * Requires an "Email" column (exact header). Rows without an email are dropped.
 * Returns { columns, rows, dropped } where rows are plain objects keyed by header.
 */
export function parseRecipients(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The spreadsheet has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  if (rawRows.length === 0) {
    throw new Error("The spreadsheet has no data rows.");
  }

  const columns = Object.keys(rawRows[0]);
  if (!columns.includes("Email")) {
    throw new Error('Your spreadsheet must have a column named exactly "Email".');
  }

  let dropped = 0;
  const rows = [];
  for (const raw of rawRows) {
    const row = {};
    for (const col of columns) {
      row[col] = typeof raw[col] === "string" ? raw[col].trim() : raw[col];
    }
    if (!row.Email) {
      dropped += 1;
      continue;
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("No rows have an email address.");
  }

  return { columns, rows, dropped };
}
