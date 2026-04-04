import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AnkodeLogo } from "../components/AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import type { BusinessType } from "../types";
import { getDefaultRouteForRole } from "../utils/roles";
import { POS_TYPE_OPTIONS, getPosTypeLabel } from "../utils/pos";
import { apiRequest } from "../api/client";

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
  pos_type: "Tienda" as BusinessType
};

export function RegisterBusinessPage() {
  const navigate = useNavigate();
  const { registerBusiness, user } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedPosType = useMemo(() => form.pos_type, [form.pos_type]);

  if (user) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
  }

  function canContinueCurrentStep() {
    if (step === 1) {
      return Boolean(form.full_name.trim() && form.username.trim() && form.email.trim() && form.password.trim());
    }
    if (step === 2) {
      return Boolean(form.business_name.trim() && form.pos_type);
    }
    return true;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await registerBusiness({
        ...form,
        business_type: selectedPosType,
        pos_type: selectedPosType
      });

      await apiRequest("/onboarding/setup", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          pos_type: selectedPosType
        })
      });

      navigate(getDefaultRouteForRole(session.user.role), { replace: true });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible completar el onboarding");
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
          <h1>Alta inicial del negocio</h1>
          <p className="muted">Completa tres pasos y el tenant quedará listo con su configuración base.</p>
        </div>
        <div className="inline-actions">
          <span className={step === 1 ? "success-text" : "muted"}>1. Cuenta</span>
          <span className={step === 2 ? "success-text" : "muted"}>2. Negocio</span>
          <span className={step === 3 ? "success-text" : "muted"}>3. Confirmar</span>
        </div>
        <form className="grid-form auth-grid-form" onSubmit={handleSubmit}>
          {step === 1 ? (
            <>
              <label>
                Nombre completo *
                <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
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
              <label className="form-span-2">
                Rol principal *
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "admin" | "superusuario" })}>
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <label className="form-span-2">
                Nombre del negocio *
                <input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} required />
              </label>
              <label className="form-span-2">
                Tipo de negocio / POS *
                <select
                  value={form.pos_type}
                  onChange={(event) => setForm({
                    ...form,
                    business_type: event.target.value as BusinessType,
                    pos_type: event.target.value as BusinessType
                  })}
                >
                  {POS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="info-card form-span-2">
                <h3>Base inicial que se configurará</h3>
                <p>Unidades por defecto: pieza, kg, litro y caja.</p>
                <p>Corte Diario quedará activo para este giro.</p>
                <p>Crédito y Cobranza: {selectedPosType === "Dentista" ? "no disponible" : "disponible"}.</p>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <div className="info-card form-span-2">
              <h3>Resumen</h3>
              <p>Responsable: {form.full_name || "-"}</p>
              <p>Usuario: {form.username || "-"}</p>
              <p>Negocio: {form.business_name || "-"}</p>
              <p>Giro: {getPosTypeLabel(selectedPosType)}</p>
              <p>Rol principal: {ROLE_OPTIONS.find((option) => option.value === form.role)?.label}</p>
            </div>
          ) : null}

          {error ? <p className="error-text form-span-2">{error}</p> : null}
          <div className="inline-actions form-span-2">
            {step > 1 ? (
              <button className="button ghost" onClick={() => setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)} type="button">
                Anterior
              </button>
            ) : null}
            {step < 3 ? (
              <button className="button login-button" disabled={!canContinueCurrentStep()} onClick={() => setStep((current) => Math.min(3, current + 1) as 1 | 2 | 3)} type="button">
                Siguiente
              </button>
            ) : (
              <button className="button login-button" disabled={loading} type="submit">
                {loading ? "Configurando negocio..." : "Crear y configurar negocio"}
              </button>
            )}
          </div>
        </form>
        <div className="auth-footer-links">
          <span className="muted">Ya tienes acceso?</span>
          <Link className="auth-text-link" to="/login">Iniciar sesion</Link>
        </div>
      </div>
    </div>
  );
}
