import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalAppointment, ClinicalClientSummary, ClinicalHistoryResponse, ClinicalPatientSummary, CompanyProfile, Reminder } from "../types";
import { resolveUploadedAssetUrl } from "../utils/assets";
import { buildMonthCells, formatMonthLabel, shiftMonth } from "../utils/calendarGrid";
import { dateLabel, shortDate, shortDateTime } from "../utils/format";
import { getMedicalHistoryViewFromPath } from "../utils/navigation";
import { getPatientSearchPlaceholder, showsPatientSpecies, usesHumanPatientsOnly } from "../utils/pos";
import { getMexicoCityDateInputValue, getMonthInputRange } from "../utils/timezone";

const weekdayLabels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

function normalizeDateKey(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function resolveReminderDateKey(reminder: Reminder) {
  const dueDate = normalizeDateKey(reminder.due_date);
  if (dueDate) return dueDate;
  const metadata = reminder.metadata || {};
  const startAt = typeof metadata.start_at === "string"
    ? metadata.start_at
    : (typeof metadata.calendar_start_at === "string" ? metadata.calendar_start_at : "");
  return startAt ? getMexicoCityDateInputValue(startAt) : "";
}

export function MedicalHistoryPage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const historyView = getMedicalHistoryViewFromPath(location.pathname);
  const [clients, setClients] = useState<ClinicalClientSummary[]>([]);
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [history, setHistory] = useState<ClinicalHistoryResponse | null>(null);
  const [patientId, setPatientId] = useState(searchParams.get("patient_id") || "");
  const [clientId, setClientId] = useState(searchParams.get("client_id") || "");
  const [patientSearch, setPatientSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showFullRecord, setShowFullRecord] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<CompanyProfile | null>(null);
  const [nextAppointment, setNextAppointment] = useState<ClinicalAppointment | null>(null);
  const [fullRecordLoading, setFullRecordLoading] = useState(false);
  const [calendarReminders, setCalendarReminders] = useState<Reminder[]>([]);
  const [calendarView, setCalendarView] = useState<"month" | "day">("month");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(getMexicoCityDateInputValue());
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(getMexicoCityDateInputValue().slice(0, 7));
  const humanPatientsOnly = usesHumanPatientsOnly(user?.pos_type);
  const showSpecies = showsPatientSpecies(user?.pos_type);

  const filteredPatients = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) =>
      `${patient.name} ${patient.client_name || ""} ${humanPatientsOnly ? `${patient.client_phone || ""} ${patient.client_email || ""}` : `${patient.species || ""} ${patient.breed || ""}`}`.toLowerCase().includes(term)
    );
  }, [humanPatientsOnly, patientSearch, patients]);

  const selectedPatient = patients.find((patient) => String(patient.id) === patientId) || null;
  const vaccinations = useMemo(
    () => history?.preventive_events?.filter((event) => event.event_type === "vaccination") || [],
    [history]
  );
  const dewormings = useMemo(
    () => history?.preventive_events?.filter((event) => event.event_type === "deworming") || [],
    [history]
  );
  const calendarRemindersByDate = useMemo(
    () => calendarReminders.reduce<Record<string, Reminder[]>>((accumulator, reminder) => {
      const key = resolveReminderDateKey(reminder) || "Sin fecha";
      accumulator[key] = [...(accumulator[key] || []), reminder];
      return accumulator;
    }, {}),
    [calendarReminders]
  );
  const monthCells = useMemo(() => buildMonthCells(selectedCalendarMonth), [selectedCalendarMonth]);
  const selectedDayReminders = calendarRemindersByDate[selectedCalendarDate] || [];

  async function loadOptions() {
    if (!token) return;
    const [clientResponse, patientResponse] = await Promise.all([
      apiRequest<ClinicalClientSummary[]>("/clients", { token }),
      apiRequest<ClinicalPatientSummary[]>("/patients", { token })
    ]);
    setClients(clientResponse);
    setPatients(patientResponse);
  }

  async function loadHistory() {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (patientId) params.set("patient_id", patientId);
      if (clientId) params.set("client_id", clientId);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      setSearchParams(params, { replace: true });
      const response = await apiRequest<ClinicalHistoryResponse>(`/medical-history?${params.toString()}`, { token });
      setHistory(response);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar opciones");
    });
  }, [token]);

  useEffect(() => {
    if (patientId && !clientId) {
      const selected = patients.find((patient) => String(patient.id) === patientId);
      if (selected?.client_id) {
        setClientId(String(selected.client_id));
      }
    }
  }, [clientId, patientId, patients]);

  useEffect(() => {
    loadHistory().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    });
  }, [token, patientId, clientId, dateFrom, dateTo]);

  useEffect(() => {
    setShowFullRecord(false);
    setNextAppointment(null);
  }, [patientId]);

  async function loadFullRecord() {
    if (!token || !patientId) return;
    setFullRecordLoading(true);
    try {
      const [profileResponse, appointmentResponse] = await Promise.all([
        businessProfile ? Promise.resolve(businessProfile) : apiRequest<CompanyProfile>("/profile", { token }),
        (() => {
          const params = new URLSearchParams();
          params.set("patient_id", patientId);
          params.set("date_from", new Date().toISOString().slice(0, 10));
          params.set("status", "scheduled");
          return apiRequest<ClinicalAppointment[]>(`/medical-appointments?${params.toString()}`, { token });
        })()
      ]);
      setBusinessProfile(profileResponse);
      const sortedAppointments = [...appointmentResponse].sort((a, b) =>
        `${a.appointment_date}T${a.start_time}`.localeCompare(`${b.appointment_date}T${b.start_time}`)
      );
      setNextAppointment(sortedAppointments[0] || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el expediente completo");
    } finally {
      setFullRecordLoading(false);
    }
  }

  function toggleFullRecord() {
    if (!showFullRecord) {
      loadFullRecord().catch(() => undefined);
    }
    setShowFullRecord((current) => !current);
  }

  async function loadCalendarReminders(monthKey: string) {
    if (!token || !patientId) {
      setCalendarReminders([]);
      return;
    }
    const monthRange = getMonthInputRange(monthKey);
    if (!monthRange) return;
    setCalendarLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("start_date", monthRange.start);
      params.set("end_date", monthRange.end);
      params.set("patient_id", patientId);
      const response = await apiRequest<Reminder[]>(`/reminders/calendar?${params.toString()}`, { token });
      setCalendarReminders(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el calendario");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    if (historyView !== "calendar") return;
    loadCalendarReminders(selectedCalendarMonth).catch(() => undefined);
  }, [token, patientId, historyView, selectedCalendarMonth]);

  useEffect(() => {
    if (!selectedCalendarDate.startsWith(selectedCalendarMonth)) {
      setSelectedCalendarDate(`${selectedCalendarMonth}-01`);
    }
  }, [selectedCalendarDate, selectedCalendarMonth]);

  async function handleDownloadPdf() {
    if (!token || !patientId) return;
    try {
      setInfo("");
      setError("");
      const params = new URLSearchParams();
      params.set("patient_id", patientId);
      if (clientId) params.set("client_id", clientId);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const blob = await apiDownload(`/medical-history/export/pdf?${params.toString()}`, { token });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `historial-clinico-${patientId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setInfo("PDF descargado");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No fue posible descargar PDF");
    }
  }

  function buildShareMessage() {
    const patientName = selectedPatient?.name || "paciente";
    const dateLabel = dateFrom || dateTo ? ` (${dateFrom || "..."} a ${dateTo || "..."})` : "";
    return `Historial medico de ${patientName}${dateLabel}. Revisa el expediente en el sistema POS.`;
  }

  function handleShare(channel: "whatsapp" | "email") {
    if (!patientId) return;
    const message = buildShareMessage();
    const currentUrl = window.location.href;
    if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${message} ${currentUrl}`)}`, "_blank", "noopener,noreferrer");
      return;
    }

    window.location.href = `mailto:?subject=${encodeURIComponent(`Historial medico - ${selectedPatient?.name || "paciente"}`)}&body=${encodeURIComponent(`${message}\n\n${currentUrl}`)}`;
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historial medico</h2>
            <p className="muted">Selecciona un paciente dentro de este modulo para abrir su expediente.</p>
          </div>
          <div className="inline-actions">
            <button className="button" disabled={!patientId} onClick={handleDownloadPdf} type="button">Descargar PDF</button>
            <details className="share-actions">
              <summary className={`button ghost ${!patientId ? "button-disabled" : ""}`}>Compartir</summary>
              <div className="share-actions-menu">
                <button className="button ghost" disabled={!patientId} onClick={() => handleShare("whatsapp")} type="button">WhatsApp</button>
                <button className="button ghost" disabled={!patientId} onClick={() => handleShare("email")} type="button">Correo</button>
              </div>
            </details>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="form-section-grid">
          <label className="form-span-2">
            Buscar paciente
            <input placeholder={getPatientSearchPlaceholder(user?.pos_type)} value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
          </label>
          {!humanPatientsOnly ? (
            <label>
              Cliente
              <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="">Todos</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            Desde
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                {humanPatientsOnly ? (
                  <>
                    <th>Telefono</th>
                    <th>Consultas</th>
                    <th>Correo</th>
                  </>
                ) : (
                  <>
                    <th>Cliente</th>
                    <th>Especie / raza</th>
                    <th>Consultas</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredPatients.map((patient) => (
                <tr className={String(patient.id) === patientId ? "table-row-active" : ""} key={patient.id} onClick={() => setPatientId(String(patient.id))}>
                  <td>{patient.name}</td>
                  {humanPatientsOnly ? (
                    <>
                      <td>{patient.client_phone || "-"}</td>
                      <td>{patient.consultation_count}</td>
                      <td>{patient.client_email || "-"}</td>
                    </>
                  ) : (
                    <>
                      <td>{patient.client_name}</td>
                      <td>{showSpecies ? `${patient.species || "-"} / ${patient.breed || "-"}` : "-"}</td>
                      <td>{patient.consultation_count}</td>
                    </>
                  )}
                </tr>
              ))}
              {!filteredPatients.length ? (
                <tr>
                  <td className="muted" colSpan={4}>No se encontraron pacientes para este filtro.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{historyView === "calendar" ? "Calendario clinico" : "Carnet clinico"}</h2>
            <p className="muted">La experiencia se mantiene dentro del modulo Historial medico.</p>
          </div>
        </div>
        {selectedPatient ? (
          <div className="info-card">
            <p><strong>Paciente:</strong> {selectedPatient.name}</p>
            <p><strong>{humanPatientsOnly ? "Contacto" : "Cliente / tutor"}:</strong> {selectedPatient.client_name}</p>
            <p><strong>Estado:</strong> {selectedPatient.is_active ? "Activo" : "Inactivo"}</p>
            {showSpecies ? <p><strong>Especie / raza:</strong> {selectedPatient.species || "-"} / {selectedPatient.breed || "-"}</p> : null}
            <p><strong>Peso:</strong> {selectedPatient.weight ?? "-"}</p>
            <p><strong>Alergias:</strong> {selectedPatient.allergies || "-"}</p>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/medical-consultations?consultation=${history?.timeline[0]?.id || ""}`)} type="button">Ver consulta mas reciente</button>
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${selectedPatient.id}`)} type="button">Abrir ficha general</button>
              <button className="button ghost" onClick={toggleFullRecord} type="button">
                {showFullRecord ? "Ocultar expediente completo" : "Ver expediente completo"}
              </button>
              <button className="button ghost" onClick={() => navigate(`/health/medical-history/cardex?patient_id=${selectedPatient.id}`)} type="button">
                Ver cardex
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona un paciente desde la lista.</strong>
            <span className="muted">Su expediente se abrira aqui mismo.</span>
          </div>
        )}

        {showFullRecord && selectedPatient ? (
          <div className="clinical-summary-grid">
            {fullRecordLoading ? <p className="muted">Cargando expediente completo...</p> : null}

            <div className="info-card compact-box">
              <h3>Clinica</h3>
              {businessProfile?.business_image_path ? (
                <img alt="Imagen del negocio" className="profile-asset-preview" src={resolveUploadedAssetUrl(businessProfile.business_image_path) || ""} />
              ) : (
                <p className="muted">Sin imagen de negocio configurada.</p>
              )}
              <p><strong>Negocio:</strong> {businessProfile?.company_name || "-"}</p>
              {businessProfile?.signature_image_path ? (
                <img alt="Firma" className="profile-asset-preview" src={resolveUploadedAssetUrl(businessProfile.signature_image_path) || ""} />
              ) : (
                <p className="muted">Sin firma configurada.</p>
              )}
            </div>

            <div className="info-card compact-box">
              <h3>{humanPatientsOnly ? "Contacto" : "Propietario"}</h3>
              <p><strong>Nombre:</strong> {selectedPatient.client_name || "-"}</p>
              <p><strong>Telefono:</strong> {selectedPatient.client_phone || "-"}</p>
              <p><strong>Correo:</strong> {selectedPatient.client_email || "-"}</p>
            </div>

            <div className="info-card compact-box">
              <h3>Datos del paciente</h3>
              <p><strong>Nombre:</strong> {selectedPatient.name}</p>
              {showSpecies ? <p><strong>Especie / raza:</strong> {selectedPatient.species || "-"} / {selectedPatient.breed || "-"}</p> : null}
              <p><strong>Sexo:</strong> {selectedPatient.sex || "-"}</p>
              <p><strong>Fecha de nacimiento:</strong> {shortDate(selectedPatient.birth_date || null)}</p>
              <p><strong>Peso:</strong> {selectedPatient.weight ?? "-"}</p>
              <p><strong>Alergias:</strong> {selectedPatient.allergies || "-"}</p>
              {humanPatientsOnly ? (
                <>
                  <p><strong>Tipo de sangre:</strong> {selectedPatient.blood_type || "-"}</p>
                  <p><strong>Ocupacion:</strong> {selectedPatient.occupation || "-"}</p>
                  <p><strong>Contacto de emergencia:</strong> {selectedPatient.emergency_contact_name || "-"} {selectedPatient.emergency_contact_phone ? `(${selectedPatient.emergency_contact_phone})` : ""}</p>
                  <p><strong>Condiciones cronicas:</strong> {selectedPatient.chronic_conditions_summary || "-"}</p>
                </>
              ) : (
                <>
                  <p><strong>Color / marcas:</strong> {selectedPatient.color_markings || "-"}</p>
                  <p><strong>Microchip:</strong> {selectedPatient.microchip_number || "-"}</p>
                  <p><strong>Esterilizado:</strong> {selectedPatient.sterilized ? "Si" : "No"}</p>
                </>
              )}
            </div>

            <div className="info-card compact-box">
              <h3>Vacunacion</h3>
              {vaccinations.length ? vaccinations.map((event) => (
                <p key={`full-vaccination-${event.id}`}>
                  {event.product_name_snapshot || "Vacuna"} · Aplicada: {shortDate(event.date_administered || null)} · Proxima: {shortDate(event.next_due_date || null)}
                </p>
              )) : <p className="muted">Sin vacunaciones registradas.</p>}
            </div>

            <div className="info-card compact-box">
              <h3>Desparasitacion</h3>
              {dewormings.length ? dewormings.map((event) => (
                <p key={`full-deworming-${event.id}`}>
                  {event.product_name_snapshot || "Desparasitante"} · Aplicada: {shortDate(event.date_administered || null)} · Proxima: {shortDate(event.next_due_date || null)}
                </p>
              )) : <p className="muted">Sin desparasitaciones registradas.</p>}
            </div>

            <div className="info-card compact-box">
              <h3>Proxima cita</h3>
              {nextAppointment ? (
                <>
                  <p><strong>Fecha:</strong> {shortDate(nextAppointment.appointment_date)} {nextAppointment.start_time}</p>
                  <p><strong>Especialidad:</strong> {nextAppointment.specialty || "-"}</p>
                  <p><strong>Doctor:</strong> {nextAppointment.doctor_name || "-"}</p>
                </>
              ) : (
                <p className="muted">Sin citas programadas.</p>
              )}
            </div>
          </div>
        ) : null}

        {history ? (
          <div className="clinical-summary-grid">
            <div className="info-card compact-box"><strong>{history.summary.total_consultations}</strong><span className="muted">Consultas</span></div>
            <div className="info-card compact-box"><strong>{history.summary.total_treatments}</strong><span className="muted">Tratamientos</span></div>
            <div className="info-card compact-box"><strong>{history.summary.total_prescriptions || 0}</strong><span className="muted">Recetas</span></div>
            <div className="info-card compact-box"><strong>{history.summary.total_preventive_events || 0}</strong><span className="muted">Preventivos</span></div>
          </div>
        ) : null}
        {loading ? <p className="muted">Cargando historial...</p> : null}

        {historyView === "calendar" ? (
          !selectedPatient ? (
            <div className="empty-state-card">
              <strong>Selecciona un paciente para ver su calendario.</strong>
              <span className="muted">El calendario clinico se filtra por el paciente elegido en la lista.</span>
            </div>
          ) : (
            <div className="stack-list">
              <div className="inline-actions">
                <button className={`button ghost ${calendarView === "month" ? "active-filter" : ""}`} onClick={() => setCalendarView("month")} type="button">Vista mensual</button>
                <button className={`button ghost ${calendarView === "day" ? "active-filter" : ""}`} onClick={() => setCalendarView("day")} type="button">Vista diaria</button>
              </div>

              {calendarLoading ? <p className="muted">Cargando calendario...</p> : null}

              {!calendarLoading && calendarView === "month" ? (
                <div className="stack-list">
                  <div className="panel-header">
                    <button className="button ghost" onClick={() => setSelectedCalendarMonth((current) => shiftMonth(current, -1))} type="button">Mes anterior</button>
                    <strong>{formatMonthLabel(selectedCalendarMonth)}</strong>
                    <button className="button ghost" onClick={() => setSelectedCalendarMonth((current) => shiftMonth(current, 1))} type="button">Mes siguiente</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.5rem" }}>
                    {weekdayLabels.map((label) => (
                      <div className="info-card compact-box" key={label} style={{ textAlign: "center", fontWeight: 700 }}>
                        {label}
                      </div>
                    ))}
                    {monthCells.map((cell) => {
                      const dayItems = cell.outside ? [] : calendarRemindersByDate[cell.key] || [];
                      const isSelected = !cell.outside && cell.key === selectedCalendarDate;
                      return (
                        <button
                          className={`info-card compact-box ${isSelected ? "active-filter" : ""}`}
                          disabled={cell.outside}
                          key={cell.key}
                          onClick={() => {
                            if (cell.outside) return;
                            setSelectedCalendarDate(cell.key);
                          }}
                          style={{ minHeight: "8.5rem", textAlign: "left", opacity: cell.outside ? 0.45 : 1 }}
                          type="button"
                        >
                          <strong>{cell.dayNumber || ""}</strong>
                          {!cell.outside ? (
                            <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                              {dayItems.slice(0, 2).map((reminder) => (
                                <span className="pill" key={`calendar-month-pill-${reminder.id}`} style={{ justifyContent: "flex-start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {reminder.title}
                                </span>
                              ))}
                              {dayItems.length > 2 ? <span className="muted">+{dayItems.length - 2} mas</span> : null}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="info-card">
                    <strong>{dateLabel(selectedCalendarDate)}</strong>
                    {selectedDayReminders.length ? (
                      <div className="stack-list">
                        {selectedDayReminders.map((reminder) => (
                          <article className="reminder-card" key={`calendar-selected-${reminder.id}`}>
                            <div>
                              <strong>{reminder.title}</strong>
                              <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No hay eventos para este dia.</p>
                    )}
                  </div>
                </div>
              ) : null}

              {!calendarLoading && calendarView === "day" ? (
                <div className="stack-list">
                  <div className="inline-actions">
                    <label>
                      Fecha
                      <input
                        type="date"
                        value={selectedCalendarDate}
                        onChange={(event) => {
                          setSelectedCalendarDate(event.target.value);
                          setSelectedCalendarMonth(event.target.value.slice(0, 7));
                        }}
                      />
                    </label>
                  </div>
                  <div className="info-card">
                    <strong>Agenda del dia: {dateLabel(selectedCalendarDate)}</strong>
                    {selectedDayReminders.length ? (
                      <div className="stack-list" style={{ marginTop: "1rem" }}>
                        {selectedDayReminders.map((reminder) => (
                          <article className="reminder-card" key={`calendar-agenda-${reminder.id}`}>
                            <div>
                              <strong>{reminder.title}</strong>
                              <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No hay eventos programados para esta fecha.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="timeline-list">
            {history?.timeline.map((entry) => (
              <div className="timeline-card timeline-card-static" key={entry.id}>
                <div className="panel-header">
                  <strong>{entry.patient_name}</strong>
                  <span className="muted">{shortDateTime(entry.consultation_date)}</span>
                </div>
                {!humanPatientsOnly ? <p><strong>Cliente:</strong> {entry.client_name}</p> : null}
                <p><strong>Motivo:</strong> {entry.motivo_consulta}</p>
                <p><strong>Diagnostico:</strong> {entry.diagnostico}</p>
                <p><strong>Tratamiento:</strong> {entry.tratamiento}</p>
                {entry.prescriptions?.length ? (
                  <div>
                    <p><strong>Recetas asociadas:</strong> {entry.prescriptions.length}</p>
                    {entry.prescriptions.map((prescription) => (
                      <p className="muted" key={`prescription-${prescription.id}`}>
                        Receta #{prescription.id} · {prescription.items.length} medicamento(s) · {prescription.status}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="inline-actions">
                  <button className="button ghost" onClick={() => navigate(`/medical-consultations?consultation=${entry.id}`)} type="button">Ver consulta</button>
                  <button className="button ghost" onClick={() => setPatientId(String(entry.patient_id))} type="button">Ver expediente</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {history?.prescriptions?.length ? (
          <div className="timeline-list">
            <div className="panel-header">
              <div>
                <h3>Recetas historicas</h3>
                <p className="muted">El expediente concentra medicamentos prescritos y su estado al momento de recetar.</p>
              </div>
            </div>
            {history.prescriptions.map((prescription) => (
              <div className="timeline-card timeline-card-static" key={`history-prescription-${prescription.id}`}>
                <div className="panel-header">
                  <strong>Receta #{prescription.id}</strong>
                  <span className="muted">{shortDateTime(prescription.created_at)}</span>
                </div>
                <p><strong>Estado:</strong> {prescription.status}</p>
                <p><strong>Diagnostico:</strong> {prescription.diagnosis || "-"}</p>
                <p><strong>Indicaciones:</strong> {prescription.indications || "-"}</p>
                <p><strong>Medicamentos:</strong> {prescription.items.map((item) => item.medication_name_snapshot).join(", ") || "-"}</p>
              </div>
            ))}
          </div>
        ) : null}

        {history?.preventive_events?.length ? (
          <div className="timeline-list">
            <div className="panel-header">
              <div>
                <h3>Carnet preventivo</h3>
                <p className="muted">Resumen de vacunacion, desparasitacion y proximas fechas del paciente.</p>
              </div>
            </div>
            {history.preventive_events.map((event) => (
              <div className="timeline-card timeline-card-static" key={`preventive-${event.id}`}>
                <div className="panel-header">
                  <strong>{event.event_type === "vaccination" ? "Vacuna" : "Desparasitacion"}</strong>
                  <span className="muted">{event.product_name_snapshot || "-"}</span>
                </div>
                <p><strong>Aplicada:</strong> {shortDate(event.date_administered || null)}</p>
                <p><strong>Proxima fecha:</strong> {shortDate(event.next_due_date || null)}</p>
                <p><strong>Estado:</strong> {event.status}</p>
                <p><strong>Dosis / aplicacion:</strong> {event.dose || "-"}</p>
                <p><strong>Notas:</strong> {event.notes || "-"}</p>
              </div>
            ))}
          </div>
        ) : null}

        {!history?.timeline.length && !loading ? (
          <div className="empty-state-card">
            <strong>No hay eventos clinicos con esos filtros.</strong>
            <span className="muted">Ajusta paciente, cliente o rango de fechas.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
