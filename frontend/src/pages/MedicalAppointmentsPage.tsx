import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { PatientQuickCreateModal } from "../components/PatientQuickCreateModal";
import { useAuth } from "../context/AuthContext";
import type { ClinicalAppointment, ClinicalClientSummary, ClinicalPatientSummary, User } from "../types";
import { shortDate } from "../utils/format";
import { getAppointmentAreaFromPath } from "../utils/navigation";
import { hidesAesthetics, isPharmacyClinicPos } from "../utils/pos";

type SelectedPatientMeta = {
  id: number;
  name: string;
  client_id: number | null;
  client_name: string | null;
};

type AppointmentFormState = {
  patient_id: string;
  client_id: string;
  doctor_user_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  area: "CLINICA" | "ESTETICA";
  specialty: string;
  status: ClinicalAppointment["status"];
  notes: string;
};

const emptyForm: AppointmentFormState = {
  patient_id: "",
  client_id: "",
  doctor_user_id: "",
  appointment_date: new Date().toISOString().slice(0, 10),
  start_time: "",
  end_time: "",
  area: "CLINICA",
  specialty: "",
  status: "scheduled",
  notes: ""
};

function appointmentToForm(appointment: ClinicalAppointment | null): AppointmentFormState {
  return {
    patient_id: appointment?.patient_id ? String(appointment.patient_id) : "",
    client_id: appointment?.client_id ? String(appointment.client_id) : "",
    doctor_user_id: appointment?.doctor_user_id ? String(appointment.doctor_user_id) : "",
    appointment_date: appointment?.appointment_date || new Date().toISOString().slice(0, 10),
    start_time: appointment?.start_time?.slice(0, 5) || "",
    end_time: appointment?.end_time?.slice(0, 5) || "",
    area: appointment?.area || "CLINICA",
    specialty: appointment?.specialty || "",
    status: appointment?.status || "scheduled",
    notes: appointment?.notes || ""
  };
}

function buildPatientSearchLabel(patient: { name: string; client_name?: string | null }) {
  return `${patient.name} - ${patient.client_name || "Sin responsable"}`;
}

function getDoctorStatusBadge(status?: string | null) {
  if (status === "en_consulta") return "appointment-status-confirmed";
  if (status === "desconectado") return "appointment-status-cancelled";
  return "appointment-status-scheduled";
}

