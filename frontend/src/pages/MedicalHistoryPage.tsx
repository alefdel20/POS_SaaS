import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalClientSummary, ClinicalHistoryResponse, ClinicalPatientSummary } from "../types";
import { shortDate, shortDateTime } from "../utils/format";
import { getMedicalHistoryViewFromPath } from "../utils/navigation";

function groupTimelineByDate(history: ClinicalHistoryResponse | null) {
  const grouped = new Map<string, ClinicalHistoryResponse["timeline"]>();
  history?.timeline.forEach((entry) => {
    const key = entry.consultation_date.slice(0, 10);
    const current = grouped.get(key) || [];
    current.push(entry);
    grouped.set(key, current);
  });
  return Array.from(grouped.entries());
}

export function MedicalHistoryPage() {
  const { token } = useAuth();
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

  const filteredPatients = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) =>
      `${patient.name} ${patient.client_name || ""} ${patient.species || ""} ${patient.breed || ""}`.toLowerCase().includes(term)
    );
  }, [patientSearch, patients]);

  const selectedPatient = patients.find((patient) => String(patient.id) === patientId) || null;
  const groupedTimeline = useMemo(() => groupTimelineByDate(history), [history]);

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
            <input placeholder="Nombre, tutor, especie o raza" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
          </label>
          <label>
            Cliente
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Todos</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
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
                <th>Cliente</th>
                <th>Especie / raza</th>
                <th>Consultas</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatients.map((patient) => (
                <tr className={String(patient.id) === patientId ? "table-row-active" : ""} key={patient.id} onClick={() => setPatientId(String(patient.id))}>
                  <td>{patient.name}</td>
                  <td>{patient.client_name}</td>
                  <td>{patient.species || "-"} / {patient.breed || "-"}</td>
                  <td>{patient.consultation_count}</td>
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
            <h2>{historyView === "calendar" ? "Calendario / Cardex" : "Carnet clinico"}</h2>
            <p className="muted">La experiencia se mantiene dentro del modulo Historial medico.</p>
          </div>
        </div>
        {selectedPatient ? (
          <div className="info-card">
            <p><strong>Paciente:</strong> {selectedPatient.name}</p>
            <p><strong>Cliente / tutor:</strong> {selectedPatient.client_name}</p>
            <p><strong>Estado:</strong> {selectedPatient.is_active ? "Activo" : "Inactivo"}</p>
            <p><strong>Especie / raza:</strong> {selectedPatient.species || "-"} / {selectedPatient.breed || "-"}</p>
            <p><strong>Peso:</strong> {selectedPatient.weight ?? "-"}</p>
            <p><strong>Alergias:</strong> {selectedPatient.allergies || "-"}</p>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/medical-consultations?consultation=${history?.timeline[0]?.id || ""}`)} type="button">Ver consulta mas reciente</button>
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${selectedPatient.id}`)} type="button">Abrir ficha general</button>
            </div>
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona un paciente desde la lista.</strong>
            <span className="muted">Su expediente se abrira aqui mismo.</span>
          </div>
        )}

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
          <div className="timeline-list">
            {groupedTimeline.map(([date, entries]) => (
              <div className="info-card" key={date}>
                <div className="panel-header">
                  <strong>{shortDate(date)}</strong>
                  <span className="muted">{entries.length} evento(s)</span>
                </div>
                {entries.map((entry) => (
                  <div className="timeline-card timeline-card-static" key={`calendar-${entry.id}`}>
                    <p><strong>Hora:</strong> {shortDateTime(entry.consultation_date)}</p>
                    <p><strong>Motivo:</strong> {entry.motivo_consulta}</p>
                    <p><strong>Diagnostico:</strong> {entry.diagnostico}</p>
                    <p><strong>Tratamiento:</strong> {entry.tratamiento}</p>
                    {entry.prescriptions?.length ? <p><strong>Recetas:</strong> {entry.prescriptions.length}</p> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="timeline-list">
            {history?.timeline.map((entry) => (
              <div className="timeline-card timeline-card-static" key={entry.id}>
                <div className="panel-header">
                  <strong>{entry.patient_name}</strong>
                  <span className="muted">{shortDateTime(entry.consultation_date)}</span>
                </div>
                <p><strong>Cliente:</strong> {entry.client_name}</p>
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
