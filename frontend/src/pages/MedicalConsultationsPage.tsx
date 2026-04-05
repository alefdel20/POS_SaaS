import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalConsultation, ClinicalPatientSummary } from "../types";
import { shortDateTime } from "../utils/format";

type ConsultationFormState = {
  patient_id: string;
  client_id: string;
  consultation_date: string;
  motivo_consulta: string;
  diagnostico: string;
  tratamiento: string;
  notas: string;
};

const emptyForm: ConsultationFormState = {
  patient_id: "",
  client_id: "",
  consultation_date: "",
  motivo_consulta: "",
  diagnostico: "",
  tratamiento: "",
  notas: ""
};

function consultationToForm(consultation: ClinicalConsultation | null): ConsultationFormState {
  return {
    patient_id: consultation?.patient_id ? String(consultation.patient_id) : "",
    client_id: consultation?.client_id ? String(consultation.client_id) : "",
    consultation_date: consultation?.consultation_date ? consultation.consultation_date.slice(0, 16) : "",
    motivo_consulta: consultation?.motivo_consulta || "",
    diagnostico: consultation?.diagnostico || "",
    tratamiento: consultation?.tratamiento || "",
    notas: consultation?.notas || ""
  };
}

function buildPatientSearchLabel(patient: ClinicalPatientSummary) {
  return `${patient.name} - ${patient.client_name || "Sin cliente"}`;
}

