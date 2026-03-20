import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { SupplierDetail } from "../types";
import { currency, shortDateTime } from "../utils/format";

type SupplierSummary = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  observations?: string | null;
  product_count: number;
};

export function SuppliersPage() {
  const { token } = useAuth();
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierDetail | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function loadSuppliers(term = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<SupplierSummary[]>(`/suppliers?${params.toString()}`, { token });
    setSuppliers(response);
    setSelectedSupplierId((current) => current ?? response[0]?.id ?? null);
  }

  async function loadSupplierDetail(supplierId: number) {
    if (!token) return;
    const response = await apiRequest<SupplierDetail>(`/suppliers/${supplierId}`, { token });
    setSelectedSupplier(response);
  }

  useEffect(() => {
    loadSuppliers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar proveedores");
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadSuppliers(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar proveedores");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, token]);

  useEffect(() => {
    if (!selectedSupplierId) {
      setSelectedSupplier(null);
      return;
    }

    loadSupplierDetail(selectedSupplierId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el detalle del proveedor");
    });
  }, [selectedSupplierId, token]);

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Proveedores</h2>
            <p className="muted">Consulta general de proveedores registrados y sus productos asociados.</p>
          </div>
          <input
            className="search-input"
            placeholder="Buscar proveedor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Contacto</th>
                <th>Productos</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr
                  className={supplier.id === selectedSupplierId ? "table-row-active" : ""}
                  key={supplier.id}
                  onClick={() => setSelectedSupplierId(supplier.id)}
                >
                  <td>{supplier.name}</td>
                  <td>{supplier.whatsapp || supplier.phone || supplier.email || "-"}</td>
                  <td>{supplier.product_count}</td>
                </tr>
              ))}
              {suppliers.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={3}>No hay proveedores registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{selectedSupplier?.name || "Detalle del proveedor"}</h2>
            <p className="muted">Compara productos por SKU, costo de compra y actualización más reciente.</p>
          </div>
        </div>
        {selectedSupplier ? (
          <>
            <div className="info-card">
              <p>Correo: {selectedSupplier.email || "-"}</p>
              <p>Teléfono: {selectedSupplier.phone || "-"}</p>
              <p>WhatsApp: {selectedSupplier.whatsapp || "-"}</p>
              <p>Observaciones: {selectedSupplier.observations || "-"}</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th>Costo de compra</th>
                    <th>Actualización costo</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSupplier.products.map((product) => (
                    <tr key={`${selectedSupplier.id}-${product.product_id}`}>
                      <td>{product.product_name}</td>
                      <td>{product.sku}</td>
                      <td>{currency(product.purchase_cost)}</td>
                      <td>{shortDateTime(product.cost_updated_at || product.product_updated_at)}</td>
                    </tr>
                  ))}
                  {selectedSupplier.products.length === 0 ? (
                    <tr>
                      <td className="muted" colSpan={4}>Este proveedor aún no tiene productos asociados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">Selecciona un proveedor para ver sus productos asociados.</p>
        )}
      </div>
    </section>
  );
}
