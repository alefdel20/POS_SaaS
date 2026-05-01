import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";

type Branch = {
  id: number;
  name: string;
  pos_type: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  is_default: boolean;
  is_editing?: boolean;
};

const POS_TYPE_OPTIONS = [
  "Tienda",
  "Tlapaleria",
  "Papeleria",
  "Farmacia",
  "FarmaciaConsultorio",
  "Veterinaria",
  "Dentista",
  "ClinicaChica",
  "Restaurante",
  "Otro"
];

const emptyForm = {
  name: "",
  pos_type: "Tienda",
  address: "",
  phone: ""
};

export function BranchesPage() {
  const { token } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingBranch, setEditingBranch] = useState<{
    id: number; name: string; pos_type: string; address: string; phone: string;
  } | null>(null);

  function loadBranches() {
    if (!token) return;
    apiRequest<Branch[] | { branches?: Branch[]; data?: Branch[] }>("/branches", { token })
      .then((data) => setBranches(Array.isArray(data) ? data : data.branches ?? data.data ?? []))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las sucursales");
      });
  }

  useEffect(() => {
    loadBranches();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSubmitting(true);
      setError("");
      setInfo("");
      await apiRequest<Branch>("/branches", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: form.name,
          pos_type: form.pos_type,
          address: form.address || null,
          phone: form.phone || null
        })
      });
      setForm(emptyForm);
      setShowForm(false);
      setInfo("Sucursal creada correctamente");
      loadBranches();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "No fue posible crear la sucursal";
      if (message.includes("403") || message.toLowerCase().includes("plan") || message.toLowerCase().includes("límite") || message.toLowerCase().includes("limite")) {
        setError("Tu plan actual no permite agregar más sucursales. Escríbenos a ankodemx@gmail.com para ampliar tu plan.");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateBranch(event: FormEvent) {
    event.preventDefault();
    if (!editingBranch || !token) return;
    try {
      await apiRequest(`/branches/${editingBranch.id}`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          name: editingBranch.name,
          pos_type: editingBranch.pos_type,
          address: editingBranch.address,
          phone: editingBranch.phone,
        }),
      });
      setEditingBranch(null);
      loadBranches();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Error al actualizar la sucursal");
    }
  }

  async function deactivateBranch(branch: Branch) {
    if (!token) return;

    try {
      setError("");
      setInfo("");
      await apiRequest(`/branches/${branch.id}`, {
        method: "DELETE",
        token
      });
      setInfo(`Sucursal "${branch.name}" desactivada`);
      loadBranches();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible desactivar la sucursal");
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Sucursales</h2>
            <p className="muted">Administra las sucursales de tu negocio.</p>
          </div>
          {!showForm ? (
            <button className="button" onClick={() => { setShowForm(true); setError(""); setInfo(""); }} type="button">
              Nueva sucursal
            </button>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}

        {showForm ? (
          <form className="grid-form" onSubmit={handleSubmit}>
            <div className="panel-header">
              <h3>Nueva sucursal</h3>
              <button className="button ghost" onClick={() => { setShowForm(false); setForm(emptyForm); setError(""); }} type="button">
                Cancelar
              </button>
            </div>
            <label>
              Nombre *
              <input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              Tipo de POS *
              <select
                value={form.pos_type}
                onChange={(event) => setForm({ ...form, pos_type: event.target.value })}
              >
                {POS_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Dirección
              <input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </label>
            <label>
              Teléfono
              <input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <button className="button" disabled={submitting} type="submit">
              {submitting ? "Creando..." : "Crear sucursal"}
            </button>
          </form>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo de POS</th>
                <th>Estado</th>
                <th>Predeterminada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.pos_type}</td>
                  <td>{branch.is_active ? "Activa" : "Inactiva"}</td>
                  <td>
                    {branch.is_default ? (
                      <span className="badge">Principal</span>
                    ) : "-"}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button
                        className="button ghost"
                        onClick={() => setEditingBranch({
                          id: branch.id,
                          name: branch.name,
                          pos_type: branch.pos_type,
                          address: branch.address ?? "",
                          phone: branch.phone ?? ""
                        })}
                        type="button"
                      >
                        Editar
                      </button>
                      {!branch.is_default ? (
                        <button
                          className="button ghost"
                          onClick={() => deactivateBranch(branch)}
                          type="button"
                        >
                          Desactivar
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {branches.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <p className="muted">No hay sucursales registradas.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {editingBranch !== null ? (
          <form onSubmit={handleUpdateBranch} className="panel grid-form" style={{ marginTop: "1rem" }}>
            <div className="panel-header">
              <h3>Editar sucursal</h3>
              <button type="button" className="button ghost" onClick={() => setEditingBranch(null)}>Cancelar</button>
            </div>
            <label>
              Nombre *
              <input required value={editingBranch.name}
                onChange={(e) => setEditingBranch({ ...editingBranch, name: e.target.value })} />
            </label>
            <label>
              Tipo de POS *
              <select value={editingBranch.pos_type}
                onChange={(e) => setEditingBranch({ ...editingBranch, pos_type: e.target.value })}>
                {POS_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label>
              Dirección
              <input value={editingBranch.address}
                onChange={(e) => setEditingBranch({ ...editingBranch, address: e.target.value })} />
            </label>
            <label>
              Teléfono
              <input value={editingBranch.phone}
                onChange={(e) => setEditingBranch({ ...editingBranch, phone: e.target.value })} />
            </label>
            <button type="submit" className="button">Guardar cambios</button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
