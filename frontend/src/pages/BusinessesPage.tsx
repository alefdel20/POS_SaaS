import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Business, PosType } from "../types";
import { POS_TYPE_OPTIONS, getPosTypeLabel } from "../utils/pos";

const emptyForm = {
  name: "",
  slug: "",
  pos_type: "Tienda" as PosType
};

export function BusinessesPage() {
  const { token } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function loadBusinesses() {
    if (!token) return;
    try {
      setBusinesses(await apiRequest<Business[]>("/businesses", { token }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar negocios");
    }
  }

  useEffect(() => {
    loadBusinesses();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    try {
      setError("");
      await apiRequest<Business>("/businesses", {
        method: "POST",
        token,
        body: JSON.stringify(form)
      });
      setForm(emptyForm);
      await loadBusinesses();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible crear el negocio");
    }
  }

  return (
    <section className="page-grid two-columns">
      <form className="panel grid-form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>Nuevo negocio</h2>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <label>
          Nombre *
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          Slug
          <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="opcional" />
        </label>
        <label>
          Tipo de POS *
          <select value={form.pos_type} onChange={(event) => setForm({ ...form, pos_type: event.target.value as PosType })}>
            {POS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className="button" type="submit">Crear negocio</button>
      </form>

      <div className="panel form-span-2">
        <div className="panel-header">
          <div>
            <h2>Negocios</h2>
            <p className="muted">Cada alta crea su usuario de soporte y perfil comercial por defecto.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Slug</th>
                <th>Tipo POS</th>
                <th>Usuarios</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.id}>
                  <td>{business.name}</td>
                  <td>{business.slug}</td>
                  <td>{getPosTypeLabel(business.pos_type)}</td>
                  <td>{business.user_count ?? 0}</td>
                  <td>{business.is_active ? "Activo" : "Inactivo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
