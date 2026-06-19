interface HotkeysOverlayProps {
  visible: boolean;
}

const HOTKEYS = [
  { key: "F1", label: "Ventas" },
  { key: "F2", label: "Inventario" },
  { key: "F3", label: "Corte Diario" },
  { key: "F4", label: "Deudores" },
  { key: "F5", label: "Buscar producto" },
  { key: "F6", label: "Seleccionar cliente" },
  { key: "F8", label: "Descuento del carrito" },
  { key: "F9", label: "Finalizar venta" },
  { key: "Esc", label: "Cerrar modal" },
  { key: "Alt", label: "Mostrar atajos" }
];

export function HotkeysOverlay({ visible }: HotkeysOverlayProps) {
  if (!visible) return null;

  return (
    <div className="hotkeys-overlay" aria-live="polite">
      <div className="hotkeys-overlay-card">
        <h3>Atajos de teclado</h3>
        <div className="hotkeys-list">
          {HOTKEYS.map((item) => (
            <div className="hotkey-row" key={item.key}>
              <kbd>{item.key}</kbd>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
