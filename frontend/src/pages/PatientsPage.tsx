import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalClientSummary, ClinicalPatientDetail, ClinicalPatientSummary, MedicalPreventiveEvent, Product } from "../types";
import { PREVENTIVE_EVENT_STATUSES, PREVENTIVE_EVENT_TYPES } from "../utils/domainEnums";
import { getClinicalPatientLabel, showsPatientSpecies } from "../utils/pos";
import { shortDate, shortDateTime } from "../utils/format";

type PatientFormState = {
  client_id: string;
  name: string;
  species: string;
  breed: string;
  sex: string;
  birth_date: string;
  weight: string;
  allergies: string;
  notes: string;
  is_active: boolean;
};

type PreventiveFormState = {
  event_type: "vaccination" | "deworming";
  product_id: string;
  product_name_snapshot: string;
  dose: string;
  date_administered: string;
  next_due_date: string;
  status: "scheduled" | "completed" | "cancelled";
  notes: string;
};

const emptyForm: PatientFormState = {
  client_id: "",
  name: "",
  species: "",
  breed: "",
  sex: "",
  birth_date: "",
  weight: "",
  allergies: "",
  notes: "",
  is_active: true
};

const emptyPreventiveForm: PreventiveFormState = {
  event_type: "vaccination",
  product_id: "",
  product_name_snapshot: "",
  dose: "",
  date_administered: "",
  next_due_date: "",
  status: "completed",
  notes: ""
};

function detailToForm(detail: ClinicalPatientDetail | null): PatientFormState {
  return {
    client_id: detail?.client_id ? String(detail.client_id) : "",
    name: detail?.name || "",
    species: detail?.species || "",
    breed: detail?.breed || "",
    sex: detail?.sex || "",
    birth_date: detail?.birth_date || "",
    weight: detail?.weight === undefined || detail?.weight === null ? "" : String(detail.weight),
    allergies: detail?.allergies || "",
    notes: detail?.notes || "",
    is_active: detail?.is_active ?? true
  };
}

function buildClientSearchLabel(client: ClinicalClientSummary) {
  return client.phone ? `${client.name} - ${client.phone}` : client.name;
}

