import { useEffect, useMemo, useRef, useState } from "react";
import { getIdCardBrands, readIdCardRoster, previewIdCards, downloadIdCard, generateIdCards } from "../api.js";
import { analyzeFiles, reanalyzeAs, whitenPhoto, normalizeKey, stripExt, DEFAULT_FOCAL } from "../idcardImages.js";
import { IconUpload, IconDownload, IconCheck } from "../icons.jsx";

function FileDrop({ label, hint, file, accept, multiple, onChange, icon }) {
  const chosen = multiple ? file && file.length : file;
  const summary = multiple
    ? chosen
      ? `${file.length} file${file.length === 1 ? "" : "s"} — click to change`
      : hint
    : chosen
      ? `${file.name} — click to change`
      : hint;
  return (
    <label className="file-drop">
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => onChange(multiple ? Array.from(e.target.files) : e.target.files[0] || null)}
      />
      <span className="icon">{icon}</span>
      <span className="text">
        <span className="primary-text">{multiple ? (chosen ? `${label} selected` : label) : chosen ? file.name : label}</span>
        <span className="secondary-text">{summary}</span>
      </span>
    </label>
  );
}

/**
 * The photo as the card will actually crop it: a circle, filled, positioned by
 * the focal point. Dragging moves the image inside the circle, which is the
 * whole correction mechanism — no sliders, you just pull the face into frame.
 */
