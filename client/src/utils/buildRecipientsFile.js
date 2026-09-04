/**
 * Turns reviewed CV rows into the same .xlsx the mailer already accepts, so the
 * hand-off reuses the existing upload path rather than a second code route.
 * xlsx is loaded lazily — it's a large dependency and only needed on this action.
 */
export async function buildRecipientsFile(rows, filename = "extracted_contacts.xlsx") {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => ({
    Name: r.name || "",
    Email: r.email || "",
    Phone: r.phone || "",
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: ["Name", "Email", "Phone"] });
  ws["!cols"] = [{ wch: 26 }, { wch: 32 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recipients");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
