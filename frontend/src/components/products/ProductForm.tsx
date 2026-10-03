import { useEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { ProductUpdateRequestSummary, Supplier } from "../../types";
import { SALE_UNITS, isIntegerUnit, type SaleUnit } from "../../constants/saleUnits";
import { currency } from "../../utils/format";
import {
  focusNextVisibleFieldOnEnter,
  getResolvedSaleUnit,
  normalizeMoneyInput,
  recalculateGain,
  recalculatePrice,
  requiredLabel
} from "../../utils/productForm";
import type { ProductFormState, ProductSupplierFormState } from "./productFormTypes";
import { PrimarySupplierSection } from "./SuppliersEditor";

// Componente de presentacion: el estado del producto vive en ProductsPage porque sus
// handlers (handleEdit, resetProductEditor, handleSubmit) lo resetean. Aqui solo vive el
// estado de la vista (secciones abiertas, casillas de caducidad/IEPS, unidades extra);
// ProductsPage remonta este componente (key) cada vez que carga un formulario nuevo.
export type ProductFormProps = {
  appliesAutomaticIeps: boolean;
  barcodeSuggestion: string;
  categories: string[];
  currentImagePath: string | null;
  editingId: number | null;
  error: string;
  form: ProductFormState;
  handleImageSelection: (file: File | null) => void;
  handleRemoveImage: () => void;
  handleStockMaximoEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  handleSubmit: (event: FormEvent) => Promise<void>;
  hasSuggestedBarcode: boolean;
  hasSuggestedSku: boolean;
  imageFile: File | null;
  imagePreview: string | null;
  info: string;
  inventoryPath: string;
  isCashier: boolean;
  loadCategories: (searchTerm?: string) => Promise<void>;
  loadSuppliers: (searchTerm?: string) => Promise<void>;
  openSuppliersModal: () => void;
  printBarcodeLabel: (productId?: number, productName?: string, productBarcode?: string) => Promise<void>;
  removeImageRequested: boolean;
  requestSummary: ProductUpdateRequestSummary | null;
  resetProductEditor: () => void;
  resolveSupplierByName: (name: string) => Supplier | null;
  saving: boolean;
  setError: Dispatch<SetStateAction<string>>;
  setForm: Dispatch<SetStateAction<ProductFormState>>;
  showExpiryField: boolean;
  showIepsField: boolean;
  showProductImage: boolean;
  skuSuggestion: string;
  supplierNameInputRef: RefObject<HTMLInputElement | null>;
  suppliers: Supplier[];
  updateSupplier: (index: number, nextSupplier: ProductSupplierFormState) => void;
};

type SectionId = "codes" | "supplier" | "expiry" | "ieps" | "details";

// Mismos valores que el <select> anterior: "Pieza" guarda "" (el backend lo resuelve a pieza).
const PRIMARY_UNIT_OPTIONS: Array<{ value: SaleUnit | ""; label: string }> = [
  { value: "", label: "Pieza" },
  { value: "kg", label: "Kilo" },
  { value: "litro", label: "Litro" },
  { value: "caja", label: "Caja" }
];
const PRIMARY_UNIT_VALUES = new Set<string>(["", "pieza", "kg", "litro", "caja"]);
const MORE_UNIT_OPTIONS = SALE_UNITS
  .filter((unit) => !PRIMARY_UNIT_VALUES.has(unit))
  .map((unit) => ({ value: unit, label: unit.charAt(0).toUpperCase() + unit.slice(1) }));

function isUnitSelected(current: SaleUnit | "", value: SaleUnit | "") {
  if (value === "") return current === "" || current === "pieza";
  return current === value;
}

function hasText(value: unknown) {
  return String(value ?? "").trim() !== "";
}

type CollapsibleSectionProps = {
  id: SectionId;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
};

function CollapsibleSection({ id, title, summary, open, onToggle, children }: CollapsibleSectionProps) {
  const bodyId = `product-form-section-${id}`;
  return (
    <section className="product-form-card product-form-collapsible" data-form-section={id}>
      <h3 className="product-form-collapsible-heading">
        <button
          aria-controls={bodyId}
          aria-expanded={open}
          className="product-form-collapsible-toggle"
          onClick={() => onToggle(id)}
          type="button"
        >
          <span className="product-form-collapsible-titles">
            <span className="product-form-card-title">{title}</span>
            {!open && summary ? <span className="product-form-card-subtitle">{summary}</span> : null}
          </span>
          <span className="product-form-chip">Opcional</span>
          <span aria-hidden="true" className={`product-form-chevron${open ? " is-open" : ""}`} />
        </button>
      </h3>
      <div className="product-form-collapsible-body" hidden={!open} id={bodyId}>
        {children}
      </div>
    </section>
  );
}

export function ProductForm({
  appliesAutomaticIeps,
  barcodeSuggestion,
  categories,
  currentImagePath,
  editingId,
  error,
  form,
  handleImageSelection,
  handleRemoveImage,
  handleStockMaximoEnter,
  handleSubmit,
  hasSuggestedBarcode,
  hasSuggestedSku,
  imageFile,
  imagePreview,
  info,
  inventoryPath,
  isCashier,
  loadCategories,
  loadSuppliers,
  openSuppliersModal,
  printBarcodeLabel,
  removeImageRequested,
  requestSummary,
  resetProductEditor,
  resolveSupplierByName,
  saving,
  setError,
  setForm,
  showExpiryField,
  showIepsField,
  showProductImage,
  skuSuggestion,
  supplierNameInputRef,
  suppliers,
  updateSupplier
}: ProductFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  // Mismo corte que el CSS movil (<= 640 px).
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    codes: false,
    supplier: false,
    expiry: false,
    ieps: false,
    details: false
  });
  const [showMoreUnits, setShowMoreUnits] = useState(() => !PRIMARY_UNIT_VALUES.has(form.unidad_de_venta));
  // Casillas de vista: no viajan en el payload. Desmarcarlas vacia los campos, que es
  // exactamente lo que se mandaba antes cuando el usuario los dejaba vacios.
  const [expiryEnabled, setExpiryEnabled] = useState(() => hasText(form.lot_number) || hasText(form.expires_at));
  const [iepsEnabled, setIepsEnabled] = useState(() => Number(form.ieps) > 0);

  useEffect(() => {
    if (hasText(form.lot_number) || hasText(form.expires_at)) setExpiryEnabled(true);
  }, [form.lot_number, form.expires_at]);

  useEffect(() => {
    if (Number(form.ieps) > 0) setIepsEnabled(true);
  }, [form.ieps]);

  // Un campo invalido dentro de una seccion plegada bloquea el submit sin mostrar el
  // mensaje del navegador (no se puede enfocar). Se abre la seccion y se vuelve a reportar.
  useEffect(() => {
    const formElement = formRef.current;
    if (!formElement) return undefined;

    function handleInvalid(event: Event) {
      const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const firstInvalid = formElement?.querySelector("input:invalid, select:invalid, textarea:invalid");
      if (target !== firstInvalid || !target.closest("[hidden]")) return;
      const sectionId = target.closest("[data-form-section]")?.getAttribute("data-form-section") as SectionId | null;
      if (!sectionId) return;
      flushSync(() => setOpenSections((current) => ({ ...current, [sectionId]: true })));
      window.setTimeout(() => {
        target.reportValidity();
      }, 0);
    }

    formElement.addEventListener("invalid", handleInvalid, true);
    return () => formElement.removeEventListener("invalid", handleInvalid, true);
  }, []);

  function toggleSection(id: SectionId) {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  }

  const showExtraUnits = showMoreUnits || !PRIMARY_UNIT_VALUES.has(form.unidad_de_venta);
  const quantityStep = isIntegerUnit(getResolvedSaleUnit(form.unidad_de_venta)) ? "1" : "0.001";
  const hasProfit = hasText(form.price) && hasText(form.cost_price)
    && Number.isFinite(Number(form.price)) && Number.isFinite(Number(form.cost_price));
  const profit = hasProfit ? Number(form.price) - Number(form.cost_price) : null;
  const profitLabel = profit === null ? "—" : currency(profit);
  // Mismos campos que hoy son obligatorios (handleSubmit + required del formulario).
  const essentials = [
    { label: "Nombre", done: hasText(form.name) },
    { label: "Precio al público", done: hasText(form.price) },
    { label: "Categoría", done: hasText(form.category) },
    { label: "Cuántos tienes", done: hasText(form.stock) },
    { label: "Aviso de “por acabarse”", done: hasText(form.stock_minimo) },
    { label: "Máximo que quieres tener", done: hasText(form.stock_maximo) }
  ];
  const essentialsDone = essentials.filter((item) => item.done).length;
  const essentialsPercent = Math.round((essentialsDone / essentials.length) * 100);
  const previewMeta = [form.category.trim(), getResolvedSaleUnit(form.unidad_de_venta)].filter(Boolean).join(" · ");
  const title = isCashier
    ? (editingId ? "Solicitar cambio en producto" : "Solicitar cambio de producto")
    : (editingId ? "Editar producto" : "Nuevo producto");

  return (
    <form
      className={`panel product-form-panel product-form-panel-wide${isMobile ? " product-form-mobile-form" : ""}`}
      onKeyDownCapture={focusNextVisibleFieldOnEnter}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <div className="product-form-page-header">
        <Link className="product-form-back" to={inventoryPath}>
          <span aria-hidden="true">‹</span> Inventario
        </Link>
        <h2 className="product-form-title">{title}</h2>
      </div>
      {isCashier && requestSummary ? (
        <div className="stats-grid">
          <div className="info-card compact-box"><strong>{requestSummary.pending}</strong><span className="muted">Pendientes</span></div>
          <div className="info-card compact-box"><strong>{requestSummary.approved}</strong><span className="muted">Aprobadas</span></div>
          <div className="info-card compact-box"><strong>{requestSummary.rejected}</strong><span className="muted">Rechazadas</span></div>
          <div className="info-card compact-box"><strong>{requestSummary.today}</strong><span className="muted">Enviadas hoy</span></div>
        </div>
      ) : null}
      {isCashier && !editingId ? (
        <div className="info-card">
          <p><strong>Solicitud de cambios</strong></p>
          <p>Desde esta cuenta solo puedes solicitar cambios de stock con motivo obligatorio para aprobación administrativa.</p>
        </div>
      ) : null}

      <div className="product-form-layout">
        <div className="product-form-main">
          <section className="product-form-card">
            <div className="product-form-card-header">
              <h3 className="product-form-card-title">Lo esencial</h3>
              <p className="product-form-card-subtitle">Los campos con * son obligatorios.</p>
            </div>
            <label className="product-form-field">
              {requiredLabel("Nombre del producto")}
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <div className="product-form-grid-2">
              <label className="product-form-field">
                {requiredLabel("Precio al público")}
                <span className="product-form-affix">
                  <span aria-hidden="true" className="product-form-affix-symbol">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.00001"
                    value={form.price}
                    onChange={(event) => {
                      const nextPrice = normalizeMoneyInput(event.target.value);
                      setForm({ ...form, price: nextPrice, porcentaje_ganancia: recalculateGain(form.cost_price, nextPrice) });
                    }}
                    required
                  />
                </span>
              </label>
              <label className="product-form-field">
                {requiredLabel("Categoría")}
                <input
                  list="product-category-options"
                  value={form.category}
                  onChange={(event) => {
                    setForm({ ...form, category: event.target.value });
                    loadCategories(event.target.value).catch(console.error);
                  }}
                  required
                />
              </label>
            </div>
            <datalist id="product-category-options">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <div className="product-form-field" role="group" aria-labelledby="product-form-units-label">
              <span id="product-form-units-label">¿Cómo lo vendes?</span>
              <div className="product-form-units">
                {PRIMARY_UNIT_OPTIONS.map((option) => (
                  <button
                    aria-pressed={isUnitSelected(form.unidad_de_venta, option.value)}
                    className={`product-form-unit${isUnitSelected(form.unidad_de_venta, option.value) ? " is-active" : ""}`}
                    key={option.label}
                    onClick={() => setForm({ ...form, unidad_de_venta: option.value })}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
                {showExtraUnits ? MORE_UNIT_OPTIONS.map((option) => (
                  <button
                    aria-pressed={isUnitSelected(form.unidad_de_venta, option.value)}
                    className={`product-form-unit${isUnitSelected(form.unidad_de_venta, option.value) ? " is-active" : ""}`}
                    key={option.value}
                    onClick={() => setForm({ ...form, unidad_de_venta: option.value })}
                    type="button"
                  >
                    {option.label}
                  </button>
                )) : (
                  <button
                    aria-expanded={false}
                    className="product-form-unit product-form-unit-more"
                    onClick={() => setShowMoreUnits(true)}
                    type="button"
                  >
                    Más
                  </button>
                )}
              </div>
            </div>
            {showProductImage ? (
              <div className="product-image-panel">
                <div className="product-image-preview-frame">
                  {imagePreview && !removeImageRequested ? (
                    <img alt="Vista previa del producto" className="product-image-preview" src={imagePreview} />
                  ) : (
                    <div className="product-image-placeholder">
                      <span>Sin imagen</span>
                    </div>
                  )}
                </div>
                <div className="product-image-actions">
                  <label className="product-image-upload">
                    Imagen del producto
                    <input
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        try {
                          handleImageSelection(event.target.files?.[0] || null);
                          setError("");
                        } catch (imageError) {
                          setError(imageError instanceof Error ? imageError.message : "No fue posible procesar la imagen");
                          event.currentTarget.value = "";
                        }
                      }}
                      type="file"
                    />
                  </label>
                  <p className="muted">Formatos permitidos: jpg, jpeg, png y webp. Tamaño máximo: 2MB.</p>
                  {currentImagePath && !imageFile && !removeImageRequested ? <p className="muted">Imagen actual cargada en servidor.</p> : null}
                  {imageFile ? <p className="muted">Nueva imagen lista para subir: {imageFile.name}</p> : null}
                  {(currentImagePath || imageFile) && !removeImageRequested ? (
                    <button className="button ghost danger" onClick={handleRemoveImage} type="button">
                      Remover imagen
                    </button>
                  ) : null}
                  {removeImageRequested ? <p className="muted">La imagen se eliminará al guardar.</p> : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="product-form-card">
            <div className="product-form-card-header">
              <h3 className="product-form-card-title">Existencias</h3>
              <p className="product-form-card-subtitle">Así el sistema te avisa antes de que algo se acabe.</p>
            </div>
            <div className="product-form-grid-3">
              <label className="product-form-field">
                {requiredLabel("¿Cuántos tienes?")}
                <input type="number" min="0" step={quantityStep} value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
                <span className="product-form-hint">Lo que hay hoy.</span>
              </label>
              <label className="product-form-field">
                {requiredLabel("Avisarme cuando queden")}
                <input type="number" min="0" step={quantityStep} value={form.stock_minimo} onChange={(event) => setForm({ ...form, stock_minimo: event.target.value })} required />
                <span className="product-form-hint">Con esta cantidad lo marcamos “Por acabarse”.</span>
              </label>
              <label className="product-form-field">
                {requiredLabel("Máximo que quieres tener")}
                <input type="number" min="0" onKeyDown={handleStockMaximoEnter} step={quantityStep} value={form.stock_maximo} onChange={(event) => setForm({ ...form, stock_maximo: event.target.value })} required />
                <span className="product-form-hint">Te ayuda a no comprar de más.</span>
              </label>
            </div>
          </section>

          {/* El cajero no ve costos ni margen. */}
          {!isCashier ? (
            <section className="product-form-card">
              <div className="product-form-card-header">
                <h3 className="product-form-card-title">Costo y ganancia</h3>
                <p className="product-form-card-subtitle">Opcional. Si escribes el costo y el porcentaje, calculamos el precio por ti.</p>
              </div>
              <div className="product-form-grid-3">
                <label className="product-form-field">
                  Costo del producto
                  <span className="product-form-affix">
                    <span aria-hidden="true" className="product-form-affix-symbol">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.00001"
                      value={form.cost_price}
                      onChange={(event) => {
                        const nextCostPrice = normalizeMoneyInput(event.target.value);
                        setForm({ ...form, cost_price: nextCostPrice, porcentaje_ganancia: recalculateGain(nextCostPrice, form.price) });
                      }}
                    />
                  </span>
                  <span className="product-form-hint">Lo que te cuesta a ti.</span>
                </label>
                <label className="product-form-field">
                  % de ganancia
                  <span className="product-form-affix product-form-affix-suffix">
                    <input type="number" step="0.001" value={form.porcentaje_ganancia} onChange={(event) => setForm({ ...form, porcentaje_ganancia: event.target.value, price: event.target.value === "" ? form.price : recalculatePrice(form.cost_price, event.target.value) })} />
                    <span aria-hidden="true" className="product-form-affix-symbol">%</span>
                  </span>
                  <span className="product-form-hint">Sobre el costo.</span>
                </label>
                <div className="product-form-field">
                  <span>Ganas por pieza</span>
                  <output className={`product-form-profit${profit !== null && profit < 0 ? " is-negative" : ""}`}>{profitLabel}</output>
                  <span className="product-form-hint">Precio menos costo.</span>
                </div>
              </div>
            </section>
          ) : null}

          <CollapsibleSection
            id="codes"
            onToggle={toggleSection}
            open={openSections.codes}
            summary="El SKU se genera solo. Escanea o escribe el código de barras."
            title="Código de barras y SKU"
          >
            <div className="product-form-grid-2">
              <label className="product-form-field">
                SKU
                <span className="product-form-readonly">
                  <svg aria-hidden="true" className="product-form-lock" viewBox="0 0 16 16">
                    <rect height="7" rx="1.5" width="10" x="3" y="7" />
                    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                  </svg>
                  <input placeholder="Se genera al guardar" readOnly value={form.sku} />
                </span>
                <span className="product-form-hint">Es el código interno del producto. No tienes que escribirlo.</span>
                {hasSuggestedSku ? <span className="product-form-hint">SKU sugerido visual: {skuSuggestion}. El SKU definitivo y unico se garantiza al guardar.</span> : null}
              </label>
              <label className="product-form-field">
                Código de barras
                <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value.replace(/\D/g, ""), barcode_manually_edited: true })} />
                <span className="product-form-hint">Escanéalo con tu lector o escríbelo.</span>
                {hasSuggestedBarcode ? <span className="product-form-hint">Código de barras sugerido visual: {barcodeSuggestion}. El definitivo se valida y genera en backend al guardar.</span> : null}
              </label>
            </div>
            <div className="product-form-subcard">
              {editingId ? (
                <>
                  <p className="product-form-hint">Imprime la etiqueta para pegarla en el producto.</p>
                  <div className="inline-actions">
                    <button
                      className="button ghost"
                      onClick={() => printBarcodeLabel().catch((printError) => setError(printError instanceof Error ? printError.message : "No fue posible imprimir el código de barras"))}
                      type="button"
                    >
                      Imprimir etiqueta
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="product-form-subcard-title">¿Tu producto no trae código?</p>
                  <p className="product-form-hint">Déjalo vacío y se genera uno al guardar. Después podrás imprimir la etiqueta para pegarla en el producto.</p>
                </>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="supplier"
            onToggle={toggleSection}
            open={openSections.supplier}
            summary="Nombre, WhatsApp, correo, teléfono y costo de compra."
            title="Proveedor"
          >
            <PrimarySupplierSection
              hideCosts={isCashier}
              form={form}
              suppliers={suppliers}
              supplierNameInputRef={supplierNameInputRef}
              openSuppliersModal={openSuppliersModal}
              resolveSupplierByName={resolveSupplierByName}
              updateSupplier={updateSupplier}
              removeExtraSupplier={(index) => setForm({ ...form, suppliers: form.suppliers.filter((_, supplierIndex) => supplierIndex !== index) })}
              loadSuppliers={loadSuppliers}
            />
          </CollapsibleSection>

          {showExpiryField ? (
            <CollapsibleSection
              id="expiry"
              onToggle={toggleSection}
              open={openSections.expiry}
              summary="Número de lote y fecha de caducidad."
              title="Lote y fecha de caducidad"
            >
              <label className="product-form-check-card">
                <input
                  checked={expiryEnabled}
                  onChange={(event) => {
                    setExpiryEnabled(event.target.checked);
                    if (!event.target.checked) {
                      setForm({ ...form, lot_number: "", expires_at: "" });
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>Este producto caduca</strong>
                  <span className="product-form-hint">Actívalo para llevar lote y fecha de caducidad.</span>
                </span>
              </label>
              {expiryEnabled ? (
                <>
                  <div className="product-form-grid-2">
                    <label className="product-form-field">
                      Número de lote
                      <input
                        placeholder="Opcional"
                        value={form.lot_number}
                        onChange={(event) => setForm({ ...form, lot_number: event.target.value })}
                      />
                    </label>
                    <label className="product-form-field">
                      Fecha de caducidad
                      <input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
                    </label>
                  </div>
                  <p className="product-form-hint">Se marca “Por caducar” 14 días antes.</p>
                </>
              ) : null}
            </CollapsibleSection>
          ) : null}

          {showIepsField ? (
            <CollapsibleSection
              id="ieps"
              onToggle={toggleSection}
              open={openSections.ieps}
              summary="Solo para productos que causan este impuesto."
              title="Impuestos (IEPS)"
            >
              <label className="product-form-check-card">
                <input
                  checked={appliesAutomaticIeps || iepsEnabled}
                  disabled={appliesAutomaticIeps}
                  onChange={(event) => {
                    setIepsEnabled(event.target.checked);
                    if (!event.target.checked) {
                      setForm({ ...form, ieps: "" });
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>Este producto paga IEPS</strong>
                  <span className="product-form-hint">Solo para productos que causan este impuesto.</span>
                </span>
              </label>
              {appliesAutomaticIeps || iepsEnabled ? (
                <div className="product-form-grid-2">
                  <label className="product-form-field">
                    IEPS
                    <span className="product-form-affix product-form-affix-suffix">
                      <input placeholder="Escribe el porcentaje" readOnly={appliesAutomaticIeps} type="number" min="0" step="0.01" value={form.ieps} onChange={(event) => setForm({ ...form, ieps: event.target.value })} />
                      <span aria-hidden="true" className="product-form-affix-symbol">%</span>
                    </span>
                    <span className="product-form-hint">Si tienes dudas de cuánto aplica, confírmalo con tu contador.</span>
                    {appliesAutomaticIeps ? <span className="product-form-hint">IEPS automático fijo en 8% para esta categoría.</span> : null}
                  </label>
                </div>
              ) : null}
            </CollapsibleSection>
          ) : null}

          <CollapsibleSection
            id="details"
            onToggle={toggleSection}
            open={openSections.details}
            summary={`Estado actual: ${form.status === "inactivo" ? "Inactivo" : "Activo"}.`}
            title="Descripción y estado"
          >
            <label className="product-form-field">
              Descripción
              <textarea placeholder="Opcional" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label className="product-form-field">
              Estado
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "activo" | "inactivo", is_active: event.target.value === "activo" })}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
          </CollapsibleSection>
        </div>

        <aside className={`product-form-aside${isMobile ? " product-form-mobile-bar" : ""}`}>
          {isMobile ? (
            // Movil: barra fija inferior (no sticky: .app-main tiene overflow-x:hidden y eso
            // impide que position:sticky se pegue al viewport). Sin vista previa ni checklist.
            <>
              {error ? <p className="error-text">{error}</p> : null}
              {info ? <p className="success-text">{info}</p> : null}
              <div aria-live="polite" className="product-form-mobile-bar-summary">
                <span className={`product-form-mobile-bar-count${essentialsDone === essentials.length ? " is-complete" : ""}`}>
                  {essentialsDone} de {essentials.length} datos esenciales
                </span>
                {!isCashier && profit !== null ? (
                  <span className={`product-form-mobile-bar-profit${profit < 0 ? " is-negative" : ""}`}>Ganas {profitLabel} por pieza</span>
                ) : null}
              </div>
              <div className="product-form-actions">
                <button className="button" disabled={saving} type="submit">
                  {saving ? "Guardando..." : isCashier ? "Enviar solicitud" : editingId ? "Actualizar producto" : "Guardar producto"}
                </button>
                {editingId ? (
                  <button className="button ghost product-form-cancel" onClick={resetProductEditor} type="button">
                    Cancelar
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="product-form-card product-form-summary">
              <p className="product-form-summary-label">Así se verá al vender</p>
              <div className="product-form-preview">
                <strong className={hasText(form.name) ? "" : "muted"}>{hasText(form.name) ? form.name : "Nombre del producto"}</strong>
                <span className="product-form-hint">{previewMeta}</span>
                <span className="product-form-preview-price">{currency(form.price || 0)}</span>
              </div>
              <div className="product-form-essentials-head">
                <strong>Datos esenciales</strong>
                <span className={essentialsDone === essentials.length ? "product-form-essentials-count is-complete" : "product-form-essentials-count"}>
                  {essentialsDone} de {essentials.length}
                </span>
              </div>
              <div aria-hidden="true" className="product-form-progress">
                <div className="product-form-progress-fill" style={{ width: `${essentialsPercent}%` }} />
              </div>
              <ul className="product-form-essentials">
                {essentials.map((item) => (
                  <li className={item.done ? "is-done" : ""} key={item.label}>
                    <span aria-hidden="true" className="product-form-essentials-mark">{item.done ? "✓" : ""}</span>
                    <span>{item.label}</span>
                    <span className="product-form-sr-only">{item.done ? " (listo)" : " (pendiente)"}</span>
                  </li>
                ))}
              </ul>
              {!isCashier ? (
                <div className={`product-form-profit-box${profit !== null && profit < 0 ? " is-negative" : ""}`}>
                  <span>Ganas por pieza</span>
                  <strong>{profitLabel}</strong>
                </div>
              ) : null}
              {error ? <p className="error-text">{error}</p> : null}
              {info ? <p className="success-text">{info}</p> : null}
              <div className="product-form-actions">
                <button className="button" disabled={saving} type="submit">
                  {saving ? "Guardando..." : isCashier ? "Enviar solicitud" : editingId ? "Actualizar producto" : "Guardar producto"}
                </button>
                {editingId ? (
                  <button className="button ghost product-form-cancel" onClick={resetProductEditor} type="button">
                    Cancelar
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </aside>
      </div>
    </form>
  );
}