function FaceCircle({ thumb, focal, onChange, size = 96 }) {
  const ref = useRef(null);
  const drag = useRef(null);

  function onPointerDown(e) {
    if (!onChange) return;
    ref.current.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, focal };
  }

  function onPointerMove(e) {
    if (!drag.current) return;
    const start = drag.current;
    // Dragging right should reveal more of the image's left side, so the
    // object-position percentage moves opposite to the pointer.
    const dx = ((e.clientX - start.x) / size) * 100;
    const dy = ((e.clientY - start.y) / size) * 100;
    onChange({
      x: Math.min(100, Math.max(0, start.focal.x - dx)),
      y: Math.min(100, Math.max(0, start.focal.y - dy)),
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div
      ref={ref}
      className={`face-circle${onChange ? " draggable" : ""}`}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={onChange ? "Drag to reposition the face" : undefined}
    >
      {thumb ? (
        <img src={thumb} alt="" draggable={false} style={{ objectPosition: `${focal.x}% ${focal.y}%` }} />
      ) : (
        <span className="face-circle-empty">?</span>
      )}
    </div>
  );
}

export default function IdCards() {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState("fmn");
  const [roster, setRoster] = useState(null);
  const [rows, setRows] = useState([]);
  const [rosterError, setRosterError] = useState("");
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [focals, setFocals] = useState([]);
  const [whitePhotoBackgrounds, setWhitePhotoBackgrounds] = useState(false);
  const [assign, setAssign] = useState([]);
  const [skipped, setSkipped] = useState(() => new Set());
  const [progress, setProgress] = useState(null);
  const [search, setSearch] = useState("");
  const [template, setTemplate] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [whitening, setWhitening] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    getIdCardBrands()
      .then((result) => setBrands(result.brands))
      .catch(() => {
        // Non-fatal: the picker just falls back to the single default option.
        setBrands([{ id: "fmn", label: "FMN" }]);
      });
  }, []);

  function handleBrandChange(nextBrand) {
    setBrand(nextBrand);
    setPreview(null);
  }

  async function handleRoster(file) {
    setRoster(file);
    setRows([]);
    setRosterError("");
    setPreview(null);
    if (!file) return;
    try {
      const result = await readIdCardRoster(file);
      setRows(result.rows);
      setAssign(autoAssign(result.rows, items));
    } catch (err) {
      setRosterError(err.message);
    }
  }

  function autoAssign(targetRows, analyzed) {
    const taken = new Set();
    const findFor = (name, kind) => {
      const key = normalizeKey(name);
      if (!key) return null;
      const index = analyzed.findIndex(
        (item, i) => {
          const imageKey = normalizeKey(stripExt(item.name));
          const labelledName = imageKey.replace(/(?:photo|signature)$/, "");
          return !taken.has(i) && item.kind === kind && (imageKey === key || labelledName === key);
        }
      );
      if (index < 0) return null;
      taken.add(index);
      return index;
    };
    return targetRows.map((row) => ({ photo: findFor(row.Name, "photo"), signature: findFor(row.Name, "signature") }));
  }

  // White backgrounds come from a matting model on the server, about a second
  // a photo, so they're only made once the operator asks for them, and only for
  // photos that don't have one yet. The queue lives in a ref so finishing one
  // photo (which updates `items`) doesn't restart the others; a new upload
  // swaps `files`, and anything still running for the old batch is dropped.
  const whitenQueue = useRef({ files: null, pending: [], requested: new Set(), active: 0, done: 0, total: 0 });
  useEffect(() => {
    if (!whitePhotoBackgrounds) return;
    const queue = whitenQueue.current;
    if (queue.files !== files) {
      Object.assign(queue, { files, pending: [], requested: new Set(), done: 0, total: 0 });
    }
    items.forEach((item, i) => {
      if (item?.kind !== "photo" || item.whiteBackgroundBlob || item.whiteBackgroundFailed) return;
      if (queue.requested.has(i)) return;
      queue.requested.add(i);
      queue.pending.push(i);
      queue.total += 1;
    });
    if (!queue.pending.length) return;
    setWhitening({ done: queue.done, total: queue.total });

    async function worker() {
      const batch = queue.files;
      queue.active += 1;
      while (queue.pending.length && queue.files === batch) {
        const i = queue.pending.shift();
        let result = null;
        try {
          result = await whitenPhoto(batch[i]);
        } catch {
          result = null;
        }
        if (queue.files !== batch) break;
        setItems((prev) =>
          prev.map((item, j) =>
            j === i && item.name === batch[i].name
              ? result
                ? { ...item, whiteBackgroundBlob: result.blob, whiteBackgroundThumb: result.thumb }
                : { ...item, whiteBackgroundFailed: true }
              : item
          )
        );
        queue.done += 1;
        setWhitening({ done: queue.done, total: queue.total });
      }
      queue.active -= 1;
      if (!queue.active) {
        queue.done = 0;
        queue.total = 0;
        setWhitening(null);
      }
    }
    // Two at a time keeps the server busy without queueing a whole batch on it.
    const spawn = Math.min(2 - queue.active, queue.pending.length);
    for (let k = 0; k < spawn; k += 1) worker();
  }, [whitePhotoBackgrounds, items, files]);

  async function handleImages(selected) {
    setFiles(selected);
    setItems([]);
    setSkipped(new Set());
    setPreview(null);
    setSearch("");
    if (!selected.length) {
      setAssign(rows.map(() => ({ photo: null, signature: null })));
      setFocals([]);
      return;
    }
    setProgress({ done: 0, total: selected.length });
    const analyzed = await analyzeFiles(selected, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setItems(analyzed);
    setFocals(analyzed.map((item) => item.focal || DEFAULT_FOCAL));
    setAssign(autoAssign(rows, analyzed));
  }

  const usedIndexes = useMemo(() => {
    const used = new Set();
    for (const entry of assign) {
      if (entry?.photo != null) used.add(entry.photo);
      if (entry?.signature != null) used.add(entry.signature);
    }
    return used;
  }, [assign]);

  // Images still waiting to be identified, in upload order.
  const pending = useMemo(
    () => items.map((_, i) => i).filter((i) => !usedIndexes.has(i) && !skipped.has(i)),
    [items, usedIndexes, skipped]
  );
  const currentIndex = pending.length ? pending[0] : null;
  const current = currentIndex == null ? null : items[currentIndex];

  const filteredRows = useMemo(() => {
    const key = normalizeKey(search);
    const withIndex = rows.map((row, index) => ({ row, index }));
    if (!key) return withIndex;
    return withIndex.filter(({ row }) => normalizeKey(`${row.Name} ${row.Role || ""}`).includes(key));
  }, [rows, search]);

  function assignTo(rowIndex, kind, imageIndex) {
    setAssign((prev) => {
      const next = prev.map((entry) => ({ ...entry }));
      if (imageIndex != null) {
        for (const entry of next) {
          if (entry.photo === imageIndex) entry.photo = null;
          if (entry.signature === imageIndex) entry.signature = null;
        }
      }
      if (!next[rowIndex]) next[rowIndex] = { photo: null, signature: null };
      next[rowIndex][kind] = imageIndex;
      return next;
    });
    setPreview(null);
  }

  // Identify the image on screen as this person, then clear the box so the next
  // image can be named without reaching for the mouse.
  function identifyAs(rowIndex) {
    if (currentIndex == null) return;
    assignTo(rowIndex, current.kind, currentIndex);
    setSearch("");
    searchRef.current?.focus();
  }

  function skipCurrent() {
    if (currentIndex == null) return;
    setSkipped((prev) => new Set(prev).add(currentIndex));
    setSearch("");
    searchRef.current?.focus();
  }

  // Switching kind isn't just a label change: a signature needs its ink lifted
  // off the paper and cropped, a photo needs its face located. So re-run the
  // analysis for that one file with the kind the operator chose.
  async function flipCurrentKind() {
    if (currentIndex == null) return;
    const index = currentIndex;
    const kind = items[index].kind === "photo" ? "signature" : "photo";
    const updated = await reanalyzeAs(files[index], kind);
    whitenQueue.current.requested.delete(index);
    setItems((prev) => prev.map((item, i) => (i === index ? updated : item)));
    setFocals((prev) => prev.map((value, i) => (i === index ? updated.focal || DEFAULT_FOCAL : value)));
  }

  function setFocal(imageIndex, focal) {
    setFocals((prev) => prev.map((value, i) => (i === imageIndex ? focal : value)));
    setPreview(null);
  }

  function onSearchKeyDown(e) {
    if (e.key === "Enter" && filteredRows.length) {
      e.preventDefault();
      identifyAs(filteredRows[0].index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipCurrent();
    }
  }

  function buildFormData(extra = {}) {
    const fd = new FormData();
    fd.append("roster", roster);
    // Signatures upload as the cleaned cut-out rather than the original photo
    // of a sheet of paper. Order must match `assignments`, which indexes by
    // position, so every slot is appended exactly once.
    files.forEach((file, i) => {
      const prepared = items[i]?.kind === "signature"
        ? items[i].cleanedBlob
        : whitePhotoBackgrounds
          ? items[i]?.whiteBackgroundBlob
          : null;
      const suffix = items[i]?.kind === "signature" ? "signature" : "white-background";
      fd.append("images", prepared || file, prepared ? `${stripExt(file.name)}-${suffix}.png` : file.name);
    });
    fd.append("assignments", JSON.stringify(assign));
    fd.append("focals", JSON.stringify(focals));
    fd.append("brand", brand);
    if (template.trim()) fd.append("template", template);
    for (const [key, value] of Object.entries(extra)) fd.append(key, value);
    return fd;
  }

  async function handlePreview(rowIndex) {
    if (!roster) return setError("Upload a staff spreadsheet first.");
    setError("");
    setLoadingPreview(true);
    try {
      const result = await previewIdCards(buildFormData(rowIndex == null ? {} : { previewIndex: String(rowIndex) }));
      setPreview(result);
      if (!template.trim()) setTemplate(result.template);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  }

  // Names come from a spreadsheet, so strip anything a filesystem would reject.
  function safeFileName(name, fallback) {
    const cleaned = String(name || "").replace(/[\/:*?"<>|]/g, "").trim().slice(0, 80);
    return `${cleaned || fallback}.png`;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Some browsers begin a download on the next event-loop turn. Revoking the
    // URL immediately can cancel that download before it ever becomes visible.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function handleDownloadOne(rowIndex) {
    if (!roster) return setError("Upload a staff spreadsheet first.");
    setError("");
    setDownloading({ done: 0, total: 1 });
    try {
      const blob = await downloadIdCard(buildFormData({ previewIndex: String(rowIndex) }));
      saveBlob(blob, safeFileName(rows[rowIndex].Name, "card"));
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  }

  // Saves one PNG per employee instead of a single zip. One request per card,
  // so it's slower than the zip and the browser will ask once for permission to
  // save multiple files — worth it when you just want the images.
  async function handleDownloadAllPngs() {
    if (!roster) return setError("Upload a staff spreadsheet first.");
    setError("");
    setDownloading({ done: 0, total: rows.length });

    let directory = null;
    if (typeof window.showDirectoryPicker === "function") {
      try {
        // Call from the button handler so the browser can show its native
        // folder chooser rather than treating it as an unsolicited popup.
        directory = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (err) {
        if (err?.name === "AbortError") {
          setDownloading(null);
          return;
        }
        setError("Folder selection was unavailable. Your browser will download the PNGs instead; allow multiple downloads if prompted.");
      }
    } else {
      setError("This browser cannot choose a destination folder. Your browser will download the PNGs instead; allow multiple downloads if prompted.");
    }

    try {
      for (let i = 0; i < rows.length; i += 1) {
        const blob = await downloadIdCard(buildFormData({ previewIndex: String(i) }));
        const filename = safeFileName(rows[i].Name, `card-${i + 1}`);
        if (directory) {
          const file = await directory.getFileHandle(filename, { create: true });
          const writable = await file.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          saveBlob(blob, filename);
        }
        setDownloading({ done: i + 1, total: rows.length });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  }

  async function handleGenerate() {
    if (!roster) return setError("Upload a staff spreadsheet first.");
    setError("");
    setGenerating(true);
    try {
      saveBlob(await generateIdCards(buildFormData()), "id-cards.zip");
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (current) searchRef.current?.focus();
  }, [currentIndex]);

  const photosDone = assign.filter((entry) => entry?.photo != null).length;
  const signaturesDone = assign.filter((entry) => entry?.signature != null).length;
  const identified = items.length - pending.length - skipped.size;

  return (
    <div className="idcards-page">
      <div className="card">
        <h2>1. Agency</h2>
        <p className="lede">Which agency's card design should these employees get?</p>
        <div className="brand-picker">
          {(brands.length ? brands : [{ id: "fmn", label: "FMN" }]).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`brand-option${brand === b.id ? " active" : ""}`}
              onClick={() => handleBrandChange(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>2. Staff spreadsheet</h2>
        <p className="lede">
          Must have a <code>Name</code> column and a <code>Role</code> column. Any other column can be used in the card
          template.
        </p>
        <FileDrop
          label="Upload staff spreadsheet"
          hint=".xlsx or .xls, with Name and Role columns"
          accept=".xlsx,.xls"
          file={roster}
          onChange={handleRoster}
          icon={<IconUpload />}
        />
        {rosterError && <div className="banner error">{rosterError}</div>}
        {rows.length > 0 && (
          <p className="lede">
            <IconCheck /> {rows.length} employee{rows.length === 1 ? "" : "s"} loaded.
          </p>
        )}
      </div>

      <div className="card">
        <h2>3. Photos &amp; signatures</h2>
        <p className="lede">
          Select every image at once, straight out of the WhatsApp export. Each is sorted into a photo or a signature,
          the face is located, and anything whose filename matches an employee is assigned for you.
        </p>
        <FileDrop
          label="Upload all images"
          hint="Photos and signatures together, in any order"
          accept="image/*"
          multiple
          file={files}
          onChange={handleImages}
          icon={<IconUpload />}
        />
        <label className="idcards-photo-option">
          <input
            type="checkbox"
            checked={whitePhotoBackgrounds}
            onChange={(e) => { setWhitePhotoBackgrounds(e.target.checked); setPreview(null); }}
          />
          <span>Replace photo backgrounds with white</span>
        </label>
        {whitening && (
          <p className="lede">
            Removing backgrounds… {whitening.done} of {whitening.total}
          </p>
        )}
        {progress && (
          <p className="lede">
            Reading images… {progress.done} of {progress.total}
          </p>
        )}
      </div>

      {current && rows.length > 0 && (
        <div className="card">
          <h2>4. Who is this?</h2>
          <p className="lede">
            {identified} identified, {pending.length} to go. Type a few letters and press Enter — Esc skips.
          </p>

          <div className="identify">
            <div className="identify-image">
              <img src={current.thumb} alt={current.name} />
              <div className="identify-meta">
                <span className="identify-filename">{current.name}</span>
                <button type="button" className="link-button" onClick={flipCurrentKind}>
                  Treating as {current.kind} — switch to {current.kind === "photo" ? "signature" : "photo"}
                </button>
              </div>
            </div>

            <div className="identify-picker">
              <input
                ref={searchRef}
                type="text"
                className="identify-search"
                placeholder="Type a name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                autoFocus
              />
              <div className="identify-list">
                {filteredRows.map(({ row, index }, position) => {
                  const entry = assign[index] || {};
                  const filled = entry[current.kind] != null;
                  return (
                    <button
                      type="button"
                      key={index}
                      className={`identify-person${position === 0 && search ? " top-match" : ""}${filled ? " filled" : ""}`}
                      onClick={() => identifyAs(index)}
                    >
                      <span className="identify-person-name">{row.Name}</span>
                      <span className="identify-person-role">{row.Role}</span>
                      {filled && <span className="identify-person-flag">has one — replace</span>}
                    </button>
                  );
                })}
                {filteredRows.length === 0 && <p className="lede">No one matches “{search}”.</p>}
              </div>
              <button type="button" className="secondary" onClick={skipCurrent}>
                Skip this image
              </button>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && items.length > 0 && !current && (
        <div className="card">
          <h2>4. Everything identified</h2>
          <p className="lede">
            {photosDone} of {rows.length} have a photo, {signaturesDone} have a signature.
            {skipped.size > 0 && ` ${skipped.size} image(s) skipped.`}
          </p>
        </div>
      )}

      {rows.length > 0 && items.length > 0 && (
        <div className="card">
          <h2>5. Check the faces</h2>
          <p className="lede">
            Each circle is exactly how the card will crop it. The face is centred automatically — if one is off, drag it
            into place.
          </p>
          <div className="review-grid">
            {rows.map((row, index) => {
              const entry = assign[index] || {};
              const photo = entry.photo != null ? items[entry.photo] : null;
              const signature = entry.signature != null ? items[entry.signature] : null;
              return (
                <div className="review-person" key={index}>
                  <FaceCircle
                    thumb={whitePhotoBackgrounds ? photo?.whiteBackgroundThumb || photo?.thumb : photo?.thumb}
                    focal={entry.photo != null ? focals[entry.photo] : DEFAULT_FOCAL}
                    onChange={photo ? (focal) => setFocal(entry.photo, focal) : null}
                  />
                  <span className="review-name">{row.Name}</span>
                  <div className="review-signature">
                    {signature ? <img src={signature.thumb} alt="" /> : <span className="review-missing">no signature</span>}
                  </div>
                  <div className="review-actions">
                    <button type="button" className="link-button" onClick={() => handlePreview(index)} disabled={loadingPreview}>
                      Preview
                    </button>
                    <button type="button" className="link-button" onClick={() => handleDownloadOne(index)} disabled={!!downloading}>
                      PNG
                    </button>
                    {photo && (
                      <button type="button" className="link-button" onClick={() => assignTo(index, "photo", null)}>
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2>6. Card template</h2>
        <p className="lede">
          Pre-filled with the selected agency's card layout. Any spreadsheet column works as{" "}
          <code>{"{{ColumnName}}"}</code>. Leave as-is unless you need to change the layout.
        </p>
        <div className="field">
          <textarea
            className="mono"
            rows={10}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="Click &quot;Preview card&quot; to load the starter template here."
          />
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="actions">
        <button type="button" className="secondary" onClick={() => handlePreview(null)} disabled={loadingPreview || !!whitening}>
          {loadingPreview ? "Rendering…" : "Preview card"}
        </button>
        <button type="button" className="secondary" onClick={handleDownloadAllPngs} disabled={!!downloading || !roster || !!whitening}>
          <IconDownload />
          {downloading && downloading.total > 1
            ? `Saving ${downloading.done} of ${downloading.total}…`
            : "Choose folder & download PNGs"}
        </button>
        <button type="button" className="primary" onClick={handleGenerate} disabled={generating || !roster || !!whitening}>
          <IconDownload />
          {generating ? "Generating…" : "Generate all cards (.zip)"}
        </button>
      </div>

      {preview && (
        <div className="card">
          <h2>Preview{preview.previewName ? ` — ${preview.previewName}` : ""}</h2>
          <div className="idcard-preview-stats">
            <span>
              <IconCheck /> {preview.rowCount} employee{preview.rowCount === 1 ? "" : "s"} in the spreadsheet
            </span>
            <span>
              {preview.photosMatched} with a photo, {preview.signaturesMatched} with a signature
            </span>
            {preview.droppedRows > 0 && <span>{preview.droppedRows} row(s) skipped — no name</span>}
          </div>
          <img className="idcard-preview-image" src={preview.previewImage} alt="ID card preview" />
        </div>
      )}
    </div>
  );
}
