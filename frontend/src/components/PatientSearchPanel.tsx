import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalPatientSummary } from "../types";
import { getPatientSearchPlaceholder, showsPatientSpecies, usesHumanPatientsOnly } from "../utils/pos";

interface PatientSearchPanelProps {
  selectedPatientId: string;
  onSelectPatient: (patient: ClinicalPatientSummary) => void;
}

// Shared across CarnetPage/ClinicalCalendarPage/CardexPage — owns its own
// /patients fetch and text-filter state so none of the three pages duplicate
// that logic. Deliberately does NOT include the client dropdown or date-range
// filters from the old MedicalHistoryPage: those only ever fed the Carnet
// history query/PDF export, not patient selection itself, so they stay local
// to CarnetPage instead of being dragged into this shared component.
export function PatientSearchPanel({ selectedPatientId, onSelectPatient }: PatientSearchPanelProps) {
  const { token, user } = useAuth();
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [error, setError] = useState("");
  const humanPatientsOnly = usesHumanPatientsOnly(user?.pos_type);
  const showSpecies = showsPatientSpecies(user?.pos_type);

  const filteredPatients = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) =>
      `${patient.name} ${patient.client_name || ""} ${humanPatientsOnly ? `${patient.client_phone || ""} ${patient.client_email || ""}` : `${patient.species || ""} ${patient.breed || ""}`}`.toLowerCase().includes(term)
    );
  }, [humanPatientsOnly, patientSearch, patients]);

  useEffect(() => {
    if (!token) return;
    apiRequest<ClinicalPatientSummary[]>("/patients", { token })
      .then((response) => {
        setPatients(response);
        if (selectedPatientId) {
          const match = response.find((patient) => String(patient.id) === selectedPatientId);
          if (match) onSelectPatient(match);
        }
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar pacientes");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Buscar paciente</h2>
          <p className="muted">Selecciona un paciente para continuar.</p>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-section-grid">
        <label className="form-span-2">
          Buscar paciente
          <input placeholder={getPatientSearchPlaceholder(user?.pos_type)} value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
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
              <tr
                className={String(patient.id) === selectedPatientId ? "table-row-active" : ""}
                key={patient.id}
                onClick={() => onSelectPatient(patient)}
              >
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
  );
}
