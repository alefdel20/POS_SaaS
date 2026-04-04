import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ServiceCatalogItem } from "../types";
import { currency } from "../utils/format";

const emptyForm = {
  name: "",
  category: "Consulta general",
  description: "",
  price: ""
};

export function ServicesPage() {
  const { token } = useAuth();
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadServices() {
    if (!token) return;
    const response = await apiRequest<ServiceCatalogItem[]>("/services", { token });
    setServices(response);
  }

  useEffect(() => {
    loadServices().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar servicios");
    });
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const price = Number(form.price);

    if (!form.name.trim()) {
      setError("El nombre del servicio es obligatorio");
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      setError("El precio debe ser cero o mayor");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await apiRequest<ServiceCatalogItem>("/services", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim(),
          description: form.description.trim(),
          price
        })
      });
      setForm(emptyForm);
      await loadServices();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el servicio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Servicios</h2>
            <p className="muted">Catálogo base de servicios no inventariables. Estética vive aquí, no como menú lateral.</p>
          </div>
        </div>
        <div className="module-shell-grid">
          <div className="info-card">
            <h3>Servicios sugeridos</h3>
            <p>Estética</p>
            <p>Consulta general</p>
            <p>Vacunación</p>
            <p>Desparasitación</p>
          </div>
          <form className="info-card grid-form" onSubmit={handleSubmit}>
            <h3>Nuevo servicio</h3>
            <label>
              Nombre *
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Categoría
              <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            </label>
            <label>
              Descripción
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label>
              Precio
              <input min="0" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            <button className="button" disabled={saving} type="submit">
              {saving ? "Guardando..." : "Guardar servicio"}
            </button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Catálogo actual</h2>
            <p className="muted">Base mínima lista para crecer hacia venta de servicios y agenda clínica.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td>{service.name}</td>
                  <td>{service.category || "-"}</td>
                  <td>{currency(service.price)}</td>
                  <td>{service.is_active ? "Activo" : "Inactivo"}</td>
                </tr>
              ))}
              {services.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={4}>Aún no hay servicios registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
