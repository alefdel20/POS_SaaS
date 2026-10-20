import { type CSSProperties, type ChangeEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { TicketApiError, apiConfirmPurchaseTicket, apiExtractPurchaseTicket, apiSearchRestockCatalog } from "../../api/purchaseTicket";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type {
  TicketConfirmRequest,
  TicketConfirmResponse,
  TicketMatchMethod,
  TicketPreviewLine,
  TicketPreviewResponse,
  TicketProductRef,
  TicketSupplierCandidate,
  TicketVoidResponse
} from "../../types/purchaseTicket";
import { currency, formatDate } from "../../utils/format";
import { getMexicoCityDateInputValue } from "../../utils/timezone";
import { TicketCategoryPicker } from "./TicketCategoryPicker";
import { type TicketConfirmSummary, TicketConfirmDialog } from "./TicketConfirmDialog";
import { TicketPurchasesList } from "./TicketPurchasesList";
import { TicketVoidDialog } from "./TicketVoidDialog";
import {
  TicketFacts,
  TicketLineStatusBadge,
  type TicketLineStatus,
  ticketStatusRowStyle,
  ticketSuccessStyle,
  ticketWarningStyle
} from "./ticketUi";

// "Cargar ticket" (Reabastecer): lee el ticket con IA y muestra un borrador
// editable. Con canConfirm (admin, gerente, superusuario y el interruptor
// ticket_ai_confirm_enabled) el borrador se confirma y la compra se puede
// anular; sin el, es solo vista previa. Un ticket largo puede ir en hasta
// MAX_PHOTOS fotos que se leen juntas (un solo ticket, un solo egreso). Las
// imagenes solo viven en memoria mientras el modal esta abierto.

const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.85;
// El backend acepta hasta 5 MB; a 1600 px en JPEG 0.85 nunca se acerca.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Proveedor preseleccionado solo con nombre igual (con o sin sufijos legales).
const SUPPLIER_PRESELECT_CONFIDENCE = 0.9;
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 300;
// Solo un emparejamiento exacto (codigo de barras, codigo del proveedor o SKU)
// se preselecciona. Por nombre o parecido queda como sugerencia: el usuario
// elige el producto existente a mano o se crea uno nuevo.
const EXACT_MATCH_METHODS = new Set<TicketMatchMethod>(["barcode", "supplier_code", "sku"]);
const EXACT_MATCH_CONFIDENCE = 0.9;

function isExactMatch(match: TicketPreviewLine["match"]) {
  return Boolean(match && EXACT_MATCH_METHODS.has(match.method) && match.confidence >= EXACT_MATCH_CONFIDENCE);
}

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
  // Solo para selection "new" al confirmar.
  newName: string;
  newCategory: string;
  newSalePrice: string;
  // Varias fotos: foto de la linea (desde 0) y la marca de posible repetido
  // (key de la linea anterior; null si no hay o si el usuario dijo "Es distinta").
  imageIndex: number;
  possibleDuplicateOf: number | null;
}

interface TicketDraft {
  imageSha256: string;
  imageCount: number;
  supplierRaw: string | null;
  candidates: TicketSupplierCandidate[];
  supplierId: string;
  date: string;
  // true: la fecha no se leyo y se prellenó con hoy (hasta que el usuario la cambie).
  dateDefaulted: boolean;
  total: string;
  // true: el total no se leyo y se prellenó con la suma de las líneas; la
  // sigue mientras el usuario no lo edite.
  totalComputed: boolean;
  folio: string | null;
  lines: DraftLine[];
}

// Varias fotos del mismo ticket (una sola lectura).
const MAX_PHOTOS = 5;

interface TicketPhoto {
  id: number;
  file: File;
  // Miniatura (createObjectURL): se libera al quitar la foto, al leer con éxito y al cerrar.
  url: string;
}

type Step = "select" | "loading" | "preview" | "done" | "purchases";
type Tone = "high" | "medium" | "none" | "manual";

interface TicketUploadModalProps {
  token: string;
  hideCosts: boolean;
  // admin, gerente o superusuario con ticket_ai_confirm_enabled.
  canConfirm: boolean;
  // changed: se confirmo o se anulo una compra (hay que refrescar Reabastecer).
  onClose: (changed: boolean) => void;
}

