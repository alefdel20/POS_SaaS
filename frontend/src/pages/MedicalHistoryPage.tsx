import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalClientSummary, ClinicalHistoryResponse, ClinicalPatientSummary } from "../types";
import { shortDateTime } from "../utils/format";

export function MedicalHistoryPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<ClinicalClientSummary[]>([]);
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [history, setHistory] = useState<ClinicalHistoryResponse | null>(null);
  const [patientId, setPatientId] = useState(searchParams.get("patient_id") || "");
  const [clientId, setClientId] = useState(searchParams.get("client_id") || "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

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
    loadHistory().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    });
  }, [token, patientId, clientId, dateFrom, dateTo]);

  async function handleExportPdf() {
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
      setInfo("PDF generado");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No fue posible exportar PDF");
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historial medico</h2>
            <p className="muted">Timeline clinico derivado desde consultas y tratamientos registrados.</p>
          </div>
          <button className="button" disabled={!patientId} onClick={handleExportPdf} type="button">Exportar PDF</button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="form-section-grid">
          <label>
            Paciente
            <select value={patientId} onChange={(event) => setPatientId(event.target.value)}>
              <option value="">Todos</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.client_name}</option>)}
            </select>
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
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Timeline clinico</h2>
            <p className="muted">Navegacion cruzada a consulta, paciente y cliente.</p>
          </div>
        </div>
        {history ? (
          <div className="clinical-summary-grid">
            <div className="info-card compact-box"><strong>{history.summary.total_consultations}</strong><span className="muted">Consultas</span></div>
            <div className="info-card compact-box"><strong>{history.summary.total_treatments}</strong><span className="muted">Tratamientos</span></div>
          </div>
        ) : null}
        {loading ? <p className="muted">Cargando historial...</p> : null}
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
              <div className="inline-actions">
                <button className="button ghost" onClick={() => navigate(`/medical-consultations?consultation=${entry.id}`)} type="button">Ver consulta</button>
                <button className="button ghost" onClick={() => navigate(`/patients?patient=${entry.patient_id}`)} type="button">Ver paciente</button>
                <button className="button ghost" onClick={() => navigate(`/clients?client=${entry.client_id}`)} type="button">Ver cliente</button>
              </div>
            </div>
          ))}
          {!history?.timeline.length && !loading ? (
            <div className="empty-state-card">
              <strong>No hay eventos clinicos con esos filtros.</strong>
              <span className="muted">Ajusta paciente, cliente o rango de fechas.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
