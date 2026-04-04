import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalAppointment, ClinicalPatientSummary } from "../types";
import { shortDate } from "../utils/format";

type AppointmentFormState = {
  patient_id: string;
  client_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  area: "CLINICA" | "ESTETICA";
  status: ClinicalAppointment["status"];
  notes: string;
};

const emptyForm: AppointmentFormState = {
  patient_id: "",
  client_id: "",
  appointment_date: new Date().toISOString().slice(0, 10),
  start_time: "",
  end_time: "",
  area: "CLINICA",
  status: "scheduled",
  notes: ""
};

function appointmentToForm(appointment: ClinicalAppointment | null): AppointmentFormState {
  return {
    patient_id: appointment?.patient_id ? String(appointment.patient_id) : "",
    client_id: appointment?.client_id ? String(appointment.client_id) : "",
    appointment_date: appointment?.appointment_date || new Date().toISOString().slice(0, 10),
    start_time: appointment?.start_time?.slice(0, 5) || "",
    end_time: appointment?.end_time?.slice(0, 5) || "",
    area: appointment?.area || "CLINICA",
    status: appointment?.status || "scheduled",
    notes: appointment?.notes || ""
  };
}

export function MedicalAppointmentsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [appointments, setAppointments] = useState<ClinicalAppointment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalAppointment | null>(null);
  const [form, setForm] = useState<AppointmentFormState>({
    ...emptyForm,
    appointment_date: searchParams.get("date") || emptyForm.appointment_date
  });
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [dateFilter, setDateFilter] = useState(searchParams.get("date") || emptyForm.appointment_date);
  const [areaFilter, setAreaFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function loadPatients() {
    if (!token) return;
    const response = await apiRequest<ClinicalPatientSummary[]>("/patients?active=true", { token });
    setPatients(response);
  }

  async function loadAppointments() {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("date", dateFilter);
    if (areaFilter) params.set("area", areaFilter);
    const response = await apiRequest<{ date: string; items: ClinicalAppointment[] }>(`/medical-appointments?${params.toString()}`, { token });
    setAppointments(response.items);
    setSelectedId((current) => {
      const queryId = Number(searchParams.get("appointment") || 0) || null;
      const nextId = current ?? queryId ?? response.items[0]?.id ?? null;
      return response.items.some((item) => item.id === nextId) ? nextId : response.items[0]?.id ?? null;
    });
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalAppointment>(`/medical-appointments/${id}`, { token });
    setDetail(response);
    if (mode === "edit") {
      setForm(appointmentToForm(response));
    }
  }

  useEffect(() => {
    loadPatients().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar pacientes");
    });
  }, [token]);

  useEffect(() => {
    loadAppointments().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar citas");
    });
  }, [token, dateFilter, areaFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setSearchParams((current) => {
      current.set("appointment", String(selectedId));
      current.set("date", dateFilter);
      return current;
    }, { replace: true });
    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la cita");
    });
  }, [selectedId, token, dateFilter]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setForm({ ...emptyForm, appointment_date: dateFilter });
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(appointmentToForm(detail));
  }

  function handlePatientChange(patientId: string) {
    const selectedPatient = patients.find((patient) => String(patient.id) === patientId);
    setForm((current) => ({
      ...current,
      patient_id: patientId,
      client_id: selectedPatient ? String(selectedPatient.client_id) : ""
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      resetFeedback();
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/medical-appointments/${selectedId}` : "/medical-appointments";
      await apiRequest<ClinicalAppointment>(path, {
        method,
        token,
        body: JSON.stringify({
          ...form,
          patient_id: Number(form.patient_id),
          client_id: Number(form.client_id)
        })
      });
      setInfo(mode === "edit" ? "Cita actualizada" : "Cita creada");
      await loadAppointments();
      if (mode === "edit" && selectedId) {
        await loadDetail(selectedId);
      } else {
        startCreate();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la cita");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Agenda diaria</h2>
            <p className="muted">Timeline diario con bloqueo de traslapes solo dentro de la misma area.</p>
          </div>
          <button className="button" onClick={startCreate} type="button">Nueva cita</button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="form-section-grid">
          <label>
            Fecha
            <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
          </label>
          <label>
            Area
            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
              <option value="">Todas</option>
              <option value="CLINICA">Clinica</option>
              <option value="ESTETICA">Estetica</option>
            </select>
          </label>
        </div>
        <div className="timeline-list">
          {appointments.map((appointment) => (
            <button className={`timeline-card ${appointment.id === selectedId ? "timeline-card-active" : ""}`} key={appointment.id} onClick={() => setSelectedId(appointment.id)} type="button">
              <div className="panel-header">
                <strong>{appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</strong>
                <span className={`status-badge appointment-status-${appointment.status}`}>{appointment.status}</span>
              </div>
              <div>{appointment.patient_name}</div>
              <div className="muted">{appointment.client_name} · {appointment.area}</div>
            </button>
          ))}
          {!appointments.length ? (
            <div className="empty-state-card">
              <strong>Sin citas para {shortDate(dateFilter)}.</strong>
              <span className="muted">Crea la primera cita del dia desde el panel derecho.</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? "Editar cita" : "Nueva cita"}</h2>
            <p className="muted">Permite traslapes entre areas distintas; el backend bloquea solo la misma area.</p>
          </div>
          {detail ? <button className="button ghost" onClick={startEdit} type="button">Editar</button> : null}
        </div>
        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Paciente *
            <select value={form.patient_id} onChange={(event) => handlePatientChange(event.target.value)}>
              <option value="">Selecciona un paciente</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.client_name}</option>)}
            </select>
          </label>
          <label>
            Cliente
            <input disabled value={patients.find((patient) => String(patient.id) === form.patient_id)?.client_name || ""} />
          </label>
          <label>
            Fecha *
            <input type="date" value={form.appointment_date} onChange={(event) => setForm({ ...form, appointment_date: event.target.value })} />
          </label>
          <label>
            Hora inicio *
            <input type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
          </label>
          <label>
            Hora fin *
            <input type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
          </label>
          <label>
            Area *
            <select value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value as AppointmentFormState["area"] })}>
              <option value="CLINICA">Clinica</option>
              <option value="ESTETICA">Estetica</option>
            </select>
          </label>
          <label>
            Estado *
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as AppointmentFormState["status"] })}>
              <option value="scheduled">Programada</option>
              <option value="confirmed">Confirmada</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
              <option value="no_show">No asistio</option>
            </select>
          </label>
          <label>
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Guardar cita"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={startCreate} type="button">Cancelar edicion</button> : null}
          </div>
        </form>

        {detail ? (
          <div className="info-card">
            <p><strong>Paciente:</strong> {detail.patient_name}</p>
            <p><strong>Cliente:</strong> {detail.client_name}</p>
            <p><strong>Fecha:</strong> {shortDate(detail.appointment_date)}</p>
            <p><strong>Horario:</strong> {detail.start_time.slice(0, 5)} - {detail.end_time.slice(0, 5)}</p>
            <p><strong>Area:</strong> {detail.area}</p>
            <p><strong>Estado:</strong> {detail.status}</p>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)} type="button">Ver paciente</button>
              <button className="button ghost" onClick={() => navigate(`/clients?client=${detail.client_id}`)} type="button">Ver cliente</button>
            </div>
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona una cita o crea una nueva.</strong>
            <span className="muted">La agenda diaria se mantiene filtrada por fecha.</span>
          </div>
        )}
      </div>
    </section>
  );
}
