import { FormEvent, useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary } from "../types";

interface ClientQuickCreateModalProps {
  token: string | null;
  initialName?: string;
  onClose: () => void;
  onCreated: (client: ClinicalClientSummary) => void;
}

type FormState = {
  name: string;
  phone: string;
  email: string;
  tax_id: string;
  address: string;
  notes: string;
};

export function ClientQuickCreateModal({ token, initialName = "", onClose, onCreated }: ClientQuickCreateModalProps) {
  const [form, setForm] = useState<FormState>({
    name: initialName,
    phone: "",
    email: "",
    tax_id: "",
    address: "",
    notes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!form.name.trim()) {
      setError("El nombre del cliente es obligatorio");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const created = await apiRequest<ClinicalClientSummary>("/clients", {
        method: "POST",
        token,
        body: JSON.stringify(form)
      });
      onCreated(created);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible crear el cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" style={{ maxWidth: "480px", width: "95vw" }}>
        <div className="panel-header">
          <div>
            <h3>Crear cliente</h3>
            <p className="muted">Se crea sin salir del formulario y queda seleccionado automaticamente.</p>
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
          <label>
            Correo
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            RFC / identificacion fiscal
            <input value={form.tax_id} onChange={(event) => setForm({ ...form, tax_id: event.target.value })} />
          </label>
          <label className="form-span-2">
            Direccion
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
          <label className="form-span-2">
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions form-span-2">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Crear cliente"}</button>
            <button className="button ghost" onClick={onClose} type="button">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
