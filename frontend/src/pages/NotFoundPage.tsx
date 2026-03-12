import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="screen-center">
      <div className="panel">
        <h2>Pagina no encontrada</h2>
        <p className="muted">La ruta solicitada no existe en este POS.</p>
        <Link className="button" to="/">Volver al inicio</Link>
      </div>
    </div>
  );
}
