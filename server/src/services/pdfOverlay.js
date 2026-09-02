import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Stamp per-recipient values onto a copy of an existing PDF. Each region is a
 * rectangle (in PDF point units, origin bottom-left — pdf-lib's native space)
 * marking where one spreadsheet column's value should appear. We cover the
 * original content in that rectangle with white, then draw the new value on
 * top, so the rest of the document (logo, formatting, everything else) is
 * untouched.
 *
 * regions: [{ page, x, y, width, height, column, fontSize }]
 */
export async function stampPdf(sourceBytes, regions, row) {
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const region of regions) {
    const page = pages[region.page];
    if (!page) continue;
    const value = String(row[region.column] ?? "");
    const baseFontSize = region.fontSize || 11;
    const maxTextWidth = Math.max(0, region.width - 4);

    // Shrink (never wrap) so a long value still fits on one line in the box.
    let fontSize = baseFontSize;
    if (value && maxTextWidth > 0) {
      const naturalWidth = font.widthOfTextAtSize(value, fontSize);
      if (naturalWidth > maxTextWidth) {
        fontSize = Math.max(6, fontSize * (maxTextWidth / naturalWidth));
      }
    }

    page.drawRectangle({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: rgb(1, 1, 1),
    });

    // Roughly vertically center the text within the marked box.
    const textY = region.y + Math.max(0, (region.height - fontSize) / 2) + fontSize * 0.15;
    page.drawText(value, {
      x: region.x + 2,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return pdfDoc.save();
}

export async function getPdfPageCount(bytes) {
  const pdfDoc = await PDFDocument.load(bytes);
  return pdfDoc.getPageCount();
}
