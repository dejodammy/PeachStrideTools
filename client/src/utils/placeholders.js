// Build the right Handlebars token for a column name, and insert it at the
// current cursor position of a text input/textarea (falls back to appending).

export function placeholderToken(column) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(column) ? `{{${column}}}` : `{{lookup this "${column}"}}`;
}

export function insertAtCursor(el, value, setValue, token) {
  if (!el) {
    setValue(value + token);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}