export function MedicalConsultationsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [consultations, setConsultations] = useState<ClinicalConsultation[]>([]);
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalConsultation | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [form, setForm] = useState<ConsultationFormState>(emptyForm);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const selectedPatient = patients.find((patient) => String(patient.id) === form.patient_id) || null;
  const detailPatient = patients.find((patient) => patient.id === detail?.patient_id) || null;
  const visibleConsultations = search.trim() ? consultations : consultations.slice(0, 5);

  async function loadPatients() {
    if (!token) return;
    const response = await apiRequest<ClinicalPatientSummary[]>("/patients?active=true", { token });
    setPatients(response);
  }

  async function loadConsultations(term = "") {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation[]>(`/medical-consultations?search=${encodeURIComponent(term)}`, { token });
    setConsultations(response);
    setSelectedId((current) => {
      const queryId = Number(searchParams.get("consultation") || 0) || null;
      const nextId = current ?? queryId ?? response[0]?.id ?? null;
      return response.some((item) => item.id === nextId) ? nextId : response[0]?.id ?? null;
    });
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation>(`/medical-consultations/${id}`, { token });
    setDetail(response);
    if (mode === "edit") {
      setForm(consultationToForm(response));
    }
  }

  useEffect(() => {
    loadPatients().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar pacientes");
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadConsultations(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar consultas");
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
      current.set("consultation", String(selectedId));
      return current;
    }, { replace: true });
    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la consulta");
    });
  }, [selectedId, token]);

  useEffect(() => {
    if (!form.patient_id) {
      setPatientSearch("");
      return;
    }

    const matchedPatient = patients.find((patient) => String(patient.id) === form.patient_id);
    if (matchedPatient) {
      setPatientSearch(buildPatientSearchLabel(matchedPatient));
    }
  }, [form.patient_id, patients]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setForm({ ...emptyForm, consultation_date: new Date().toISOString().slice(0, 16) });
    setPatientSearch("");
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(consultationToForm(detail));
  }

  function handlePatientChange(patientId: string) {
    const matchedPatient = patients.find((patient) => String(patient.id) === patientId);
    setForm((current) => ({
      ...current,
      patient_id: patientId,
      client_id: matchedPatient ? String(matchedPatient.client_id) : ""
    }));
  }

  function handlePatientSearchChange(value: string) {
    const matchedPatient = patients.find((patient) => buildPatientSearchLabel(patient).toLowerCase() === value.trim().toLowerCase());
    setPatientSearch(value);
    handlePatientChange(matchedPatient ? String(matchedPatient.id) : "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      resetFeedback();
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/medical-consultations/${selectedId}` : "/medical-consultations";
      await apiRequest<ClinicalConsultation>(path, {
        method,
        token,
        body: JSON.stringify({
          ...form,
          patient_id: Number(form.patient_id),
          client_id: Number(form.client_id)
        })
      });
      setInfo(mode === "edit" ? "Consulta actualizada" : "Consulta guardada y agregada al historial");
      await loadConsultations(search);
      if (mode === "edit" && selectedId) {
        await loadDetail(selectedId);
      } else {
        startCreate();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la consulta");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(nextStatus: boolean) {
    if (!token || !selectedId) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ClinicalConsultation>(`/medical-consultations/${selectedId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: nextStatus })
      });
      setInfo(nextStatus ? "Consulta reactivada" : "Consulta desactivada");
      await Promise.all([loadConsultations(search), loadDetail(selectedId)]);
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
            <h2>Consultas medicas</h2>
            <p className="muted">Se muestran arriba las 5 mas recientes; la busqueda mantiene el listado completo.</p>
          </div>
          <div className="inline-actions">
            <input className="search-input" placeholder="Buscar paciente o diagnostico" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button className="button" onClick={startCreate} type="button">Nueva consulta</button>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {visibleConsultations.map((consultation) => (
                <tr className={consultation.id === selectedId ? "table-row-active" : ""} key={consultation.id} onClick={() => setSelectedId(consultation.id)}>
                  <td>{consultation.patient_name}</td>
                  <td>{consultation.client_name}</td>
                  <td>{shortDateTime(consultation.consultation_date)}</td>
                  <td>{consultation.motivo_consulta}</td>
                </tr>
              ))}
              {!visibleConsultations.length ? (
                <tr>
                  <td className="muted" colSpan={4}>Aun no hay consultas registradas.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? "Editar consulta" : "Nueva consulta"}</h2>
            <p className="muted">El historial clinico se deriva directamente de estas consultas.</p>
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
            Paciente *
            <input
              list="consultation-patient-options"
              placeholder="Busca paciente o responsable"
              value={patientSearch}
              onChange={(event) => handlePatientSearchChange(event.target.value)}
            />
          </label>
          <datalist id="consultation-patient-options">
            {patients.map((patient) => <option key={patient.id} value={buildPatientSearchLabel(patient)} />)}
          </datalist>
          <label>
            Cliente
            <input disabled value={patients.find((patient) => String(patient.id) === form.patient_id)?.client_name || ""} />
          </label>
          {selectedPatient ? (
            <div className="info-card form-span-2">
              <p><strong>Responsable:</strong> {selectedPatient.client_name || "-"}</p>
              <p><strong>Telefono:</strong> {selectedPatient.client_phone || "-"}</p>
              <p><strong>Correo:</strong> {selectedPatient.client_email || "-"}</p>
              <p><strong>Especie / raza:</strong> {selectedPatient.species || "-"} / {selectedPatient.breed || "-"}</p>
              <p><strong>Sexo:</strong> {selectedPatient.sex || "-"}</p>
              <p><strong>Nacimiento:</strong> {selectedPatient.birth_date || "-"}</p>
            </div>
          ) : null}
          <label>
            Fecha *
            <input type="datetime-local" value={form.consultation_date} onChange={(event) => setForm({ ...form, consultation_date: event.target.value })} />
          </label>
          <label>
            Motivo de consulta *
            <textarea value={form.motivo_consulta} onChange={(event) => setForm({ ...form, motivo_consulta: event.target.value })} />
          </label>
          <label>
            Diagnostico *
            <textarea value={form.diagnostico} onChange={(event) => setForm({ ...form, diagnostico: event.target.value })} />
          </label>
          <label>
            Tratamiento *
            <textarea value={form.tratamiento} onChange={(event) => setForm({ ...form, tratamiento: event.target.value })} />
          </label>
          <label>
            Notas
            <textarea value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Guardar consulta"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={startCreate} type="button">Cancelar edicion</button> : null}
          </div>
        </form>

        {detail ? (
          <div className="info-card">
            <p><strong>Paciente:</strong> {detail.patient_name}</p>
            <p><strong>Cliente:</strong> {detail.client_name}</p>
            <p><strong>Telefono:</strong> {detailPatient?.client_phone || "-"}</p>
            <p><strong>Correo:</strong> {detailPatient?.client_email || "-"}</p>
            <p><strong>Especie / raza:</strong> {detail.species || detailPatient?.species || "-"} / {detail.breed || detailPatient?.breed || "-"}</p>
            <p><strong>Sexo:</strong> {detailPatient?.sex || "-"}</p>
            <p><strong>Nacimiento:</strong> {detailPatient?.birth_date || "-"}</p>
            <p><strong>Fecha:</strong> {shortDateTime(detail.consultation_date)}</p>
            <p><strong>Motivo:</strong> {detail.motivo_consulta}</p>
            <p><strong>Diagnostico:</strong> {detail.diagnostico}</p>
            <p><strong>Tratamiento:</strong> {detail.tratamiento}</p>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/medical-history?patient_id=${detail.patient_id}&client_id=${detail.client_id}`)} type="button">Ver historial</button>
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)} type="button">Ver paciente</button>
              <button className="button ghost" onClick={() => navigate(`/clients?client=${detail.client_id}`)} type="button">Ver cliente</button>
            </div>
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona una consulta o crea una nueva.</strong>
            <span className="muted">Cada consulta alimenta automaticamente el historial clinico.</span>
          </div>
        )}
      </div>
    </section>
  );
}
