import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnkodeLogo } from "../components/AnkodeLogo";
import { apiRequest } from "../api/client";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-branding">
            <AnkodeLogo className="login-logo" size="min(320px, 78vw)" variant="full" alt="ANKODE" />
            <p className="login-brand-tagline">POS SYSTEM</p>
          </div>
          <div className="login-intro">
            <h1>Enlace inválido</h1>
            <p className="muted">El enlace de recuperación no es válido o ya fue utilizado.</p>
            <p style={{ marginTop: "1.5rem" }}>
              <Link to="/forgot-password" className="button" style={{ display: "inline-block" }}>
                Solicitar nuevo enlace
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: newPassword })
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible restablecer la contraseña");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-branding">
            <AnkodeLogo className="login-logo" size="min(320px, 78vw)" variant="full" alt="ANKODE" />
            <p className="login-brand-tagline">POS SYSTEM</p>
          </div>
          <div className="login-intro">
            <h1>Contraseña actualizada</h1>
            <p className="muted">Tu contraseña fue restablecida correctamente. Ya puedes iniciar sesión.</p>
            <p style={{ marginTop: "1.5rem" }}>
              <Link to="/login" className="button" style={{ display: "inline-block" }}>
                Iniciar sesión
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-branding">
          <AnkodeLogo className="login-logo" size="min(320px, 78vw)" variant="full" alt="ANKODE" />
          <p className="login-brand-tagline">POS SYSTEM</p>
        </div>
        <div className="login-intro">
          <h1>Nueva contraseña</h1>
          <p className="muted">Elige una contraseña segura de al menos 8 caracteres.</p>
        </div>
        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Nueva contraseña
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label>
            Confirmar contraseña
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="button login-button" disabled={loading} type="submit">
            {loading ? "Guardando..." : "Restablecer contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
