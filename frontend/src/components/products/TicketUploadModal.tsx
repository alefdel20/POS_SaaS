import { type CSSProperties, type ChangeEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { apiExtractPurchaseTicket, apiSearchRestockCatalog } from "../../api/purchaseTicket";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type {
  TicketMatchMethod,
  TicketPreviewLine,
  TicketPreviewResponse,
  TicketProductRef,
  TicketSupplierCandidate
} from "../../types/purchaseTicket";

// "Cargar ticket" (Reabastecer), solo vista previa: lee el ticket con IA y
// muestra un borrador editable. No guarda nada; la imagen solo vive en
// memoria mientras el modal esta abierto.

const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.85;
// El backend acepta hasta 5 MB; a 1600 px en JPEG 0.85 nunca se acerca.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Proveedor preseleccionado solo con nombre igual (con o sin sufijos legales).
const SUPPLIER_PRESELECT_CONFIDENCE = 0.9;
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 300;

const METHOD_LABELS: Record<TicketMatchMethod, string> = {
  barcode: "Código de barras",
  supplier_code: "Código del proveedor",
  sku: "SKU",
  supplier_name: "Nombre del proveedor",
  name: "Nombre"
};

type LineSelection = { kind: "product"; product: TicketProductRef } | { kind: "new" };

interface DraftLine {
  key: number;
  rawName: string;
  qty: string;
  unitCost: string;
  match: TicketPreviewLine["match"];
  options: TicketProductRef[];
  selection: LineSelection;
}

interface TicketDraft {
  supplierRaw: string | null;
  candidates: TicketSupplierCandidate[];
  supplierId: string;
  date: string;
  total: string;
  folio: string | null;
  lines: DraftLine[];
}

type Step = "select" | "loading" | "preview";
type Tone = "high" | "medium" | "none" | "manual";

interface TicketUploadModalProps {
  token: string;
  hideCosts: boolean;
  onClose: () => void;
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function buildDraft(response: TicketPreviewResponse): TicketDraft {
  const topCandidate = response.supplier_candidates[0];
  return {
    supplierRaw: response.ticket.supplier_name_raw,
    candidates: response.supplier_candidates,
    supplierId: topCandidate && topCandidate.confidence >= SUPPLIER_PRESELECT_CONFIDENCE ? String(topCandidate.id) : "",
    date: response.ticket.date || "",
    total: numberToInput(response.ticket.total),
    folio: response.ticket.folio,
    lines: response.lines.map((line) => {
      const options = line.match
        ? [{ product_id: line.match.product_id, name: line.match.name, sku: line.match.sku }]
        : line.suggestions;
      return {
        key: line.index,
        rawName: line.raw_name,
        qty: numberToInput(line.qty),
        unitCost: numberToInput(line.unit_cost),
        match: line.match,
        options,
        selection: line.match ? { kind: "product", product: options[0] } : { kind: "new" }
      };
    })
  };
}

function isPositiveNumber(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeNumber(value: string) {
  const parsed = Number(value);
  return value.trim() === "" || (Number.isFinite(parsed) && parsed >= 0);
}

function productLabel(product: TicketProductRef) {
  return product.sku ? `${product.name} · ${product.sku}` : product.name;
}

function confidenceOf(line: DraftLine): { text: string; tone: Tone } {
  if (line.selection.kind === "new") return { text: line.match ? "Nuevo producto" : "Sin coincidencia", tone: "none" };
  if (line.match && line.selection.product.product_id === line.match.product_id) {
    const level = line.match.confidence >= 0.9 ? "Alta" : "Media";
    return { text: `${level} · ${METHOD_LABELS[line.match.method]}`, tone: line.match.confidence >= 0.9 ? "high" : "medium" };
  }
  return { text: "Elegido a mano", tone: "manual" };
}

const TONE_VARS: Record<Tone, string> = {
  high: "var(--accent)",
  medium: "var(--warning)",
  none: "var(--danger)",
  manual: "var(--muted)"
};

// Redimensiona a 1600 px por lado como maximo y re-codifica en JPEG 0.85.
// createImageBitmap respeta la orientacion EXIF de las fotos del celular.
async function resizeImage(file: File): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let release = () => {};

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("No se pudo abrir la imagen. Usa una foto JPG, PNG o WEBP.");
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    release = () => URL.revokeObjectURL(url);
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen en este navegador.");
    // Fondo blanco: un PNG con transparencia no debe quedar negro en JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("No se pudo preparar la imagen en este navegador.");
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error("La imagen debe pesar 5 MB o menos.");
    return blob;
  } finally {
    release();
  }
}

const alertStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "10px",
  background: "color-mix(in srgb, var(--danger) 12%, transparent)",
  border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
  color: "var(--text)",
  fontSize: "0.82rem",
  margin: "0 0 0.75rem"
};

const noticeStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  margin: "0 0 1rem",
  padding: "0.6rem 0.75rem",
  borderRadius: "10px",
  background: "color-mix(in srgb, var(--warning) 16%, var(--modal-panel))",
  border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
  color: "var(--text)",
  fontSize: "0.85rem",
  fontWeight: 600
};

const fieldStyle: CSSProperties = { display: "grid", gap: "0.35rem", margin: 0, fontSize: "0.85rem" };
const cellInputStyle: CSSProperties = { width: "100%", minWidth: "5.5rem" };

function toneBadgeStyle(tone: Tone): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: "999px",
    fontSize: "0.75rem",
    whiteSpace: "nowrap",
    color: "var(--text)",
    background: `color-mix(in srgb, ${TONE_VARS[tone]} 16%, transparent)`,
    border: `1px solid color-mix(in srgb, ${TONE_VARS[tone]} 45%, transparent)`
  };
}

const unmatchedStyle: CSSProperties = {
  background: "color-mix(in srgb, var(--warning) 9%, transparent)",
  boxShadow: "inset 3px 0 0 var(--warning)"
};

function invalidStyle(invalid: boolean): CSSProperties {
  return invalid ? { borderColor: "var(--danger)" } : {};
}

interface ProductPickerProps {
  token: string;
  lineName: string;
  selection: LineSelection;
  options: TicketProductRef[];
  open: boolean;
  onToggle: (open: boolean) => void;
  onSelect: (selection: LineSelection) => void;
}

