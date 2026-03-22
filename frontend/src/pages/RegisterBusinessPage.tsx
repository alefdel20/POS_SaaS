import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AnkodeLogo } from "../components/AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import type { BusinessType } from "../types";
import { getDefaultRouteForRole } from "../utils/roles";

const BUSINESS_TYPE_OPTIONS: Array<{ value: BusinessType; label: string }> = [
  { value: "Tienda", label: "Tienda" },
  { value: "Tlapaleria", label: "Tlapaleria" },
  { value: "Farmacia", label: "Farmacia" },
  { value: "Veterinaria", label: "Veterinaria" },
  { value: "Otro", label: "Otro" }
];

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador" },
  { value: "superusuario", label: "Superusuario" }
];

const initialForm = {
  full_name: "",
  business_name: "",
  username: "",
  email: "",
  password: "",
  role: "admin" as const,
  business_type: "Tienda" as BusinessType,
  pos_type: ""
};

export function RegisterBusinessPage() {
  const { registerBusiness, user } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const requiresManualPosType = form.business_type === "Otro";
  const resolvedPosType = useMemo(
    () => (requiresManualPosType ? form.pos_type.trim() : form.business_type),
    [form.business_type, form.pos_type, requiresManualPosType]
  );

  if (user) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await registerBusiness({
        ...form,
        pos_type: resolvedPosType
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el negocio");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card auth-card-wide">
        <div className="login-branding">
          <AnkodeLogo className="login-logo" size="min(320px, 78vw)" variant="full" alt="ANKODE" />
          <p className="login-brand-tagline">POS SYSTEM</p>
        </div>
        <div className="login-intro">
          <p className="eyebrow">Onboarding</p>
          <h1>Alta de negocio y usuario principal</h1>
          <p className="muted">El negocio real se crea primero y tu usuario queda ligado a ese tenant desde el primer momento.</p>
        </div>
        <form className="grid-form auth-grid-form" onSubmit={handleSubmit}>
          <label>
            Nombre completo *
            <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
          </label>
          <label>
            Nombre del Negocio *
            <input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} required />
          </label>
          <label>
            Usuario *
            <input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </label>
          <label>
            Correo electronico *
            <input autoComplete="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>
            Contrasena *
            <input autoComplete="new-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          <label>
            Rol *
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "admin" | "superusuario" })}>
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Tipo de Negocio *
            <select
              value={form.business_type}
              onChange={(event) => setForm({
                ...form,
                business_type: event.target.value as BusinessType,
                pos_type: event.target.value === "Otro" ? form.pos_type : ""
              })}
            >
              {BUSINESS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Tipo de POS asignado
            <input value={resolvedPosType} readOnly disabled />
          </label>
          {requiresManualPosType ? (
            <label className="form-span-2">
              Especifique Tipo de POS *
              <input value={form.pos_type} onChange={(event) => setForm({ ...form, pos_type: event.target.value })} required />
            </label>
          ) : null}
          {error ? <p className="error-text form-span-2">{error}</p> : null}
          <button className="button login-button form-span-2" disabled={loading} type="submit">
            {loading ? "Creando negocio..." : "Crear negocio"}
          </button>
        </form>
        <div className="auth-footer-links">
          <span className="muted">Ya tienes acceso?</span>
          <Link className="auth-text-link" to="/login">Iniciar sesion</Link>
        </div>
      </div>
    </div>
  );
}
