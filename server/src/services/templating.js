import Handlebars from "handlebars";

// Every campaign column is exposed two ways in templates:
//   {{ ColumnName }}        - works when the header has no spaces/special characters
//   {{ lookup this "Column Name" }} - always works, handles spaces/punctuation in headers
// (Handlebars ships the `lookup` helper by default, so no custom registration is needed.)

const compileCache = new Map();

function compile(templateStr) {
  if (!compileCache.has(templateStr)) {
    compileCache.set(templateStr, Handlebars.compile(templateStr, { noEscape: false }));
  }
  return compileCache.get(templateStr);
}

// Plain-text contexts (email subject/body) must not HTML-escape values like "O'Brien" or "A & B".
export function renderText(templateStr, row) {
  const compiled = Handlebars.compile(templateStr || "", { noEscape: true });
  return compiled(row);
}

// HTML contexts (the PDF template) should escape by default for safety.
export function renderHtml(templateStr, row) {
  const compiled = compile(templateStr || "");
  return compiled(row);
}

// Mark a value as already-safe HTML so Handlebars inserts it verbatim. Needed
// for data: URIs — escaping turns the "=" padding on base64 into "&#x3D;" and
// the browser then refuses to decode the image. Only use this for values we
// generate ourselves, never for spreadsheet content.
export function safeHtml(value) {
  return new Handlebars.SafeString(value);
}

export function clearTemplateCache() {
  compileCache.clear();
}