interface LineIssues {
  qty: boolean;
  cost: boolean;
  name: boolean;
  category: boolean;
  salePrice: boolean;
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function buildDraft(response: TicketPreviewResponse, hideCosts: boolean): TicketDraft {
  const topCandidate = response.supplier_candidates[0];
  const imageCount = response.ticket.image_count ?? 1;
  // El total impreso no se leyó (null): se prellena con la suma de las líneas.
  // Para cajero (hideCosts) no: no recibe total ni costos.
  const computeTotal = !hideCosts && response.ticket.total === null;
  const computedTotal = roundMoney(response.lines.reduce((sum, line) => sum + (line.qty ?? 0) * (line.unit_cost ?? 0), 0));
  return {
    imageSha256: response.ticket.image_sha256,
    imageCount,
    supplierRaw: response.ticket.supplier_name_raw,
    candidates: response.supplier_candidates,
    supplierId: topCandidate && topCandidate.confidence >= SUPPLIER_PRESELECT_CONFIDENCE ? String(topCandidate.id) : "",
    date: response.ticket.date || getMexicoCityDateInputValue(),
    dateDefaulted: !response.ticket.date,
    total: computeTotal ? String(computedTotal) : numberToInput(response.ticket.total),
    totalComputed: computeTotal,
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
        selection: isExactMatch(line.match) ? { kind: "product", product: options[0] } : { kind: "new" },
        newName: line.raw_name,
        newCategory: "",
        newSalePrice: "",
        imageIndex: line.image_index ?? 0,
        possibleDuplicateOf: line.possible_duplicate_of ?? null
      };
    })
  };
}

// Marca vigente: la linea anterior sigue en el borrador (si se quitó, ya no hay repetido).
function duplicateOf(draft: TicketDraft, line: DraftLine): DraftLine | null {
  if (line.possibleDuplicateOf === null) return null;
  return draft.lines.find((other) => other.key === line.possibleDuplicateOf) ?? null;
}

function isPositiveNumber(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeNumber(value: string) {
  const parsed = Number(value);
  return value.trim() === "" || (Number.isFinite(parsed) && parsed >= 0);
}

// Al confirmar el costo y el total no pueden quedar vacios (el backend los exige).
function isRequiredNonNegative(value: string) {
  return value.trim() !== "" && isNonNegativeNumber(value);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Reglas de la confirmacion (pantalla): mismas que valida el backend.
function lineIssues(line: DraftLine): LineIssues {
  const isNew = line.selection.kind === "new";
  return {
    qty: !isPositiveNumber(line.qty),
    cost: !isRequiredNonNegative(line.unitCost),
    name: isNew && !line.newName.trim(),
    category: isNew && !line.newCategory.trim(),
    salePrice: isNew && !isPositiveNumber(line.newSalePrice)
  };
}

function hasIssues(issues: LineIssues) {
  return issues.qty || issues.cost || issues.name || issues.category || issues.salePrice;
}

const ISSUE_LABELS: Record<keyof LineIssues, string> = {
  qty: "cantidad",
  cost: "costo unitario",
  name: "nombre",
  category: "categoría",
  salePrice: "precio de venta"
};

// Estado de la linea a partir de lineIssues: rojo = producto nuevo sin
// categoria ni precio de venta, amarillo = otro pendiente, verde = completa.
function lineStatus(line: DraftLine): { status: TicketLineStatus; missing: string[] } {
  const issues = lineIssues(line);
  const missing = (Object.keys(ISSUE_LABELS) as (keyof LineIssues)[]).filter((key) => issues[key]).map((key) => ISSUE_LABELS[key]);
  if (!missing.length) return { status: "complete", missing };
  const isNew = line.selection.kind === "new";
  return { status: isNew && issues.category && issues.salePrice ? "missing" : "partial", missing };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function linesTotalOf(draft: TicketDraft) {
  return roundMoney(draft.lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitCost) || 0), 0));
}

// Total calculado (no leído y sin editar): sigue a la suma de las líneas.
function syncComputedTotal(draft: TicketDraft): TicketDraft {
  return draft.totalComputed ? { ...draft, total: String(linesTotalOf(draft)) } : draft;
}

// Cuerpo exacto de POST /products/restock/ticket/confirm.
function buildConfirmRequest(draft: TicketDraft, acknowledgeDuplicate: boolean): TicketConfirmRequest {
  return {
    image_sha256: draft.imageSha256,
    supplier_id: draft.supplierId ? Number(draft.supplierId) : null,
    ticket_date: draft.date,
    total: Number(draft.total),
    folio: draft.folio,
    ...(acknowledgeDuplicate ? { acknowledge_possible_duplicate: true } : {}),
    lines: draft.lines.map((line) => (line.selection.kind === "product"
      ? { product_id: line.selection.product.product_id, new_product: null, qty: Number(line.qty), unit_cost: Number(line.unitCost) }
      : {
        product_id: null,
        new_product: { name: line.newName.trim(), sale_price: Number(line.newSalePrice), category: line.newCategory.trim() },
        qty: Number(line.qty),
        unit_cost: Number(line.unitCost)
      }))
  };
}

