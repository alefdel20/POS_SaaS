import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AnkodeLogo } from "../components/AnkodeLogo";
import { apiRequest } from "../api/client";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible enviar el correo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-branding">
          <AnkodeLogo className="login-logo" size="min(320px, 78vw)" variant="full" alt="ANKODE" />
          <p className="login-brand-tagline">POS SYSTEM</p>
        </div>

        {submitted ? (
          <div className="login-intro">
            <h1>Revisa tu correo</h1>
            <p className="muted">
              Si el correo está registrado, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
            </p>
            <p style={{ marginTop: "1.5rem" }}>
              <Link to="/login" className="button" style={{ display: "inline-block" }}>
                Volver al inicio de sesión
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="login-intro">
              <h1>¿Olvidaste tu contraseña?</h1>
              <p className="muted">Ingresa tu correo y te enviaremos un enlace para restablecerla.</p>
            </div>
            <form className="grid-form" onSubmit={handleSubmit}>
              <label>
                Correo electrónico
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              {error ? <p className="error-text">{error}</p> : null}
              <button className="button login-button" disabled={loading} type="submit">
                {loading ? "Enviando..." : "Enviar enlace"}
              </button>
              <p style={{ textAlign: "center", marginTop: "0.5rem", fontSize: "0.875rem" }}>
                <Link to="/login">Volver al inicio de sesión</Link>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
