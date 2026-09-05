/**
 * Builds a .xlsx from review rows with only the chosen columns, and triggers
 * a browser download for it. xlsx is loaded lazily — same reasoning as
 * buildRecipientsFile.js: it's a large dependency only needed on this action.
 */
export async function buildContactsSpreadsheet(rows, columns, filename = "cv_contacts.xlsx") {
  const XLSX = await import("xlsx");
  const header = columns.map((c) => c.label);
  const data = rows.map((r) => {
    const obj = {};
    for (const c of columns) {
      if (c.key === "flags") obj[c.label] = (r.flags || []).join(", ");
      else if (c.key === "approved") obj[c.label] = r.approved ? "Yes" : "";
      else obj[c.label] = r[c.key] || "";
    }
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header });
  ws["!cols"] = header.map(() => ({ wch: 28 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerDownload(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
