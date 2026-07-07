import { useState } from "react";
import { apiRequest } from "../api/client";
import { NameAutocomplete, NameAutocompleteValue } from "./NameAutocomplete";

interface AssignPatientResponsibleProps {
  token: string | null;
  patientId: number;
  onAssigned: () => void;
}

const emptyValue: NameAutocompleteValue = { id: null, name: "" };

// Quick "asignar responsable" affordance for a patient created without one
// (rescued animal pending adoption, etc — client_id is optional at creation,
// see clinicalService.buildPatientPayload). Reuses PUT /patients/:id, which
// accepts client_id (existing) or client_name (created inline, inside the
// same transaction as the update — see resolveOrCreateClientId).
export function AssignPatientResponsible({ token, patientId, onAssigned }: AssignPatientResponsibleProps) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState<NameAutocompleteValue>(emptyValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAssign() {
    if (!token) return;
    const name = value.name.trim();
    if (!value.id && !(value.confirmedNew && name)) {
      setError("Selecciona un responsable existente o confirma la creación de uno nuevo con “Crear como cliente nuevo”.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/patients/${patientId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(value.id ? { client_id: value.id } : { client_name: name })
      });
      setExpanded(false);
      setValue(emptyValue);
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
      <NameAutocomplete kind="client" label="Responsable" onChange={setValue} token={token} value={value} />
      <div className="inline-actions">
        <button className="button" disabled={saving || (!value.id && !(value.confirmedNew && value.name.trim()))} onClick={handleAssign} type="button">
          {saving ? "Asignando..." : "Asignar"}
        </button>
        <button className="button ghost" onClick={() => { setExpanded(false); setValue(emptyValue); }} type="button">Cancelar</button>
      </div>
    </div>
  );
}
