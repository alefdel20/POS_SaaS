import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

export type ProductRowAction = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type ProductRowActionsMenuProps = {
  actions: ProductRowAction[];
  productName: string;
};

// Menu "..." por fila. Se posiciona fixed (no absolute) porque la tabla vive dentro de
// .table-wrap con overflow-x:auto, que recortaria el menu en las ultimas filas.
export function ProductRowActionsMenu({ actions, productName }: ProductRowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  function closeMenu(returnFocus = false) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const estimatedHeight = actions.length * 48 + 12;
      const opensUp = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;
      setMenuStyle({
        position: "fixed",
        right: Math.max(window.innerWidth - rect.right, 8),
        ...(opensUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 })
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;

    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
        if (items.length === 0) return;
        event.preventDefault();
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(currentIndex + step + items.length) % items.length]?.focus();
      }
    }

    // Al hacer scroll o cambiar el tamano el menu fixed quedaria desfasado del boton.
    function handleViewportChange(event: Event) {
      if (event.type === "scroll" && menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="inventory-list-menu">
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Más acciones para ${productName}`}
        className="button ghost inventory-list-menu-trigger"
        onClick={() => (open ? closeMenu() : openMenu())}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div className="inventory-list-menu-popover" id={menuId} ref={menuRef} role="menu" style={menuStyle}>
          {actions.map((action) => (
            <button
              className={`inventory-list-menu-item${action.danger ? " is-danger" : ""}`}
              disabled={action.disabled}
              key={action.key}
              // La accion corre primero, de forma sincrona dentro del clic (printBarcodeLabel
              // abre su ventana antes de cualquier await); despues se cierra el menu.
              onClick={() => {
                action.onSelect();
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