export function MedicalAppointmentsPage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const forcedArea = getAppointmentAreaFromPath(location.pathname);
  const [appointments, setAppointments] = useState<ClinicalAppointment[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalAppointment | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<ClinicalPatientSummary[]>([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [selectedPatientMeta, setSelectedPatientMeta] = useState<SelectedPatientMeta | null>(null);
  const [showCreatePatientModal, setShowCreatePatientModal] = useState(false);
  const [form, setForm] = useState<AppointmentFormState>({
    ...emptyForm,
    area: forcedArea || emptyForm.area,
    appointment_date: searchParams.get("date") || emptyForm.appointment_date
  });
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [calendarView, setCalendarView] = useState<"day" | "month">("day");
  const [dateFilter, setDateFilter] = useState(searchParams.get("date") || emptyForm.appointment_date);
  const [areaFilter, setAreaFilter] = useState(forcedArea || "");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const appointmentsByDate = useMemo(() => (
    appointments.reduce<Record<string, ClinicalAppointment[]>>((accumulator, appointment) => {
      const key = appointment.appointment_date;
      accumulator[key] = accumulator[key] || [];
      accumulator[key].push(appointment);
      return accumulator;
    }, {})
  ), [appointments]);

  const dayAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.appointment_date === dateFilter),
    [appointments, dateFilter]
  );
  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => String(doctor.id) === doctorFilter) || null,
    [doctorFilter, doctors]
  );
  const occupiedSlots = useMemo(
    () => dayAppointments.map((appointment) => `${appointment.start_time.slice(0, 5)} - ${appointment.end_time.slice(0, 5)} · ${appointment.patient_name}`),
    [dayAppointments]
  );

  async function loadDoctors() {
    if (!token) return;
    const response = await apiRequest<User[]>("/medical-appointments/doctors", { token });
    setDoctors(response);
  }

  async function loadAppointments() {
    if (!token) return;
    const params = new URLSearchParams();
    if (calendarView === "month") {
      const [year, month] = dateFilter.split("-");
      params.set("date_from", `${year}-${month}-01`);
      params.set("date_to", `${year}-${month}-31`);
    } else {
      params.set("date", dateFilter);
    }
    if (areaFilter) params.set("area", areaFilter);
    if (doctorFilter) params.set("doctor_user_id", doctorFilter);
    if (specialtyFilter.trim()) params.set("specialty", specialtyFilter.trim());
    if (statusFilter) params.set("status", statusFilter);
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
    loadDoctors().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar doctores");
    });
  }, [token]);

  useEffect(() => {
    if (forcedArea) {
      setAreaFilter(forcedArea);
      setForm((current) => ({ ...current, area: forcedArea }));
    }
  }, [forcedArea]);

  useEffect(() => {
    loadAppointments().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar citas");
    });
  }, [token, dateFilter, areaFilter, calendarView, doctorFilter, specialtyFilter, statusFilter]);

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
  }, [selectedId, token, dateFilter, mode, setSearchParams]);

  useEffect(() => {
    if (mode !== "edit" || !detail) return;
    setSelectedPatientMeta({
      id: detail.patient_id,
      name: detail.patient_name,
      client_id: detail.client_id,
      client_name: detail.client_name
    });
    setPatientQuery(buildPatientSearchLabel({ name: detail.patient_name, client_name: detail.client_name }));
    setPatientResults([]);
  }, [mode, detail]);

  useEffect(() => {
    if (!token || selectedPatientMeta) {
      setPatientResults([]);
      return;
    }
    const term = patientQuery.trim();
    if (term.length < 2) {
      setPatientResults([]);
      setPatientSearching(false);
      return;
    }
    setPatientSearching(true);
    const timeout = setTimeout(() => {
      apiRequest<ClinicalPatientSummary[]>(`/patients?search=${encodeURIComponent(term)}&active=true`, { token })
        .then(setPatientResults)
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "No fue posible buscar pacientes");
        })
        .finally(() => setPatientSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [patientQuery, token, selectedPatientMeta]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate(date = dateFilter, doctorUserId = doctorFilter) {
    resetFeedback();
    setMode("create");
    const nextDoctor = doctors.find((doctor) => String(doctor.id) === doctorUserId);
    setForm({
      ...emptyForm,
      area: forcedArea || "CLINICA",
      appointment_date: date,
      doctor_user_id: doctorUserId,
      specialty: nextDoctor?.specialty || ""
    });
    setPatientQuery("");
    setPatientResults([]);
    setSelectedPatientMeta(null);
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(appointmentToForm(detail));
  }

  function handlePatientQueryChange(value: string) {
    setPatientQuery(value);
    setSelectedPatientMeta(null);
    setForm((current) => ({ ...current, patient_id: "", client_id: "" }));
  }

  function handleSelectPatient(patient: ClinicalPatientSummary) {
    setSelectedPatientMeta({
      id: patient.id,
      name: patient.name,
      client_id: patient.client_id ?? null,
      client_name: patient.client_name ?? null
    });
    setPatientQuery(buildPatientSearchLabel(patient));
    setForm((current) => ({
      ...current,
      patient_id: String(patient.id),
      client_id: patient.client_id ? String(patient.client_id) : ""
    }));
    setPatientResults([]);
  }

  function handlePatientCreated(patient: ClinicalPatientSummary, client: ClinicalClientSummary) {
    setSelectedPatientMeta({ id: patient.id, name: patient.name, client_id: client.id, client_name: client.name });
    setPatientQuery(buildPatientSearchLabel({ name: patient.name, client_name: client.name }));
    setForm((current) => ({ ...current, patient_id: String(patient.id), client_id: String(client.id) }));
    setPatientResults([]);
    setShowCreatePatientModal(false);
    setInfo("Paciente creado y seleccionado en la cita");
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
          client_id: form.client_id ? Number(form.client_id) : undefined,
          doctor_user_id: form.doctor_user_id ? Number(form.doctor_user_id) : undefined
        })
      });
      setInfo(mode === "edit" ? "Cita actualizada correctamente" : "Cita creada correctamente");
      await loadAppointments();
      await loadDoctors();
      if (mode === "edit" && selectedId) {
        await loadDetail(selectedId);
      } else {
        startCreate(form.appointment_date, form.doctor_user_id);
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "No fue posible guardar la cita";
      setError(message.includes("El doctor ya tiene una cita programada en ese horario")
        ? "El doctor ya tiene una cita programada en ese horario. Elige otro horario o reasigna la cita."
        : message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{forcedArea === "ESTETICA" ? "Citas - Estetica" : forcedArea === "CLINICA" ? "Citas - Medica" : "Agenda de citas"}</h2>
            <p className="muted">Vista diaria o mensual con filtros utiles, ocupacion visible y acceso rapido a la agenda del doctor.</p>
          </div>
          <div className="inline-actions">
            <select value={calendarView} onChange={(event) => setCalendarView(event.target.value as "day" | "month")}>
              <option value="day">Vista dia</option>
              <option value="month">Vista mes</option>
            </select>
            <button className="button" onClick={() => startCreate()} type="button">Crear cita</button>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}

        <div className="stats-grid">
          <div className="info-card compact-box"><strong>{dayAppointments.length}</strong><span className="muted">Citas del dia</span></div>
          <div className="info-card compact-box"><strong>{dayAppointments.filter((item) => item.status === "scheduled" || item.status === "confirmed").length}</strong><span className="muted">Pendientes</span></div>
          <div className="info-card compact-box"><strong>{doctors.filter((doctor) => doctor.status === "en_consulta").length}</strong><span className="muted">Doctores en consulta</span></div>
          <div className="info-card compact-box"><strong>{selectedDoctor?.today_appointments || 0}</strong><span className="muted">Carga del doctor</span></div>
        </div>

        <div className="form-section-grid">
          <label>
            {calendarView === "day" ? "Fecha" : "Mes"}
            <input type={calendarView === "day" ? "date" : "month"} value={calendarView === "day" ? dateFilter : dateFilter.slice(0, 7)} onChange={(event) => setDateFilter(calendarView === "day" ? event.target.value : `${event.target.value}-01`)} />
          </label>
          {forcedArea ? (
            <label>
              Area
              <input disabled value={forcedArea === "ESTETICA" ? "Estetica" : "Clinica"} />
            </label>
          ) : (
            <label>
              Area
              <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                <option value="">Todas</option>
                <option value="CLINICA">Clinica</option>
                {!hidesAesthetics(user?.pos_type) ? <option value="ESTETICA">Estetica</option> : null}
              </select>
            </label>
          )}
          <label>
            Doctor
            <select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}>
              <option value="">Todos</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
            </select>
          </label>
          <label>
            Especialidad
            <input placeholder="Filtrar por especialidad" value={specialtyFilter} onChange={(event) => setSpecialtyFilter(event.target.value)} />
          </label>
          <label>
            Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="scheduled">Programadas</option>
              <option value="confirmed">Confirmadas</option>
              <option value="completed">Completadas</option>
              <option value="cancelled">Canceladas</option>
              <option value="no_show">No asistio</option>
            </select>
          </label>
        </div>

        {calendarView === "day" ? (
          <div className="page-grid two-columns dashboard-grid">
            <div className="timeline-list">
              {appointments.map((appointment) => (
                <button className={`timeline-card ${appointment.id === selectedId ? "timeline-card-active" : ""}`} key={appointment.id} onClick={() => setSelectedId(appointment.id)} type="button">
                  <div className="panel-header">
                    <strong>{appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</strong>
                    <span className={`status-badge appointment-status-${appointment.status}`}>{appointment.status}</span>
                  </div>
                  <div>{appointment.patient_name}</div>
                  <div className="muted">{appointment.doctor_name || "Sin doctor"} · {appointment.specialty || appointment.area}</div>
                </button>
              ))}
              {!appointments.length ? (
                <div className="empty-state-card">
                  <strong>Sin citas para {shortDate(dateFilter)}.</strong>
                  <span className="muted">Crea la primera cita desde el formulario o ajusta filtros.</span>
                </div>
              ) : null}
            </div>
            <div className="stack-list">
              <div className="info-card">
                <strong>Horarios ocupados</strong>
                {occupiedSlots.length ? occupiedSlots.map((slot) => <p key={slot}>{slot}</p>) : <p className="muted">Aun no hay horarios ocupados este dia.</p>}
              </div>
              {selectedDoctor ? (
                <div className="info-card">
                  <strong>{selectedDoctor.full_name}</strong>
                  <p>{selectedDoctor.specialty || "Sin especialidad"} · {selectedDoctor.status || "activo"}</p>
                  <p>Citas de hoy: {selectedDoctor.today_appointments || 0}</p>
                  <p>Pendientes hoy: {selectedDoctor.pending_today || 0}</p>
                  <p>Proximas: {selectedDoctor.next_appointments || 0}</p>
                  <div className="inline-actions">
                    <button className="button ghost" onClick={() => startCreate(dateFilter, String(selectedDoctor.id))} type="button">Agendar con este doctor</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="timeline-list">
            {Object.entries(appointmentsByDate).map(([date, dayAppointmentsGroup]) => (
              <div className="info-card" key={date}>
                <div className="panel-header">
                  <strong>{shortDate(date)}</strong>
                  <span className="muted">{dayAppointmentsGroup.length} cita(s)</span>
                </div>
                {dayAppointmentsGroup.map((appointment) => (
                  <button className={`timeline-card ${appointment.id === selectedId ? "timeline-card-active" : ""}`} key={appointment.id} onClick={() => setSelectedId(appointment.id)} type="button">
                    <div className="panel-header">
                      <strong>{appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</strong>
                      <span className={`status-badge appointment-status-${appointment.status}`}>{appointment.status}</span>
                    </div>
                    <div>{appointment.patient_name}</div>
                    <div className="muted">{appointment.doctor_name || "Sin doctor"} · {appointment.specialty || appointment.area}</div>
                  </button>
                ))}
              </div>
            ))}
            {!appointments.length ? (
              <div className="empty-state-card">
                <strong>No hay citas en este periodo.</strong>
                <span className="muted">Ajusta filtros o agenda una nueva cita.</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? "Editar cita" : "Nueva cita"}</h2>
            <p className="muted">El backend valida negocio, doctor y empalmes. Aqui solo dejamos el flujo mas claro para operar.</p>
          </div>
          {detail ? <button className="button ghost" onClick={startEdit} type="button">Editar</button> : null}
        </div>
        <form className="grid-form" onSubmit={handleSubmit}>
          <div className="form-span-2">
            <label>
              Paciente
              <input
                placeholder="Busca por nombre (min. 2 letras)"
                value={patientQuery}
                onChange={(event) => handlePatientQueryChange(event.target.value)}
              />
            </label>
            {patientSearching ? <p className="muted">Buscando...</p> : null}
            {!selectedPatientMeta && patientResults.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Responsable</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientResults.map((patient) => (
                      <tr key={patient.id}>
                        <td>{patient.name}</td>
                        <td>{patient.client_name || "Sin responsable"}</td>
                        <td><button className="button ghost" onClick={() => handleSelectPatient(patient)} type="button">Seleccionar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!selectedPatientMeta && !patientSearching && patientQuery.trim().length >= 2 && !patientResults.length ? (
              <p className="muted">Sin resultados para &quot;{patientQuery.trim()}&quot;.</p>
            ) : null}
            <div className="inline-actions">
              <button className="button ghost" onClick={() => setShowCreatePatientModal(true)} type="button">+ Crear paciente</button>
            </div>
          </div>
          <label>
            Responsable
            <input disabled value={selectedPatientMeta?.client_name || (form.patient_id ? "Sin responsable" : "")} />
          </label>
          <label>
            Fecha
            <input type="date" value={form.appointment_date} onChange={(event) => setForm({ ...form, appointment_date: event.target.value })} />
          </label>
          <label>
            Hora inicio
            <input type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
          </label>
          <label>
            Hora fin
            <input type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
          </label>
          {forcedArea ? (
            <label>
              Area
              <input disabled value={forcedArea === "ESTETICA" ? "Estetica" : "Clinica"} />
            </label>
          ) : (
            <label>
              Area
              <select value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value as "CLINICA" | "ESTETICA" })}>
                <option value="CLINICA">Clinica</option>
                {!hidesAesthetics(user?.pos_type) ? <option value="ESTETICA">Estetica</option> : null}
              </select>
            </label>
          )}
          <label>
            Doctor
            <select value={form.doctor_user_id} onChange={(event) => {
              const nextDoctor = doctors.find((doctor) => String(doctor.id) === event.target.value);
              setForm({ ...form, doctor_user_id: event.target.value, specialty: nextDoctor?.specialty || form.specialty });
            }}>
              <option value="">Sin asignar</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
            </select>
          </label>
          <label>
            Area / especialidad
            <input value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} />
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ClinicalAppointment["status"] })}>
              <option value="scheduled">Programada</option>
              <option value="confirmed">Confirmada</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
              <option value="no_show">No asistio</option>
            </select>
          </label>
          <label className="form-span-2">
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Guardar cita"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={() => startCreate()} type="button">Cancelar</button> : null}
          </div>
        </form>

        {detail ? (
          <div className="info-card">
            <p><strong>Paciente:</strong> {detail.patient_name}</p>
            <p><strong>Responsable:</strong> {detail.client_name || "Sin responsable"}</p>
            <p><strong>Fecha:</strong> {shortDate(detail.appointment_date)}</p>
            <p><strong>Horario:</strong> {detail.start_time.slice(0, 5)} - {detail.end_time.slice(0, 5)}</p>
            <p><strong>Area:</strong> {detail.area}</p>
            <p><strong>Doctor:</strong> {detail.doctor_name || "-"}</p>
            <p><strong>Especialidad:</strong> {detail.specialty || "-"}</p>
            <p><strong>Estado:</strong> {detail.status}</p>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)} type="button">Ver paciente</button>
            </div>
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona una cita o crea una nueva.</strong>
            <span className="muted">La agenda mantiene compatibilidad con el flujo clinico actual.</span>
          </div>
        )}
      </div>

      {isPharmacyClinicPos(user?.pos_type) ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Panel de doctores</h2>
              <p className="muted">Carga operativa resumida para que administracion y recepcion agenden mejor.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Especialidad</th>
                  <th>Contacto</th>
                  <th>Cedula</th>
                  <th>Carga de hoy</th>
                  <th>Estado</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((doctor) => (
                  <tr key={doctor.id}>
                    <td>{doctor.full_name}</td>
                    <td>{doctor.specialty || "-"}</td>
                    <td>
                      <div>{doctor.email}</div>
                      <small className="muted">{doctor.phone || "-"}</small>
                    </td>
                    <td>{doctor.professional_license || "-"}</td>
                    <td>
                      <div>{doctor.today_appointments || 0} citas</div>
                      <small className="muted">{doctor.pending_today || 0} pendientes · {doctor.next_appointments || 0} proximas</small>
                    </td>
                    <td>
                      <span className={`status-badge ${getDoctorStatusBadge(doctor.status)}`}>
                        {doctor.status || (doctor.is_active ? "activo" : "desconectado")}
                      </span>
                    </td>
                    <td>
                      <button className="button ghost" onClick={() => { setDoctorFilter(String(doctor.id)); startCreate(dateFilter, String(doctor.id)); }} type="button">
                        Agendar
                      </button>
                    </td>
                  </tr>
                ))}
                {!doctors.length ? (
                  <tr>
                    <td className="muted" colSpan={7}>No hay doctores disponibles.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showCreatePatientModal ? (
        <PatientQuickCreateModal
          initialName={patientQuery}
          onClose={() => setShowCreatePatientModal(false)}
          onCreated={handlePatientCreated}
          posType={user?.pos_type}
          token={token}
        />
      ) : null}
    </section>
  );
}
