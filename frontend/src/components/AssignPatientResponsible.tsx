import { useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary } from "../types";
import { ClientPicker } from "./ClientPicker";

interface AssignPatientResponsibleProps {
  token: string | null;
  patientId: number;
  onAssigned: () => void;
}

// Quick "asignar responsable" affordance for a patient created without one
// (rescued animal pending adoption, etc — client_id is optional at creation,
// see clinicalService.buildPatientPayload). Reuses PUT /patients/:id, which
// now persists client_id, instead of a dedicated endpoint.
export function AssignPatientResponsible({ token, patientId, onAssigned }: AssignPatientResponsibleProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAssign(client: ClinicalClientSummary) {
    if (!token) return;
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/patients/${patientId}`, {
        method: "PUT",
        token,
        body: JSON.stringify({ client_id: client.id })
      });
      setExpanded(false);
      onAssigned();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "No fue posible asignar el responsable");
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <>
        Sin responsable —{" "}
        <button className="button ghost btn-link" onClick={() => setExpanded(true)} type="button">asignar</button>
      </>
    );
  }

  return (
    <div className="info-card">
      {error ? <p className="error-text">{error}</p> : null}
      {saving ? <p className="muted">Asignando...</p> : null}
      <ClientPicker label="Asignar responsable" onClear={() => setExpanded(false)} onSelect={handleAssign} token={token} value={null} />
      <div className="inline-actions">
        <button className="button ghost" onClick={() => setExpanded(false)} type="button">Cancelar</button>
      </div>
    </div>
  );
}
