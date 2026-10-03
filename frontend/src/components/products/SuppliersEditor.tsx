import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Supplier } from "../../types";
import { currency, shortDateTime } from "../../utils/format";
import { emptySupplier, type ProductFormState, type ProductSupplierFormState } from "./productFormTypes";

type SupplierHandlers = {
  resolveSupplierByName: (name: string) => Supplier | null;
  loadSuppliers: (searchTerm?: string) => Promise<void>;
};

type PrimarySupplierSectionProps = SupplierHandlers & {
  form: Pick<ProductFormState, "suppliers">;
  suppliers: Supplier[];
  supplierNameInputRef: RefObject<HTMLInputElement | null>;
  openSuppliersModal: () => void;
  updateSupplier: (index: number, nextSupplier: ProductSupplierFormState) => void;
  removeExtraSupplier: (index: number) => void;
  // Cajero: sin costo de compra ni fecha de actualizacion de costo.
  hideCosts?: boolean;
};

// Proveedor principal + resumen de los extra: vive dentro del <form> del producto.
// Los extra se siguen editando en ExtraSuppliersModal; aqui solo se listan.
export function PrimarySupplierSection({
  form,
  suppliers,
  supplierNameInputRef,
  openSuppliersModal,
  resolveSupplierByName,
  updateSupplier,
  removeExtraSupplier,
  loadSuppliers,
  hideCosts = false
}: PrimarySupplierSectionProps) {
  const extraSuppliers = form.suppliers
    .map((supplier, index) => ({ supplier, index }))
    .slice(1);

  return (
    <>
      <p className="product-form-hint">El proveedor principal siempre se ve. Agrega otros si le compras a más de uno.</p>
      <div className="product-form-subcard">
        <p className="product-form-subcard-title">Proveedor principal</p>
        <div className="product-form-grid-2">
          <label className="product-form-field">
            Nombre del proveedor
            <input
              ref={supplierNameInputRef}
              list="supplier-options"
              value={form.suppliers[0]?.supplier_name || ""}
              onChange={(event) => {
                const value = event.target.value;
                const matchedSupplier = resolveSupplierByName(value);
                updateSupplier(0, {
                  supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                  supplier_name: value,
                  supplier_email: matchedSupplier?.email || "",
                  supplier_phone: matchedSupplier?.phone || "",
                  supplier_whatsapp: matchedSupplier?.whatsapp || "",
                  supplier_observations: matchedSupplier?.observations || "",
                  purchase_cost: form.suppliers[0]?.purchase_cost || "",
                  cost_updated_at: form.suppliers[0]?.cost_updated_at || null
                });
                loadSuppliers(value).catch(console.error);
              }}
              placeholder="Selecciona o escribe un proveedor"
            />
          </label>
          {!hideCosts ? (
            <label className="product-form-field">
              Costo de compra
              <span className="product-form-affix">
                <span aria-hidden="true" className="product-form-affix-symbol">$</span>
                <input
                  min="0"
                  step="0.00001"
                  type="number"
                  value={form.suppliers[0]?.purchase_cost || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), purchase_cost: event.target.value })}
                />
              </span>
            </label>
          ) : null}
          <label className="product-form-field">
            WhatsApp
            <input
              placeholder="Ej. 55 1234 5678"
              value={form.suppliers[0]?.supplier_whatsapp || ""}
              onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_whatsapp: event.target.value })}
            />
          </label>
          <label className="product-form-field">
            Teléfono
            <input
              placeholder="Opcional"
              value={form.suppliers[0]?.supplier_phone || ""}
              onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_phone: event.target.value })}
            />
          </label>
          <label className="product-form-field product-form-span-all">
            Correo
            <input
              placeholder="Opcional"
              type="email"
              value={form.suppliers[0]?.supplier_email || ""}
              onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_email: event.target.value })}
            />
          </label>
          <label className="product-form-field product-form-span-all">
            Observaciones
            <textarea
              placeholder="Ej. Entrega los martes. Pedido mínimo de 10 piezas."
              value={form.suppliers[0]?.supplier_observations || ""}
              onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_observations: event.target.value })}
            />
          </label>
          {!hideCosts && form.suppliers[0]?.cost_updated_at ? (
            <p className="muted product-form-span-all">
              Última actualización de costo: {shortDateTime(form.suppliers[0]?.cost_updated_at)}
            </p>
          ) : null}
        </div>
        <datalist id="supplier-options">
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.name} />
          ))}
        </datalist>
      </div>

      {extraSuppliers.length > 0 ? (
        <div className="product-form-extra-suppliers">
          <p className="product-form-subcard-title">
            Otros proveedores <span className="muted">({extraSuppliers.length})</span>
          </p>
          {extraSuppliers.map(({ supplier, index }) => (
            <div className="product-form-extra-supplier" key={`extra-supplier-${index}`}>
              <div className="product-form-extra-supplier-info">
                <strong>{supplier.supplier_name || "Proveedor sin nombre"}</strong>
                {!hideCosts && supplier.purchase_cost ? (
                  <span className="muted">Costo de compra {currency(supplier.purchase_cost)}</span>
                ) : null}
              </div>
              <div className="inline-actions">
                <button className="button ghost" onClick={openSuppliersModal} type="button">Editar</button>
                <button className="button ghost danger" onClick={() => removeExtraSupplier(index)} type="button">Quitar</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <button className="button ghost product-form-add-supplier" onClick={openSuppliersModal} type="button">
        + Agregar otro proveedor
      </button>
    </>
  );
}

type ExtraSuppliersModalProps = SupplierHandlers & {
  supplierDrafts: ProductSupplierFormState[];
  setSupplierDrafts: Dispatch<SetStateAction<ProductSupplierFormState[]>>;
  updateSupplierDraft: (index: number, nextSupplier: ProductSupplierFormState) => void;
  closeSuppliersModal: () => void;
  saveSuppliersModal: () => void;
  // Cajero: sin costo de compra ni fecha de actualizacion de costo.
  hideCosts?: boolean;
};

// Proveedores adicionales: se renderiza fuera del <form> (igual que antes) para que
// Enter dentro de la ventana no dispare el submit ni el salto de foco del formulario.
export function ExtraSuppliersModal({
  supplierDrafts,
  setSupplierDrafts,
  updateSupplierDraft,
  closeSuppliersModal,
  saveSuppliersModal,
  resolveSupplierByName,
  loadSuppliers,
  hideCosts = false
}: ExtraSuppliersModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card supplier-modal-card product-form-mobile-modal">
        <div className="panel-header product-form-mobile-modal-header">
          <div>
            <h3>Proveedores adicionales</h3>
            <p className="muted">Agrega o edita proveedores extra sin saturar la vista principal.</p>
          </div>
          <button className="button ghost" onClick={closeSuppliersModal} type="button">Cerrar</button>
        </div>
        <div className="inline-actions supplier-modal-actions">
          <button
            className="button ghost"
            onClick={() => setSupplierDrafts((current) => [...current, { ...emptySupplier }])}
            type="button"
          >
            Agregar proveedor
          </button>
        </div>
        <div className="supplier-modal-list">
          {supplierDrafts.length === 0 ? (
            <p className="muted">Aún no hay proveedores adicionales configurados.</p>
          ) : null}
          {supplierDrafts.map((supplier, index) => (
            <div className="info-card" key={`supplier-draft-${index}`}>
              <div className="panel-header">
                <div>
                  <h3>{`Proveedor ${index + 2}`}</h3>
                </div>
                <button
                  className="button ghost"
                  onClick={() => setSupplierDrafts((current) => current.filter((_, supplierIndex) => supplierIndex !== index))}
                  type="button"
                >
                  Quitar
                </button>
              </div>
              <div className="product-form-grid product-form-grid-wide">
                <label>
                  Nombre proveedor
                  <input
                    list="supplier-options"
                    value={supplier.supplier_name}
                    onChange={(event) => {
                      const value = event.target.value;
                      const matchedSupplier = resolveSupplierByName(value);
                      updateSupplierDraft(index, {
                        supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                        supplier_name: value,
                        supplier_email: matchedSupplier?.email || "",
                        supplier_phone: matchedSupplier?.phone || "",
                        supplier_whatsapp: matchedSupplier?.whatsapp || "",
                        supplier_observations: matchedSupplier?.observations || "",
                        purchase_cost: supplier.purchase_cost,
                        cost_updated_at: supplier.cost_updated_at
                      });
                      loadSuppliers(value).catch(console.error);
                    }}
                    placeholder="Selecciona o escribe un proveedor"
                  />
                </label>
                <label>
                  WhatsApp proveedor
                  <input value={supplier.supplier_whatsapp} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_whatsapp: event.target.value })} />
                </label>
                <label>
                  Correo proveedor
                  <input type="email" value={supplier.supplier_email} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_email: event.target.value })} />
                </label>
                <label>
                  Teléfono proveedor
                  <input value={supplier.supplier_phone} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_phone: event.target.value })} />
                </label>
                {!hideCosts ? (
                  <label>
                    Costo de compra
                    <input
                      min="0"
                      step="0.00001"
                      type="number"
                      value={supplier.purchase_cost}
                      onChange={(event) => updateSupplierDraft(index, { ...supplier, purchase_cost: event.target.value })}
                    />
                  </label>
                ) : null}
                <label className="form-span-2">
                  Observaciones proveedor
                  <textarea value={supplier.supplier_observations} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_observations: event.target.value })} />
                </label>
                {!hideCosts && supplier.cost_updated_at ? (
                  <p className="muted form-span-2">
                    Última actualización de costo: {shortDateTime(supplier.cost_updated_at)}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="inline-actions supplier-modal-actions product-form-mobile-modal-actions">
          <button className="button ghost" onClick={closeSuppliersModal} type="button">Cancelar</button>
          <button className="button" onClick={saveSuppliersModal} type="button">Aplicar proveedores</button>
        </div>
      </div>
    </div>
  );
}
