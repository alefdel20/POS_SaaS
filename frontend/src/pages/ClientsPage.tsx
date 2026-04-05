import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalClientDetail, ClinicalClientSummary } from "../types";
import { getClinicalClientLabel, getClinicalPatientLabel } from "../utils/pos";

type ClientFormState = {
  name: string;
  phone: string;
  email: string;
  tax_id: string;
  address: string;
  notes: string;
};

const emptyForm: ClientFormState = {
  name: "",
  phone: "",
  email: "",
  tax_id: "",
  address: "",
  notes: ""
};

function detailToForm(detail: ClinicalClientDetail | null): ClientFormState {
  return {
    name: detail?.name || "",
    phone: detail?.phone || "",
    email: detail?.email || "",
    tax_id: detail?.tax_id || "",
    address: detail?.address || "",
    notes: detail?.notes || ""
  };
}

export function ClientsPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<ClinicalClientSummary[]>([]);
  const [detail, setDetail] = useState<ClinicalClientDetail | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ClientFormState>(emptyForm);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const clientLabel = getClinicalClientLabel(user?.pos_type);
  const patientLabel = getClinicalPatientLabel(user?.pos_type);

  async function loadClients(term = "") {
    if (!token) return;
    setLoading(true);
    try {
      const response = await apiRequest<ClinicalClientSummary[]>(`/clients?search=${encodeURIComponent(term)}`, { token });
      setClients(response);
      setSelectedId((current) => {
        const queryId = Number(searchParams.get("client") || 0) || null;
        const nextId = current ?? queryId ?? response[0]?.id ?? null;
        return response.some((item) => item.id === nextId) ? nextId : response[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalClientDetail>(`/clients/${id}`, { token });
    setDetail(response);
    if (mode === "edit") {
      setForm(detailToForm(response));
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadClients(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar clientes");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [token, search]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    setSearchParams((current) => {
      current.set("client", String(selectedId));
      return current;
    }, { replace: true });

    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el detalle");
    });
  }, [selectedId, token]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setForm(emptyForm);
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(detailToForm(detail));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      resetFeedback();
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/clients/${selectedId}` : "/clients";
      await apiRequest<ClinicalClientSummary>(path, {
        method,
        token,
        body: JSON.stringify(form)
      });
      setInfo(mode === "edit" ? "Cliente actualizado" : "Cliente creado");
      await loadClients(search);
      if (mode === "create") {
        setForm(emptyForm);
      } else if (selectedId) {
        await loadDetail(selectedId);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el cliente");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(nextStatus: boolean) {
    if (!token || !selectedId) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ClinicalClientSummary>(`/clients/${selectedId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: nextStatus })
      });
      setInfo(nextStatus ? "Cliente reactivado" : "Cliente desactivado");
      await Promise.all([loadClients(search), loadDetail(selectedId)]);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "No fue posible actualizar el estado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{clientLabel}</h2>
            <p className="muted">Busqueda por nombre, telefono o email con relacion directa a {patientLabel.toLowerCase()}.</p>
          </div>
          <div className="inline-actions">
            <input className="search-input" placeholder="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>{patientLabel}</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr className={client.id === selectedId ? "table-row-active" : ""} key={client.id} onClick={() => setSelectedId(client.id)}>
                  <td>
                    <strong>{client.name}</strong>
                    <div className="muted">{client.email || "-"}</div>
                  </td>
                  <td>{client.phone || "-"}</td>
                  <td>{client.patient_count}</td>
                  <td>{client.is_active ? "Activo" : "Inactivo"}</td>
                </tr>
              ))}
              {!clients.length ? (
                <tr>
                  <td className="muted" colSpan={4}>{loading ? "Cargando..." : "Aun no hay clientes registrados."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? "Editar cliente" : "Alta de cliente"}</h2>
            <p className="muted">{mode === "edit" ? "Actualiza datos y estado del responsable." : "Crea un responsable y despues vincula sus pacientes."}</p>
          </div>
          {detail ? (
            <div className="inline-actions">
              <button className="button ghost" onClick={startEdit} type="button">Editar</button>
              <button className="button ghost" disabled={saving} onClick={() => handleStatus(!detail.is_active)} type="button">
                {detail.is_active ? "Desactivar" : "Reactivar"}
              </button>
            </div>
          ) : null}
        </div>

        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Nombre *
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Telefono
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            RFC / ID fiscal
            <input value={form.tax_id} onChange={(event) => setForm({ ...form, tax_id: event.target.value })} />
          </label>
          <label>
            Direccion
            <textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
          <label>
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Crear cliente"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={startCreate} type="button">Cancelar edicion</button> : null}
          </div>
        </form>

        {detail ? (
          <>
            <div className="info-card">
              <p><strong>Cliente:</strong> {detail.name}</p>
              <p><strong>Telefono:</strong> {detail.phone || "-"}</p>
              <p><strong>Email:</strong> {detail.email || "-"}</p>
              <p><strong>Direccion:</strong> {detail.address || "-"}</p>
              <p><strong>Estado:</strong> {detail.is_active ? "Activo" : "Inactivo"}</p>
            </div>

            <div className="panel-header clinical-subheader">
              <div>
                <h3>{patientLabel} relacionados</h3>
                <p className="muted">Desde aqui navegas directo a la ficha del paciente.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{patientLabel}</th>
                    <th>Consultas</th>
                    <th>Citas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.patients.map((patient) => (
                    <tr key={patient.id}>
                      <td>{patient.name}</td>
                      <td>{patient.consultation_count}</td>
                      <td>{patient.appointment_count}</td>
                      <td>
                        <button className="button ghost" onClick={() => navigate(`/patients?patient=${patient.id}`)} type="button">Ver paciente</button>
                      </td>
                    </tr>
                  ))}
                  {!detail.patients.length ? (
                    <tr>
                      <td className="muted" colSpan={4}>Este cliente todavia no tiene {patientLabel.toLowerCase()} vinculados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona un cliente o crea uno nuevo.</strong>
            <span className="muted">El flujo clinico parte de un cliente responsable antes de registrar pacientes.</span>
          </div>
        )}
      </div>
    </section>
  );
}
