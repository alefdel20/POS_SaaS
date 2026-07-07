import { FormEvent, useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary, ClinicalPatientSummary } from "../types";
import { showsPatientSpecies } from "../utils/pos";
import { ClientPicker } from "./ClientPicker";

interface PatientQuickCreateModalProps {
  token: string | null;
  posType?: string | null;
  initialName?: string;
  onClose: () => void;
  onCreated: (patient: ClinicalPatientSummary, client: ClinicalClientSummary) => void;
}

type FormState = {
  name: string;
  phone: string;
  species: string;
  breed: string;
  sex: string;
  birth_date: string;
  weight: string;
  allergies: string;
  notes: string;
};

export function PatientQuickCreateModal({ token, posType, initialName = "", onClose, onCreated }: PatientQuickCreateModalProps) {
  const showSpecies = showsPatientSpecies(posType);
  const [form, setForm] = useState<FormState>({
    name: initialName,
    phone: "",
    species: "",
    breed: "",
    sex: "Masculino",
    birth_date: "",
    weight: "",
    allergies: "",
    notes: ""
  });
  const [client, setClient] = useState<ClinicalClientSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!form.name.trim()) {
      setError("El nombre del paciente es obligatorio");
      return;
    }
    if (!client) {
      setError("Selecciona el responsable del paciente");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const created = await apiRequest<ClinicalPatientSummary>("/patients", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...form,
          species: showSpecies ? form.species : "",
          breed: showSpecies ? form.breed : "",
          weight: form.weight ? Number(form.weight) : null,
          phone: form.phone.trim() || null,
          client_id: client.id
        })
      });
      onCreated(created, client);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible crear el paciente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" style={{ maxWidth: "640px", width: "95vw" }}>
        <div className="panel-header">
          <div>
            <h3>Crear paciente</h3>
            <p className="muted">Se crea sin salir de la cita y queda seleccionado automaticamente.</p>
          </div>
          <button className="button ghost" onClick={onClose} type="button">Cerrar</button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Nombre *
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Telefono
            <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
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
              <option value="Masculino">Masculino</option>
              <option value="Femenino">Femenino</option>
              <option value="Otro">Otro</option>
            </select>
          </label>
          <label>
            Fecha de nacimiento
            <input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} />
          </label>
          <label>
            Peso
            <input min="0" step="0.001" type="number" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} />
          </label>
          <ClientPicker label="Responsable *" onClear={() => setClient(null)} onSelect={setClient} token={token} value={client} />
          <label className="form-span-2">
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions form-span-2">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Crear paciente"}</button>
            <button className="button ghost" onClick={onClose} type="button">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