function buildConfirmSummary(draft: TicketDraft): TicketConfirmSummary {
  const restocked = new Set(draft.lines.flatMap((line) => (line.selection.kind === "product" ? [line.selection.product.product_id] : [])));
  return {
    supplierName: draft.candidates.find((candidate) => String(candidate.id) === draft.supplierId)?.name || null,
    date: draft.date,
    lineCount: draft.lines.length,
    newCount: draft.lines.filter((line) => line.selection.kind === "new").length,
    restockCount: restocked.size,
    total: Number(draft.total),
    linesTotal: linesTotalOf(draft),
    possibleDuplicateCount: draft.lines.filter((line) => duplicateOf(draft, line)).length
  };
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

const pendingItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.85rem"
};

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

export function TicketUploadModal({ token, hideCosts, canConfirm, onClose }: TicketUploadModalProps) {
  const titleId = useId();
  const fileInputId = useId();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLParagraphElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // true en cuanto se confirma o se anula una compra: al cerrar se refresca Reabastecer.
  const changedRef = useRef(false);
  const [step, setStep] = useState<Step>("select");
  // Paso al que regresa "Volver" desde Compras con ticket.
  const [returnStep, setReturnStep] = useState<Step>("select");
  // Solo en memoria: de 1 a MAX_PHOTOS fotos del mismo ticket, en orden. Se
  // sueltan al leer con éxito, al quitarlas y al cerrar; si la lectura falla se conservan.
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const photosRef = useRef<TicketPhoto[]>([]);
  photosRef.current = photos;
  const nextPhotoIdRef = useRef(1);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraButtonRef = useRef<HTMLButtonElement | null>(null);
  // "Preparando foto 2 de 3…" / "Leyendo el ticket (3 fotos)…".
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  // Panel "Quedan pendientes" (solo con canConfirm): se abre al presionar Confirmar con datos faltantes.
  const [showPending, setShowPending] = useState(false);
  const lineIdPrefix = useId();
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const totalInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<HTMLDivElement | null>(null);
  // Confirmacion.
  const [confirmSummary, setConfirmSummary] = useState<TicketConfirmSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [conflict, setConflict] = useState<"duplicate_image" | "possible_duplicate" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<{ response: TicketConfirmResponse; summary: TicketConfirmSummary } | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidResult, setVoidResult] = useState<TicketVoidResponse | null>(null);

  function close() {
    if (submitting) return;
    onClose(changedRef.current);
  }

  // Foco inicial, regreso del foco y cancelacion de la lectura al cerrar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (fileInputRef.current ?? cameraButtonRef.current)?.focus();
    return () => {
      requestRef.current?.abort();
      // Al cerrar: liberar las miniaturas que sigan en memoria.
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (step === "done") resultRef.current?.focus();
  }, [step]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
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

  // Agrega las fotos elegidas al final de la lista (hasta MAX_PHOTOS). Cámara:
  // una por vez; galería y escritorio: varias. El input se limpia para poder
  // volver a elegir el mismo archivo.
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError("");
    if (chosen.length === 0) return;
    const images = chosen.filter((file) => file.type.startsWith("image/"));
    const free = MAX_PHOTOS - photosRef.current.length;
    const added = images.slice(0, Math.max(free, 0)).map((file) => ({
      id: nextPhotoIdRef.current++,
      file,
      url: URL.createObjectURL(file)
    }));
    if (added.length) setPhotos((current) => [...current, ...added]);
    if (images.length < chosen.length) {
      setError(chosen.length === 1 ? "El archivo no es una imagen. Elige una foto del ticket." : "Algunos archivos no son imágenes y no se agregaron.");
    } else if (images.length > added.length) {
      setError(`Un ticket admite como máximo ${MAX_PHOTOS} fotos; se agregaron ${added.length}.`);
    }
  }

  function removePhoto(id: number) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      return current.filter((item) => item.id !== id);
    });
  }

  function movePhoto(index: number, offset: -1 | 1) {
    setPhotos((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function clearPhotos() {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    setPhotos([]);
  }

  async function readTicket() {
    const toRead = photosRef.current;
    if (toRead.length === 0) {
      setError("Elige una foto del ticket.");
      return;
    }
    setError("");
    setStep("loading");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const images: Blob[] = [];
      for (const [index, photo] of toRead.entries()) {
        if (toRead.length > 1) setProgress(`Preparando foto ${index + 1} de ${toRead.length}…`);
        images.push(await resizeImage(photo.file));
        if (controller.signal.aborted) return;
      }
      setProgress(toRead.length > 1 ? `Leyendo el ticket (${toRead.length} fotos)…` : "");
      const response = await apiExtractPurchaseTicket(token, images, controller.signal);
      if (controller.signal.aborted) return;
      clearPhotos();
      setDraft(buildDraft(response, hideCosts));
      setStep("preview");
    } catch (readError) {
      if (controller.signal.aborted || (readError as { name?: string })?.name === "AbortError") return;
      // Las fotos se conservan para reintentar o cambiar alguna.
      setError(readError instanceof Error ? readError.message : "No se pudo leer el ticket.");
      setStep("select");
    } finally {
      setProgress("");
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function readAnother() {
    setDraft(null);
    clearPhotos();
    setError("");
    setOpenPicker(null);
    setShowPending(false);
    setResult(null);
    setVoidResult(null);
    setStep("select");
    window.setTimeout(() => (fileInputRef.current ?? cameraButtonRef.current)?.focus(), 0);
  }

  function openPurchases() {
    setConfirmSummary(null);
    setOpenPicker(null);
    setReturnStep(step === "purchases" ? returnStep : step);
    setStep("purchases");
  }

  function openConfirm() {
    if (!draft) return;
    // Con datos faltantes no se abre el diálogo: se muestra qué queda pendiente.
    if (!canSubmit) {
      setOpenPicker(null);
      setShowPending(true);
      window.setTimeout(() => focusField(pendingRef.current), 0);
      return;
    }
    setShowPending(false);
    setConfirmError("");
    setConflict(null);
    setAcknowledged(false);
    setOpenPicker(null);
    setConfirmSummary(buildConfirmSummary(draft));
  }

  async function submitConfirm() {
    if (!draft || !confirmSummary || submitting) return;
    setSubmitting(true);
    setConfirmError("");
    try {
      const response = await apiConfirmPurchaseTicket(token, buildConfirmRequest(draft, conflict === "possible_duplicate" && acknowledged));
      changedRef.current = true;
      setResult({ response, summary: confirmSummary });
      setVoidResult(null);
      setConfirmSummary(null);
      setDraft(null);
      setStep("done");
    } catch (confirmFailure) {
      const reason = confirmFailure instanceof TicketApiError && confirmFailure.status === 409 ? confirmFailure.reason : null;
      if (reason === "duplicate_image" || reason === "possible_duplicate") {
        setConflict(reason);
      } else {
        setConflict(null);
        setConfirmError(confirmFailure instanceof TicketApiError ? confirmFailure.message : "No se pudo cargar la compra. Intenta de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setDraft((current) => current && syncComputedTotal({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line))
    }));
  }

  function removeLine(key: number) {
    setOpenPicker((current) => (current === key ? null : current));
    setDraft((current) => current && syncComputedTotal({ ...current, lines: current.lines.filter((line) => line.key !== key) }));
  }

  // "Ir" del panel de pendientes: lleva a la línea y enfoca su primer campo marcado.
  function focusLine(key: number) {
    const row = document.getElementById(`${lineIdPrefix}-${key}`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    (row.querySelector<HTMLElement>('[aria-invalid="true"]') ?? row).focus({ preventScroll: true });
  }

  function focusField(element: HTMLElement | null) {
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
  }

  const unmatchedCount = draft ? draft.lines.filter((line) => !line.match).length : 0;
  // En modo confirmar todo lo que falta se marca en rojo y bloquea el boton.
  const issuesByLine = new Map(draft ? draft.lines.map((line) => [line.key, lineIssues(line)]) : []);
  const totalInvalid = canConfirm ? !(draft && isRequiredNonNegative(draft.total)) : !(draft && isNonNegativeNumber(draft.total));
  const dateInvalid = canConfirm && !(draft && isValidDate(draft.date));
  const invalidLineCount = [...issuesByLine.values()].filter(hasIssues).length;
  const canSubmit = Boolean(canConfirm && draft && draft.lines.length > 0 && !totalInvalid && !dateInvalid && invalidLineCount === 0);
  // Estado por línea y contador: solo con canConfirm (vista previa sin cambios).
  const statusByLine = new Map(canConfirm && draft ? draft.lines.map((line) => [line.key, lineStatus(line)]) : []);
  const completeCount = [...statusByLine.values()].filter((entry) => entry.status === "complete").length;
  const pendingVisible = Boolean(showPending && canConfirm && draft && draft.lines.length > 0 && !canSubmit);

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
    const invalid = canConfirm ? Boolean(issuesByLine.get(line.key)?.cost) : !isNonNegativeNumber(line.unitCost);
    return (
      <input
        aria-invalid={invalid}
        aria-label={`Costo unitario de ${line.rawName}`}
        inputMode="decimal"
        min="0"
        onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
        step="0.01"
        style={{ ...cellInputStyle, ...invalidStyle(invalid) }}
        type="number"
        value={line.unitCost}
      />
    );
  }

  function renderPicker(line: DraftLine) {
    return (
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <ProductPicker
          lineName={line.rawName}
          onSelect={(selection) => updateLine(line.key, { selection })}
          onToggle={(open) => setOpenPicker(open ? line.key : null)}
          open={openPicker === line.key}
          options={line.options}
          selection={line.selection}
          token={token}
        />
        {renderMatchSuggestion(line)}
        {canConfirm && line.selection.kind === "new" ? renderNewProduct(line) : null}
      </div>
    );
  }

  // Coincidencia solo por nombre o parecido: se sugiere sin preseleccionar.
  // Mientras siga "Nuevo producto", el usuario puede elegir el existente aqui.
  function renderMatchSuggestion(line: DraftLine) {
    const match = line.match;
    if (!match || isExactMatch(match) || line.selection.kind !== "new") return null;
    const product: TicketProductRef = { product_id: match.product_id, name: match.name, sku: match.sku };
    return (
      <div role="note" style={{ ...ticketWarningStyle, margin: 0, fontSize: "0.8rem", display: "grid", gap: "0.35rem" }}>
        <span style={{ overflowWrap: "anywhere" }}>
          <strong>¿Es este producto?</strong> {productLabel(product)}
        </span>
        <span className="inline-actions" style={{ flexWrap: "wrap" }}>
          <button className="button ghost" onClick={() => updateLine(line.key, { selection: { kind: "product", product } })} type="button">
            Sí, sumar a este producto
          </button>
        </span>
      </div>
    );
  }

  // Datos del producto que se creara al confirmar (nombre, categoria existente y precio de venta).
  function renderNewProduct(line: DraftLine) {
    const issues = issuesByLine.get(line.key);
    return (
      <div style={{ display: "grid", gap: "0.4rem", padding: "0.5rem", borderRadius: "10px", border: "1px dashed var(--border)" }}>
        <label style={fieldStyle}>
          <span>Nombre del producto nuevo</span>
          <input
            aria-invalid={Boolean(issues?.name)}
            maxLength={200}
            onChange={(event) => updateLine(line.key, { newName: event.target.value })}
            style={{ ...cellInputStyle, ...invalidStyle(Boolean(issues?.name)) }}
            type="text"
            value={line.newName}
          />
        </label>
        <div style={fieldStyle}>
          <span>Categoría</span>
          <TicketCategoryPicker
            invalid={Boolean(issues?.category)}
            lineName={line.rawName}
            onChange={(category) => updateLine(line.key, { newCategory: category })}
            token={token}
            value={line.newCategory}
          />
        </div>
        <label style={fieldStyle}>
          <span>Precio de venta</span>
          <input
            aria-invalid={Boolean(issues?.salePrice)}
            inputMode="decimal"
            min="0"
            onChange={(event) => updateLine(line.key, { newSalePrice: event.target.value })}
            step="0.01"
            style={{ ...cellInputStyle, ...invalidStyle(Boolean(issues?.salePrice)) }}
            type="number"
            value={line.newSalePrice}
          />
        </label>
      </div>
    );
  }

  // Varias fotos: de qué foto viene la línea y, si el backend la marcó, el aviso
  // de posible repetido en el borde entre fotos. Con una foto no se muestra nada.
  function renderPhotoInfo(line: DraftLine) {
    if (!draft || draft.imageCount < 2) return null;
    const earlier = duplicateOf(draft, line);
    return (
      <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.25rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>Foto {line.imageIndex + 1}</span>
        {earlier ? (
          <div role="note" style={{ ...ticketWarningStyle, margin: 0, fontSize: "0.8rem", display: "grid", gap: "0.35rem" }}>
            <span>
              <strong>¿Repetida?</strong> Parece el mismo renglón que “{earlier.rawName}” (foto {earlier.imageIndex + 1}).
            </span>
            <span className="inline-actions" style={{ flexWrap: "wrap" }}>
              <button className="button ghost" onClick={() => removeLine(line.key)} type="button">Quitar</button>
              <button className="button ghost" onClick={() => updateLine(line.key, { possibleDuplicateOf: null })} type="button">Es distinta</button>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  function renderBadge(line: DraftLine) {
    const confidence = confidenceOf(line);
    // Con canConfirm el error lo indica el estado: "Sin coincidencia" queda neutro.
    const tone = canConfirm && confidence.tone === "none" ? "manual" : confidence.tone;
    return <span style={toneBadgeStyle(tone)}>{confidence.text}</span>;
  }

  function renderStatus(line: DraftLine) {
    const entry = statusByLine.get(line.key);
    return entry ? <TicketLineStatusBadge missing={entry.missing} status={entry.status} /> : null;
  }

  // Con canConfirm el tinte es el del estado; sin él, el de siempre (sin coincidencia).
  function rowStyle(line: DraftLine): CSSProperties | undefined {
    const entry = statusByLine.get(line.key);
    if (entry) return ticketStatusRowStyle(entry.status);
    return line.match ? undefined : unmatchedStyle;
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
        <h3 id={titleId}>{step === "purchases" ? "Compras con ticket" : "Cargar ticket"}</h3>

        {step === "select" || step === "loading" || step === "preview" ? (
          <p role="note" style={noticeStyle}>
            {canConfirm
              ? "Revisa bien: al confirmar se suma el stock, se actualiza el costo y se registra un egreso del día por el total."
              : "Vista previa: todavía no se guarda nada. Estamos validando la lectura."}
          </p>
        ) : null}
        {step === "select" || step === "loading" || step === "preview" ? (
          // Mismo estilo, pero sin sticky: dos avisos sticky en top 0 se encimarían.
          <p role="note" style={{ ...noticeStyle, position: "static" }}>
            {photos.length > 1 || (draft?.imageCount ?? 1) > 1
              ? "Las fotos se envían a un proveedor de inteligencia artificial (Anthropic) para leer el ticket y no se guardan."
              : "La foto se envía a un proveedor de inteligencia artificial (Anthropic) para leer el ticket y no se guarda."}
          </p>
        ) : null}

        {error ? <p role="alert" style={alertStyle}>{error}</p> : null}

        {step === "select" || step === "loading" ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {isMobile ? (
              // Móvil: la cámara toma una foto por vez y vuelve a la lista; la galería permite varias.
              <div style={fieldStyle}>
                <span>Fotos del ticket</span>
                <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                  <button
                    className="button ghost"
                    disabled={step === "loading" || photos.length >= MAX_PHOTOS}
                    onClick={() => cameraInputRef.current?.click()}
                    ref={cameraButtonRef}
                    type="button"
                  >
                    Tomar foto
                  </button>
                  <button
                    className="button ghost"
                    disabled={step === "loading" || photos.length >= MAX_PHOTOS}
                    onClick={() => galleryInputRef.current?.click()}
                    type="button"
                  >
                    Elegir de galería
                  </button>
                </div>
                <input accept="image/*" capture="environment" hidden onChange={handleFileChange} ref={cameraInputRef} type="file" />
                <input accept="image/*" hidden multiple onChange={handleFileChange} ref={galleryInputRef} type="file" />
              </div>
            ) : (
              <label htmlFor={fileInputId} style={fieldStyle}>
                Fotos del ticket
                <input
                  accept="image/*"
                  disabled={step === "loading" || photos.length >= MAX_PHOTOS}
                  id={fileInputId}
                  multiple
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  type="file"
                />
              </label>
            )}
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              {photos.length === 0
                ? `Ningún archivo seleccionado. Si el ticket es largo, agrega hasta ${MAX_PHOTOS} fotos en orden, de arriba hacia abajo.`
                : `${photos.length} de ${MAX_PHOTOS} fotos`}
            </p>
            {photos.length ? (
              <ol aria-label="Fotos del ticket" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
                {photos.map((photo, index) => {
                  const role = photos.length > 1 ? (index === 0 ? " · encabezado" : index === photos.length - 1 ? " · total" : "") : "";
                  const label = `Foto ${index + 1}${role}`;
                  return (
                    <li
                      key={photo.id}
                      style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.4rem", borderRadius: "10px", border: "1px solid var(--border)" }}
                    >
                      <img
                        alt={`${label} del ticket`}
                        src={photo.url}
                        style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "8px", flex: "none" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: "block", fontSize: "0.9rem" }}>{label}</strong>
                        <span className="muted" style={{ fontSize: "0.78rem", overflowWrap: "anywhere" }}>{photo.file.name}</span>
                      </div>
                      <button
                        aria-label={`Subir ${label}`}
                        className="button ghost"
                        disabled={step === "loading" || index === 0}
                        onClick={() => movePhoto(index, -1)}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Bajar ${label}`}
                        className="button ghost"
                        disabled={step === "loading" || index === photos.length - 1}
                        onClick={() => movePhoto(index, 1)}
                        type="button"
                      >
                        ↓
                      </button>
                      <button
                        aria-label={`Quitar ${label}`}
                        className="button ghost"
                        disabled={step === "loading"}
                        onClick={() => removePhoto(photo.id)}
                        type="button"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {step === "loading" ? (
              <span
                aria-label={progress || "Leyendo el ticket"}
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
                <span className="muted" style={{ fontSize: "0.85rem", marginLeft: "0.4rem" }}>{progress || "Leyendo el ticket..."}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {step === "preview" && draft ? (
          <div style={{ display: "grid", gap: "1rem" }}>
            {/* Many new products: likely a catalog, not a purchase. Informative only. */}
            {(() => {
              const newCount = draft.lines.filter((line) => line.selection.kind === "new").length;
              return newCount > 20 || newCount > draft.lines.length / 2 ? (
                <p role="note" style={{ ...ticketWarningStyle, margin: 0 }}>
                  ¿Es un catálogo y no una compra? Para dar de alta productos sin stock usa Importar productos en Inventario.
                </p>
              ) : null;
            })()}
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
                <input
                  aria-invalid={dateInvalid}
                  onChange={(event) => setDraft({ ...draft, date: event.target.value, dateDefaulted: false })}
                  ref={dateInputRef}
                  style={invalidStyle(dateInvalid)}
                  type="date"
                  value={draft.date}
                />
                {draft.dateDefaulted ? (
                  <span style={{ fontSize: "0.78rem", color: "var(--warning)" }}>Hoy: no se leyó la fecha del ticket</span>
                ) : null}
                {draft.folio ? <span className="muted" style={{ fontSize: "0.78rem" }}>Folio: {draft.folio}</span> : null}
              </label>
              {!hideCosts ? (
                <label style={fieldStyle}>
                  {canConfirm ? "Total (obligatorio)" : "Total"}
                  <input
                    aria-invalid={totalInvalid}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setDraft({ ...draft, total: event.target.value, totalComputed: false })}
                    ref={totalInputRef}
                    step="0.01"
                    style={invalidStyle(totalInvalid)}
                    type="number"
                    value={draft.total}
                  />
                  {draft.totalComputed ? (
                    <span style={{ fontSize: "0.78rem", color: "var(--warning)" }}>
                      Calculado con costo × cantidad: no se leyó el total del ticket. Se actualiza hasta que lo edites.
                    </span>
                  ) : null}
                  {canConfirm ? (
                    <span className="muted" style={{ fontSize: "0.78rem" }}>Suma de las líneas: {currency(linesTotalOf(draft))}</span>
                  ) : null}
                </label>
              ) : null}
            </div>

            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              {draft.lines.length} {draft.lines.length === 1 ? "línea" : "líneas"}
              {unmatchedCount ? ` · ${unmatchedCount} sin coincidencia en el catálogo` : ""}
              {canConfirm && draft.lines.length ? (
                <strong style={{ color: "var(--text)" }}> · {completeCount} de {draft.lines.length} completos</strong>
              ) : null}
            </p>

            {draft.lines.length === 0 ? (
              <p className="muted" role={canConfirm ? "alert" : undefined} style={{ margin: 0, ...(canConfirm ? { color: "var(--danger)" } : {}) }}>
                {canConfirm ? "Se necesita al menos una línea para cargar la compra." : "No hay líneas para revisar."}
              </p>
            ) : isMobile ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
                {draft.lines.map((line) => (
                  <li
                    id={`${lineIdPrefix}-${line.key}`}
                    key={line.key}
                    style={{
                      display: "grid",
                      gap: "0.6rem",
                      padding: "0.75rem",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                      ...rowStyle(line)
                    }}
                    tabIndex={-1}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                      <strong style={{ overflowWrap: "anywhere" }}>{line.rawName}</strong>
                      {renderBadge(line)}
                    </div>
                    {renderStatus(line)}
                    {renderPhotoInfo(line)}
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
                      {canConfirm ? <th scope="col">Estado</th> : null}
                      <th aria-label="Acciones" scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line) => (
                      <tr id={`${lineIdPrefix}-${line.key}`} key={line.key} style={rowStyle(line)} tabIndex={-1}>
                        <td style={{ minWidth: "10rem", overflowWrap: "anywhere" }}>
                          {line.rawName}
                          {renderPhotoInfo(line)}
                        </td>
                        <td>{renderQty(line)}</td>
                        {!hideCosts ? <td>{renderCost(line)}</td> : null}
                        <td>{renderPicker(line)}</td>
                        <td>{renderBadge(line)}</td>
                        {canConfirm ? <td style={{ minWidth: "9rem" }}>{renderStatus(line)}</td> : null}
                        <td>{renderRemove(line)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {step === "done" && result ? (
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <p ref={resultRef} role="status" style={ticketSuccessStyle} tabIndex={-1}>
              {voidResult ? "Compra anulada. El stock y el egreso se revirtieron." : "Compra cargada."}
            </p>
            <TicketFacts
              items={[
                { label: "Proveedor", value: result.summary.supplierName || "Sin proveedor" },
                { label: "Fecha del ticket", value: formatDate(result.summary.date) || result.summary.date },
                { label: "Líneas", value: String(result.response.summary.lines) },
                { label: "Productos reabastecidos", value: String(result.response.summary.restocked_lines) },
                { label: "Productos creados", value: String(result.response.summary.products_created.length) },
                {
                  label: voidResult ? "Egreso (anulado)" : "Egreso registrado",
                  value: `${currency(result.response.summary.expense.amount)} en efectivo · ${formatDate(result.response.summary.expense.date) || result.response.summary.expense.date}`
                }
              ]}
            />
            {result.response.summary.products_created.length ? (
              <div style={{ fontSize: "0.85rem" }}>
                <span className="muted">{voidResult ? "Productos creados (no se borraron al anular):" : "Productos nuevos:"}</span>
                <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
                  {result.response.summary.products_created.map((product) => (
                    <li key={product.product_id} style={{ overflowWrap: "anywhere" }}>{product.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {voidResult && (voidResult.cost_kept.length || voidResult.supplier_cost_kept.length) ? (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                Algunos costos se cambiaron después de la compra y se dejaron como están.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "purchases" ? (
          <TicketPurchasesList
            isMobile={isMobile}
            onChanged={() => {
              changedRef.current = true;
            }}
            token={token}
          />
        ) : null}

        {step === "preview" && pendingVisible && draft ? (
          <div
            aria-labelledby={`${lineIdPrefix}-pending`}
            ref={pendingRef}
            role="region"
            style={{ ...ticketWarningStyle, margin: "1rem 0 0", display: "grid", gap: "0.5rem", maxHeight: "16rem", overflowY: "auto" }}
            tabIndex={-1}
          >
            <strong id={`${lineIdPrefix}-pending`}>Quedan pendientes</strong>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}>
              {dateInvalid ? (
                <li style={pendingItemStyle}>
                  <span>
                    <span aria-hidden="true">! </span><strong>Fecha del ticket</strong>: falta una fecha válida
                  </span>
                  <button aria-label="Ir a la fecha del ticket" className="button ghost" onClick={() => focusField(dateInputRef.current)} type="button">Ir</button>
                </li>
              ) : null}
              {totalInvalid ? (
                <li style={pendingItemStyle}>
                  <span>
                    <span aria-hidden="true">! </span><strong>Total del ticket</strong>: falta el monto
                  </span>
                  <button aria-label="Ir al total del ticket" className="button ghost" onClick={() => focusField(totalInputRef.current)} type="button">Ir</button>
                </li>
              ) : null}
              {draft.lines.map((line) => {
                const entry = statusByLine.get(line.key);
                if (!entry || entry.status === "complete") return null;
                return (
                  <li key={line.key} style={pendingItemStyle}>
                    <span style={{ overflowWrap: "anywhere" }}>
                      <span aria-hidden="true">{entry.status === "missing" ? "✕ " : "! "}</span>
                      <strong>{line.rawName}</strong>: falta {entry.missing.join(", ")}
                    </span>
                    <button aria-label={`Ir a ${line.rawName}`} className="button ghost" onClick={() => focusLine(line.key)} type="button">Ir</button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="inline-actions modal-actions-end" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          {canConfirm && step !== "purchases" && step !== "loading" ? (
            <button className="button ghost" onClick={openPurchases} type="button">Compras con ticket</button>
          ) : null}
          {step === "purchases" ? (
            <button className="button ghost" onClick={() => setStep(returnStep)} type="button">Volver</button>
          ) : null}
          {step === "preview" || step === "done" ? (
            <button className="button ghost" onClick={readAnother} type="button">Leer otro ticket</button>
          ) : null}
          {step === "done" && result && !voidResult ? (
            <button className="button ghost" onClick={() => setShowVoid(true)} type="button">Anular esta compra</button>
          ) : null}
          <button className="button ghost" disabled={submitting} onClick={close} type="button">Cerrar</button>
          {step === "select" || step === "loading" ? (
            <button
              className="button"
              disabled={photos.length === 0 || step === "loading"}
              onClick={() => readTicket().catch(() => undefined)}
              type="button"
            >
              {step === "loading" ? "Leyendo..." : "Leer ticket"}
            </button>
          ) : null}
          {step === "preview" && canConfirm ? (
            <button className="button" disabled={!draft || draft.lines.length === 0} onClick={openConfirm} type="button">Confirmar compra</button>
          ) : null}
        </div>
        {step === "preview" && canConfirm && draft && draft.lines.length > 0 && !canSubmit && !pendingVisible ? (
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", textAlign: "right" }}>
            Pendiente: {[
              invalidLineCount ? `${invalidLineCount} ${invalidLineCount === 1 ? "producto" : "productos"} por completar` : "",
              dateInvalid ? "la fecha" : "",
              totalInvalid ? "el total" : ""
            ].filter(Boolean).join(", ")}. Presiona “Confirmar compra” para ver qué falta.
          </p>
        ) : null}

        {confirmSummary ? (
          <TicketConfirmDialog
            acknowledged={acknowledged}
            conflict={conflict}
            error={confirmError}
            onAcknowledgedChange={setAcknowledged}
            onBack={() => setConfirmSummary(null)}
            onConfirm={() => submitConfirm().catch(() => undefined)}
            onShowPurchases={openPurchases}
            submitting={submitting}
            summary={confirmSummary}
          />
        ) : null}

        {showVoid && result ? (
          <TicketVoidDialog
            facts={[
              { label: "Proveedor", value: result.summary.supplierName || "Sin proveedor" },
              { label: "Fecha", value: formatDate(result.summary.date) || result.summary.date },
              { label: "Total", value: currency(result.response.summary.total) }
            ]}
            onClose={() => setShowVoid(false)}
            onVoided={(voided) => {
              changedRef.current = true;
              setVoidResult(voided);
              setShowVoid(false);
              window.setTimeout(() => resultRef.current?.focus(), 0);
            }}
            ticketId={result.response.ticket_id}
            token={token}
          />
        ) : null}
      </div>
    </div>
  );
}
