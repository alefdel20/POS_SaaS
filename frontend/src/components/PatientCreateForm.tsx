import { FormEvent, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalPatientSummary } from "../types";
import { showsPatientSpecies } from "../utils/pos";
import { NameAutocomplete, NameAutocompleteValue } from "./NameAutocomplete";

type PatientFormState = {
  name: string;
  phone: string;
  species: string;
  breed: string;
  sex: string;
  birth_date: string;
  weight: string;
  allergies: string;
  notes: string;
  is_active: boolean;
};

const emptyForm: PatientFormState = {
  name: "",
  phone: "",
  species: "",
  breed: "",
  sex: "Macho",
  birth_date: "",
  weight: "",
  allergies: "",
  notes: "",
  is_active: true
};

interface PatientCreateFormProps {
  onCreated: (patient: ClinicalPatientSummary) => void;
  onCancel?: () => void;
}

// Extracted from PatientsPage.tsx's "create" mode (the only full patient
// registration form in the app) so it can also be embedded inside
// PatientSearchPanel.tsx — PatientsPage.tsx now delegates to this component
// for its own create mode instead of keeping a second copy.
export function PatientCreateForm({ onCreated, onCancel }: PatientCreateFormProps) {
  const { token, user } = useAuth();
  const [form, setForm] = useState<PatientFormState>(emptyForm);
  const [clientValue, setClientValue] = useState<NameAutocompleteValue>({ id: null, name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const showSpecies = showsPatientSpecies(user?.pos_type);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      setError("");
      const clientName = clientValue.name.trim();
      const payload = {
        ...form,
        species: showSpecies ? form.species : "",
        breed: showSpecies ? form.breed : "",
        weight: form.weight ? Number(form.weight) : null,
        phone: form.phone.trim() || null,
        allergies: form.allergies,
        is_active: form.is_active,
        ...(clientValue.id ? { client_id: clientValue.id } : {}),
        // Unconfirmed free text is dropped, not sent — same rule as
        // NameAutocomplete's own contract: the user must click "Crear como
        // cliente nuevo" first, so a stray unmatched search doesn't silently
        // create a duplicate client.
        ...(!clientValue.id && clientValue.confirmedNew && clientName ? { client_name: clientName } : {})
      };
      const response = await apiRequest<ClinicalPatientSummary>("/patients", {
        method: "POST",
        token,
        body: JSON.stringify(payload)
      });
      setForm(emptyForm);
      setClientValue({ id: null, name: "" });
      onCreated(response);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible guardar el paciente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid-form" onSubmit={handleSubmit}>
      {error ? <p className="error-text">{error}</p> : null}
      <label>
        Nombre Completo *
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      </label>
      <label>
        Teléfono
        <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      </label>
      <NameAutocomplete kind="client" label="Responsable" onChange={setClientValue} token={token} value={clientValue} />
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
        <select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}>
          <option value="Macho">Macho</option>
          <option value="Hembra">Hembra</option>
        </select>
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
        <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Crear paciente"}</button>
        {onCancel ? <button className="button ghost" onClick={onCancel} type="button">Cancelar</button> : null}
      </div>
    </form>
  );
}