export function PatientsPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [clients, setClients] = useState<ClinicalClientSummary[]>([]);
  const [medications, setMedications] = useState<Product[]>([]);
  const [detail, setDetail] = useState<ClinicalPatientDetail | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<PatientFormState>(emptyForm);
  const [clientSearch, setClientSearch] = useState("");
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [preventiveForm, setPreventiveForm] = useState<PreventiveFormState>(emptyPreventiveForm);
  const [saving, setSaving] = useState(false);
  const [preventiveSaving, setPreventiveSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const patientLabel = getClinicalPatientLabel(user?.pos_type);
  const showSpecies = showsPatientSpecies(user?.pos_type);

  async function loadPatients(term = "") {
    if (!token) return;
    const response = await apiRequest<ClinicalPatientSummary[]>(`/patients?search=${encodeURIComponent(term)}`, { token });
    setPatients(response);
    setSelectedId((current) => {
      const queryId = Number(searchParams.get("patient") || 0) || null;
      const nextId = current ?? queryId ?? response[0]?.id ?? null;
      return response.some((item) => item.id === nextId) ? nextId : response[0]?.id ?? null;
    });
  }

  async function loadClients() {
    if (!token) return;
    const response = await apiRequest<ClinicalClientSummary[]>("/clients", { token });
    setClients(response.filter((client) => client.is_active));
  }

  async function loadMedications() {
    if (!token) return;
    const response = await apiRequest<{ items: Product[] }>("/products?catalog_scope=medications-supplies&page=1&pageSize=50", { token });
    setMedications(response.items);
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalPatientDetail>(`/patients/${id}`, { token });
    setDetail(response);
    if (mode === "edit") {
      setForm(detailToForm(response));
    }
  }

  useEffect(() => {
    loadClients().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar clientes");
    });
    loadMedications().catch(() => {
      setMedications([]);
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadPatients(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar pacientes");
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
      current.set("patient", String(selectedId));
      return current;
    }, { replace: true });

    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el paciente");
    });
  }, [selectedId, token]);

  useEffect(() => {
    if (!form.client_id) {
      setClientSearch("");
      return;
    }

    const selectedClient = clients.find((client) => String(client.id) === form.client_id);
    if (selectedClient) {
      setClientSearch(buildClientSearchLabel(selectedClient));
    }
  }, [form.client_id, clients]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setForm(emptyForm);
    setClientSearch("");
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(detailToForm(detail));
  }

  function handleClientSearchChange(value: string) {
    const matchedClient = clients.find((client) => buildClientSearchLabel(client).toLowerCase() === value.trim().toLowerCase());
    setClientSearch(value);
    setForm((current) => ({
      ...current,
      client_id: matchedClient ? String(matchedClient.id) : ""
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      resetFeedback();
      const payload = {
        ...form,
        client_id: Number(form.client_id),
        species: showSpecies ? form.species : "",
        breed: showSpecies ? form.breed : "",
        weight: form.weight ? Number(form.weight) : null,
        allergies: form.allergies,
        is_active: form.is_active
      };
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/patients/${selectedId}` : "/patients";
      await apiRequest<ClinicalPatientSummary>(path, {
        method,
        token,
        body: JSON.stringify(payload)
      });
      setInfo(mode === "edit" ? "Paciente actualizado" : "Paciente creado");
      await loadPatients(search);
      if (mode === "edit" && selectedId) {
        await loadDetail(selectedId);
      } else {
        setForm(emptyForm);
        setClientSearch("");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el paciente");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreventiveSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedId) return;

    try {
      setPreventiveSaving(true);
      resetFeedback();
      const matchedProduct = medications.find((item) => String(item.id) === preventiveForm.product_id);
      await apiRequest<MedicalPreventiveEvent>("/medical-preventive-events", {
        method: "POST",
        token,
        body: JSON.stringify({
          patient_id: selectedId,
          event_type: preventiveForm.event_type,
          product_id: preventiveForm.product_id ? Number(preventiveForm.product_id) : undefined,
          product_name_snapshot: preventiveForm.product_name_snapshot || matchedProduct?.name || "",
          dose: preventiveForm.dose,
          date_administered: preventiveForm.date_administered || undefined,
          next_due_date: preventiveForm.next_due_date || undefined,
          status: preventiveForm.status,
          notes: preventiveForm.notes
        })
      });
      setPreventiveForm(emptyPreventiveForm);
      setInfo("Evento preventivo guardado");
      await loadDetail(selectedId);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el evento preventivo");
    } finally {
      setPreventiveSaving(false);
    }
  }

  async function handleStatus(nextStatus: boolean) {
    if (!token || !selectedId) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ClinicalPatientSummary>(`/patients/${selectedId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: nextStatus })
      });
      setInfo(nextStatus ? "Paciente reactivado" : "Paciente desactivado");
      await Promise.all([loadPatients(search), loadDetail(selectedId)]);
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
            <h2>{patientLabel}</h2>
            <p className="muted">Busqueda por nombre, responsable y {showSpecies ? "especie/raza." : "datos clinicos base."}</p>
          </div>
          <div className="inline-actions">
            <input className="search-input" placeholder="Buscar paciente" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{patientLabel}</th>
                <th>Responsable</th>
                <th>{showSpecies ? "Especie / raza" : "Consultas"}</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr className={patient.id === selectedId ? "table-row-active" : ""} key={patient.id} onClick={() => setSelectedId(patient.id)}>
                  <td>{patient.name}</td>
                  <td>{patient.client_name}</td>
                  <td>{showSpecies ? `${patient.species || "-"} / ${patient.breed || "-"}` : patient.consultation_count}</td>
                  <td>{patient.is_active ? "Activo" : "Inactivo"}</td>
                </tr>
              ))}
              {!patients.length ? (
                <tr>
                  <td className="muted" colSpan={4}>Aun no hay pacientes registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? `Editar ${patientLabel.toLowerCase()}` : `Alta de ${patientLabel.toLowerCase()}`}</h2>
            <p className="muted">Vinculacion directa con cliente responsable y modulo clinico.</p>
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
            Responsable *
            <input
              list="patient-client-options"
              placeholder="Busca por nombre o telefono"
              value={clientSearch}
              onChange={(event) => handleClientSearchChange(event.target.value)}
            />
          </label>
          <datalist id="patient-client-options">
            {clients.map((client) => <option key={client.id} value={buildClientSearchLabel(client)} />)}
          </datalist>
          <label>
            Nombre *
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          {showSpecies ? (
            <>
              <label>
                Especie
                <input value={form.species} onChange={(event) => setForm({ ...form, species: event.target.value })} />
              </label>
              <label>
                Raza
                <input value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} />
              </label>
            </>
          ) : null}
          <label>
            Sexo
            <input value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })} />
          </label>
          <label>
            Fecha de nacimiento
            <input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} />
          </label>
          <label>
            Peso
            <input type="number" min="0" step="0.001" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} />
          </label>
          <label>
            Alergias
            <textarea value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} />
          </label>
          <label>
            Estado
            <select value={form.is_active ? "active" : "inactive"} onChange={(event) => setForm({ ...form, is_active: event.target.value === "active" })}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <label>
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Crear paciente"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={startCreate} type="button">Cancelar edicion</button> : null}
          </div>
        </form>

        {detail ? (
          <>
            <div className="info-card">
              <p><strong>Paciente:</strong> {detail.name}</p>
              <p><strong>Responsable:</strong> {detail.client_name}</p>
              <p><strong>Estado:</strong> {detail.is_active ? "Activo" : "Inactivo"}</p>
              <p><strong>Telefono responsable:</strong> {detail.client_phone || "-"}</p>
              <p><strong>Correo responsable:</strong> {detail.client_email || "-"}</p>
              <p><strong>Direccion responsable:</strong> {detail.client_address || "-"}</p>
              <p><strong>Sexo:</strong> {detail.sex || "-"}</p>
              <p><strong>Nacimiento:</strong> {shortDate(detail.birth_date || null)}</p>
              <p><strong>Peso:</strong> {detail.weight ?? "-"}</p>
              <p><strong>Alergias:</strong> {detail.allergies || "-"}</p>
              {showSpecies ? <p><strong>Especie / raza:</strong> {detail.species || "-"} / {detail.breed || "-"}</p> : null}
              <p><strong>Consultas:</strong> {detail.consultation_count}</p>
              <p><strong>Citas:</strong> {detail.appointment_count}</p>
              <p><strong>Notas:</strong> {detail.notes || "-"}</p>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ultimas consultas</th>
                    <th>Fecha</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.consultations.map((consultation) => (
                    <tr key={consultation.id}>
                      <td>{consultation.motivo_consulta}</td>
                      <td>{shortDateTime(consultation.consultation_date)}</td>
                      <td><button className="button ghost" onClick={() => navigate(`/medical-consultations?consultation=${consultation.id}`)} type="button">Ver consulta</button></td>
                    </tr>
                  ))}
                  {!detail.consultations.length ? (
                    <tr>
                      <td className="muted" colSpan={3}>Sin consultas registradas.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ultimas citas</th>
                    <th>Horario</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td>{shortDate(appointment.appointment_date)}</td>
                      <td>{appointment.start_time} - {appointment.end_time}</td>
                      <td><button className="button ghost" onClick={() => navigate(`/medical-appointments?appointment=${appointment.id}&date=${appointment.appointment_date}`)} type="button">Ver cita</button></td>
                    </tr>
                  ))}
                  {!detail.appointments.length ? (
                    <tr>
                      <td className="muted" colSpan={3}>Sin citas registradas.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Preventivos</th>
                    <th>Aplicada</th>
                    <th>Proxima</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.preventive_events?.map((item) => (
                    <tr key={item.id}>
                      <td>{item.event_type === "vaccination" ? "Vacuna" : "Desparasitacion"} · {item.product_name_snapshot || "-"}</td>
                      <td>{shortDate(item.date_administered || null)}</td>
                      <td>{shortDate(item.next_due_date || null)}</td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                  {!detail.preventive_events?.length ? (
                    <tr>
                      <td className="muted" colSpan={4}>Sin eventos preventivos registrados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <form className="grid-form" onSubmit={handlePreventiveSubmit}>
              <div className="panel-header">
                <div>
                  <h3>Registrar preventivo</h3>
                  <p className="muted">Vacunacion y desparasitacion se registran sin afectar inventario ni ventas.</p>
                </div>
              </div>
              <label>
                Tipo
                <select value={preventiveForm.event_type} onChange={(event) => setPreventiveForm({ ...preventiveForm, event_type: event.target.value as PreventiveFormState["event_type"] })}>
                  {PREVENTIVE_EVENT_TYPES.map((value) => <option key={value} value={value}>{value === "vaccination" ? "Vacunacion" : "Desparasitacion"}</option>)}
                </select>
              </label>
              <label>
                Producto
                <select value={preventiveForm.product_id} onChange={(event) => setPreventiveForm({ ...preventiveForm, product_id: event.target.value })}>
                  <option value="">Manual</option>
                  {medications.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label>
                Snapshot
                <input value={preventiveForm.product_name_snapshot} onChange={(event) => setPreventiveForm({ ...preventiveForm, product_name_snapshot: event.target.value })} />
              </label>
              <label>
                Dosis / aplicacion
                <input value={preventiveForm.dose} onChange={(event) => setPreventiveForm({ ...preventiveForm, dose: event.target.value })} />
              </label>
              <label>
                Fecha aplicada
                <input type="date" value={preventiveForm.date_administered} onChange={(event) => setPreventiveForm({ ...preventiveForm, date_administered: event.target.value })} />
              </label>
              <label>
                Proxima fecha
                <input type="date" value={preventiveForm.next_due_date} onChange={(event) => setPreventiveForm({ ...preventiveForm, next_due_date: event.target.value })} />
              </label>
              <label>
                Estado
                <select value={preventiveForm.status} onChange={(event) => setPreventiveForm({ ...preventiveForm, status: event.target.value as PreventiveFormState["status"] })}>
                  {PREVENTIVE_EVENT_STATUSES.map((value) => <option key={value} value={value}>{value === "scheduled" ? "Programado" : value === "completed" ? "Completado" : "Cancelado"}</option>)}
                </select>
              </label>
              <label>
                Notas
                <textarea value={preventiveForm.notes} onChange={(event) => setPreventiveForm({ ...preventiveForm, notes: event.target.value })} />
              </label>
              <div className="inline-actions">
                <button className="button" disabled={preventiveSaving} type="submit">{preventiveSaving ? "Guardando..." : "Guardar preventivo"}</button>
              </div>
            </form>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recetas</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.prescriptions?.map((prescription) => (
                    <tr key={prescription.id}>
                      <td>{prescription.items.map((item) => item.medication_name_snapshot).join(", ") || `Receta #${prescription.id}`}</td>
                      <td>{shortDateTime(prescription.created_at)}</td>
                      <td>{prescription.status}</td>
                      <td>
                        <button
                          className="button ghost"
                          disabled={!prescription.consultation_id}
                          onClick={() => navigate(`/medical-consultations?consultation=${prescription.consultation_id}`)}
                          type="button"
                        >
                          Ver consulta
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!detail.prescriptions?.length ? (
                    <tr>
                      <td className="muted" colSpan={4}>Sin recetas registradas.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona un paciente o crea uno nuevo.</strong>
            <span className="muted">La ficha del paciente centraliza consultas y agenda.</span>
          </div>
        )}
      </div>
    </section>
  );
}
