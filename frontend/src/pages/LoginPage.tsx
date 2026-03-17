import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { AnkodeLogo } from "../components/AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { getDefaultRouteForRole } from "../utils/roles";

export function LoginPage() {
  const { login, user } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(identifier, password);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible iniciar sesion");
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
        <div className="login-intro">
          <p className="eyebrow">POS MVP</p>
          <h1>Control de ventas con estilo oscuro</h1>
          <p className="muted">Accede con usuario o correo para operar caja, inventario y recordatorios.</p>
        </div>
        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Usuario o correo
            <input
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            Contrasena
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="button login-button" disabled={loading} type="submit">
            {loading ? "Entrando..." : "Iniciar sesion"}
          </button>
        </form>
      </div>
    </div>
  );
}
