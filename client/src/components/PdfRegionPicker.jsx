import { useEffect, useRef, useState } from "react";
import { IconUpload } from "../icons.jsx";

const RENDER_SCALE = 1.5; // canvas pixels per PDF point, for a crisp but not huge render

export default function PdfRegionPicker({ columns, file, onFileChange, regions, onRegionsChange }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState(null); // { widthPt, heightPt }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(null); // { startX, startY, x, y }

  // Load the PDF (pdfjs-dist is lazy-loaded so it's not in the main bundle).
  useEffect(() => {
    if (!file) {
      setPdfDoc(null);
      setPageCount(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).href;
        const buffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setPageIndex(0);
      } catch (err) {
        if (!cancelled) setError("Could not read that PDF: " + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Render the current page to the canvas.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const page = await pdfDoc.getPage(pageIndex + 1);
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      setPageSize({ widthPt: unscaled.width, heightPt: unscaled.height });
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageIndex]);

  function canvasPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handleMouseDown(e) {
    const p = canvasPoint(e);
    setDrag({ startX: p.x, startY: p.y, x: p.x, y: p.y });
  }

  function handleMouseMove(e) {
    if (!drag) return;
    const p = canvasPoint(e);
    setDrag((d) => ({ ...d, x: p.x, y: p.y }));
  }

  function handleMouseUp() {
    if (!drag || !pageSize) return setDrag(null);
    const left = Math.min(drag.startX, drag.x);
    const top = Math.min(drag.startY, drag.y);
    const width = Math.abs(drag.x - drag.startX);
    const height = Math.abs(drag.y - drag.startY);
    setDrag(null);
    if (width < 6 || height < 6) return; // ignore accidental clicks

    // Convert canvas pixels -> PDF points (pdf-lib's coordinate space: origin bottom-left).
    const pdfX = left / RENDER_SCALE;
    const pdfWidth = width / RENDER_SCALE;
    const pdfHeight = height / RENDER_SCALE;
    const pdfY = pageSize.heightPt - (top + height) / RENDER_SCALE;

    const region = {
      page: pageIndex,
      x: Math.round(pdfX * 10) / 10,
      y: Math.round(pdfY * 10) / 10,
      width: Math.round(pdfWidth * 10) / 10,
      height: Math.round(pdfHeight * 10) / 10,
      column: columns[0] || "",
      fontSize: Math.max(6, Math.round(pdfHeight * 0.65)),
    };
    onRegionsChange([...regions, region]);
  }

  function updateRegion(index, patch) {
    onRegionsChange(regions.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRegion(index) {
    onRegionsChange(regions.filter((_, i) => i !== index));
  }

  const pageRegions = regions
    .map((r, i) => ({ ...r, index: i }))
    .filter((r) => r.page === pageIndex);

  return (
    <div className="pdf-picker">
      {!file && (
        <label className="file-drop">
          <input type="file" accept=".pdf" onChange={(e) => onFileChange(e.target.files[0] || null)} />
          <span className="icon"><IconUpload /></span>
          <span className="text">
            <span className="primary-text">Choose the PDF to mark up</span>
            <span className="secondary-text">Your existing, already-designed letter/document</span>
          </span>
        </label>
      )}

      {file && (
        <>
          <div className="pdf-picker-toolbar">
            <span className="primary-text">{file.name}</span>
            <button type="button" className="secondary" onClick={() => onFileChange(null)}>
              Change file
            </button>
            {pageCount > 1 && (
              <div className="pdf-picker-pages">
                {Array.from({ length: pageCount }, (_, i) => (
                  <button
                    type="button"
                    key={i}
                    className={`chip${i === pageIndex ? " chip-active" : ""}`}
                    onClick={() => setPageIndex(i)}
                  >
                    Page {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && <p className="hint">Loading PDF…</p>}
          {error && <div className="banner error">{error}</div>}

          {!loading && !error && (
            <>
              <p className="hint">
                Drag a box over each spot that should change per recipient (e.g. the name). Mark it as many times as
                it appears — in the header, in the letter body, wherever.
              </p>
              <div className="pdf-canvas-wrap" ref={containerRef}>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => setDrag(null)}
                />
                {drag && canvasRef.current && (
                  <div
                    className="pdf-drag-box"
                    style={{
                      left: `${(Math.min(drag.startX, drag.x) / canvasRef.current.width) * 100}%`,
                      top: `${(Math.min(drag.startY, drag.y) / canvasRef.current.height) * 100}%`,
                      width: `${(Math.abs(drag.x - drag.startX) / canvasRef.current.width) * 100}%`,
                      height: `${(Math.abs(drag.y - drag.startY) / canvasRef.current.height) * 100}%`,
                    }}
                  />
                )}
                {pageRegions.map((r) => (
                  <div
                    key={r.index}
                    className="pdf-region-box"
                    style={{
                      left: `${(r.x / (pageSize?.widthPt || 1)) * 100}%`,
                      top: `${(1 - (r.y + r.height) / (pageSize?.heightPt || 1)) * 100}%`,
                      width: `${(r.width / (pageSize?.widthPt || 1)) * 100}%`,
                      height: `${(r.height / (pageSize?.heightPt || 1)) * 100}%`,
                    }}
                  >
                    <span className="pdf-region-label">{r.column || "?"}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {regions.length > 0 && (
            <div className="pdf-region-list">
              <h3>Marked regions</h3>
              {regions.map((r, i) => (
                <div className="pdf-region-row" key={i}>
                  <span className="pdf-region-row-page">Page {r.page + 1}</span>
                  <select value={r.column} onChange={(e) => updateRegion(i, { column: e.target.value })}>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="pdf-region-remove" onClick={() => removeRegion(i)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
