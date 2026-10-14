import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Rueda del mouse sobre un input numerico enfocado: el navegador suma/resta el
// step (cambiaba precios sin querer). Quitar el foco evita el cambio y deja
// que la pagina haga scroll normal.
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
}, { passive: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