// Selector con busqueda sobre el catalogo (GET /products/restock?search=).
// Sin texto muestra el emparejamiento y las sugerencias del ticket.
function ProductPicker({ token, lineName, selection, options, open, onToggle, onSelect }: ProductPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketProductRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setResults(null);
      setSearchError("");
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < SEARCH_MIN_CHARS) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      apiSearchRestockCatalog(token, term, controller.signal)
        .then((items) => setResults(items))
        .catch((error) => {
          if ((error as { name?: string })?.name !== "AbortError") setSearchError("No se pudo buscar en el catálogo.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, token]);

  const visible = results ?? options;
  const selectedId = selection.kind === "product" ? selection.product.product_id : null;

  function choose(next: LineSelection) {
    onSelect(next);
    onToggle(false);
  }

  return (
    <div style={{ display: "grid", gap: "0.35rem", minWidth: "12rem" }}>
      <button
        aria-expanded={open}
        aria-label={`Producto para ${lineName}`}
        className="button ghost"
        onClick={() => onToggle(!open)}
        style={{ justifyContent: "space-between", textAlign: "left", width: "100%" }}
        type="button"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {selection.kind === "product" ? productLabel(selection.product) : "Nuevo producto"}
        </span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onToggle(false);
            }
          }}
          style={{
            display: "grid",
            gap: "0.35rem",
            padding: "0.5rem",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "var(--panel-alt)"
          }}
        >
          <input
            aria-controls={listId}
            aria-label={`Buscar producto para ${lineName}`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre o SKU"
            ref={inputRef}
            type="search"
            value={query}
          />
          {searching ? <span className="muted" role="status" style={{ fontSize: "0.8rem" }}>Buscando...</span> : null}
          {searchError ? <span role="alert" style={{ ...alertStyle, margin: 0 }}>{searchError}</span> : null}
          <ul id={listId} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.25rem", maxHeight: "14rem", overflowY: "auto" }}>
            <li>
              <button
                aria-pressed={selection.kind === "new"}
                className="button ghost"
                onClick={() => choose({ kind: "new" })}
                style={{ width: "100%", justifyContent: "flex-start" }}
                type="button"
              >
                Nuevo producto
              </button>
            </li>
            {visible.map((product) => (
              <li key={product.product_id}>
                <button
                  aria-pressed={selectedId === product.product_id}
                  className="button ghost"
                  onClick={() => choose({ kind: "product", product })}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    textAlign: "left",
                    ...(selectedId === product.product_id ? { borderColor: "var(--accent)" } : {})
                  }}
                  type="button"
                >
                  {productLabel(product)}
                </button>
              </li>
            ))}
            {results && !results.length && !searching ? (
              <li className="muted" style={{ fontSize: "0.8rem", padding: "0.25rem" }}>Sin resultados en el catálogo.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function TicketUploadModal({ token, hideCosts, onClose }: TicketUploadModalProps) {
  const titleId = useId();
  const fileInputId = useId();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>("select");
  // Solo en memoria: se suelta al leer, al cambiar de archivo y al cerrar.
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [openPicker, setOpenPicker] = useState<number | null>(null);

  // Foco inicial, regreso del foco y cancelacion de la lectura al cerrar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    fileInputRef.current?.focus();
    return () => {
      requestRef.current?.abort();
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
      ) || []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setError("");
    if (nextFile && !nextFile.type.startsWith("image/")) {
      setFile(null);
      event.target.value = "";
      setError("El archivo no es una imagen. Elige una foto del ticket.");
      return;
    }
    setFile(nextFile);
  }

  async function readTicket() {
    if (!file) {
      setError("Elige una foto del ticket.");
      return;
    }
    setError("");
    setStep("loading");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const image = await resizeImage(file);
      if (controller.signal.aborted) return;
      const response = await apiExtractPurchaseTicket(token, image, "ticket.jpg", controller.signal);
      if (controller.signal.aborted) return;
      setFile(null);
      setDraft(buildDraft(response));
      setStep("preview");
    } catch (readError) {
      if (controller.signal.aborted || (readError as { name?: string })?.name === "AbortError") return;
      setError(readError instanceof Error ? readError.message : "No se pudo leer el ticket.");
      setStep("select");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function readAnother() {
    setDraft(null);
    setFile(null);
    setError("");
    setOpenPicker(null);
    setStep("select");
    window.setTimeout(() => fileInputRef.current?.focus(), 0);
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setDraft((current) => current && {
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line))
    });
  }

  function removeLine(key: number) {
    setOpenPicker((current) => (current === key ? null : current));
    setDraft((current) => current && { ...current, lines: current.lines.filter((line) => line.key !== key) });
  }

  const unmatchedCount = draft ? draft.lines.filter((line) => !line.match).length : 0;

  function renderQty(line: DraftLine) {
    const invalid = !isPositiveNumber(line.qty);
    return (
      <input
        aria-invalid={invalid}
        aria-label={`Cantidad de ${line.rawName}`}
        inputMode="decimal"
        min="0"
        onChange={(event) => updateLine(line.key, { qty: event.target.value })}
        step="any"
        style={{ ...cellInputStyle, ...invalidStyle(invalid) }}
        type="number"
        value={line.qty}
      />
    );
  }

  function renderCost(line: DraftLine) {
    const invalid = !isNonNegativeNumber(line.unitCost);
    return (
      <input
        aria-invalid={invalid}
        aria-label={`Costo unitario de ${line.rawName}`}
        inputMode="decimal"
        min="0"
        onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
        step="any"
        style={{ ...cellInputStyle, ...invalidStyle(invalid) }}
        type="number"
        value={line.unitCost}
      />
    );
  }

  function renderPicker(line: DraftLine) {
    return (
      <ProductPicker
        lineName={line.rawName}
        onSelect={(selection) => updateLine(line.key, { selection })}
        onToggle={(open) => setOpenPicker(open ? line.key : null)}
        open={openPicker === line.key}
        options={line.options}
        selection={line.selection}
        token={token}
      />
    );
  }

  function renderBadge(line: DraftLine) {
    const confidence = confidenceOf(line);
    return <span style={toneBadgeStyle(confidence.tone)}>{confidence.text}</span>;
  }

  function renderRemove(line: DraftLine) {
    return (
      <button
        aria-label={`Quitar ${line.rawName}`}
        className="button ghost"
        onClick={() => removeLine(line.key)}
        type="button"
      >
        Quitar
      </button>
    );
  }

  const backdropStyle: CSSProperties = isMobile ? { padding: 0, placeItems: "stretch" } : {};
  const cardStyle: CSSProperties = isMobile
    ? { width: "100%", maxWidth: "none", height: "100dvh", maxHeight: "none", borderRadius: 0, padding: "1rem" }
    : { width: "min(980px, 100%)" };

  return (
    <div className="modal-backdrop" role="presentation" style={backdropStyle}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-card"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        style={cardStyle}
      >
        <h3 id={titleId}>Cargar ticket</h3>

        <p role="note" style={noticeStyle}>Vista previa: todavía no se guarda nada. Estamos validando la lectura.</p>

        {error ? <p role="alert" style={alertStyle}>{error}</p> : null}

        {step !== "preview" ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label htmlFor={fileInputId} style={fieldStyle}>
              Foto del ticket
              <input
                accept="image/*"
                capture={isMobile ? "environment" : undefined}
                disabled={step === "loading"}
                id={fileInputId}
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
            </label>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem", overflowWrap: "anywhere" }}>
              {file ? `Archivo: ${file.name}` : "Ningún archivo seleccionado."}
            </p>
            {step === "loading" ? (
              <span
                aria-label="Leyendo el ticket"
                role="status"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0" }}
              >
                {[0, 0.2, 0.4].map((delay) => (
                  <span
                    aria-hidden="true"
                    key={delay}
                    style={{
                      width: "0.45rem",
                      height: "0.45rem",
                      borderRadius: "50%",
                      background: "var(--muted)",
                      animation: `kds-pulse 1.2s ${delay}s infinite`
                    }}
                  />
                ))}
                <span className="muted" style={{ fontSize: "0.85rem", marginLeft: "0.4rem" }}>Leyendo el ticket...</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {step === "preview" && draft ? (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))"
              }}
            >
              <label style={fieldStyle}>
                Proveedor
                <select
                  onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}
                  value={draft.supplierId}
                >
                  {draft.candidates.map((candidate) => (
                    <option key={candidate.id} value={String(candidate.id)}>
                      {candidate.name} ({Math.round(candidate.confidence * 100)}%)
                    </option>
                  ))}
                  <option value="">Sin proveedor</option>
                </select>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  Leído: {draft.supplierRaw || "no legible"}
                </span>
              </label>
              <label style={fieldStyle}>
                Fecha
                <input onChange={(event) => setDraft({ ...draft, date: event.target.value })} type="date" value={draft.date} />
                {draft.folio ? <span className="muted" style={{ fontSize: "0.78rem" }}>Folio: {draft.folio}</span> : null}
              </label>
              {!hideCosts ? (
                <label style={fieldStyle}>
                  Total
                  <input
                    aria-invalid={!isNonNegativeNumber(draft.total)}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setDraft({ ...draft, total: event.target.value })}
                    step="any"
                    style={invalidStyle(!isNonNegativeNumber(draft.total))}
                    type="number"
                    value={draft.total}
                  />
                </label>
              ) : null}
            </div>

            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              {draft.lines.length} {draft.lines.length === 1 ? "línea" : "líneas"}
              {unmatchedCount ? ` · ${unmatchedCount} sin coincidencia en el catálogo` : ""}
            </p>

            {draft.lines.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No hay líneas para revisar.</p>
            ) : isMobile ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
                {draft.lines.map((line) => (
                  <li
                    key={line.key}
                    style={{
                      display: "grid",
                      gap: "0.6rem",
                      padding: "0.75rem",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                      ...(line.match ? {} : unmatchedStyle)
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                      <strong style={{ overflowWrap: "anywhere" }}>{line.rawName}</strong>
                      {renderBadge(line)}
                    </div>
                    <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: hideCosts ? "1fr" : "1fr 1fr" }}>
                      <div style={fieldStyle}><span>Cantidad</span>{renderQty(line)}</div>
                      {!hideCosts ? <div style={fieldStyle}><span>Costo unitario</span>{renderCost(line)}</div> : null}
                    </div>
                    <div style={fieldStyle}><span>Producto</span>{renderPicker(line)}</div>
                    <div>{renderRemove(line)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Nombre en el ticket</th>
                      <th scope="col">Cantidad</th>
                      {!hideCosts ? <th scope="col">Costo unitario</th> : null}
                      <th scope="col">Producto</th>
                      <th scope="col">Confianza</th>
                      <th aria-label="Acciones" scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line) => (
                      <tr key={line.key} style={line.match ? undefined : unmatchedStyle}>
                        <td style={{ minWidth: "10rem", overflowWrap: "anywhere" }}>{line.rawName}</td>
                        <td>{renderQty(line)}</td>
                        {!hideCosts ? <td>{renderCost(line)}</td> : null}
                        <td>{renderPicker(line)}</td>
                        <td>{renderBadge(line)}</td>
                        <td>{renderRemove(line)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div className="inline-actions modal-actions-end" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          {step === "preview" ? (
            <button className="button ghost" onClick={readAnother} type="button">Leer otro ticket</button>
          ) : null}
          <button className="button ghost" onClick={onClose} type="button">Cerrar</button>
          {step !== "preview" ? (
            <button
              className="button"
              disabled={!file || step === "loading"}
              onClick={() => readTicket().catch(() => undefined)}
              type="button"
            >
              {step === "loading" ? "Leyendo..." : "Leer ticket"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
