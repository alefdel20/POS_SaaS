import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
}

function closeTopmostModal(): boolean {
  const backdrops = document.querySelectorAll<HTMLElement>(".modal-backdrop");
  if (backdrops.length === 0) return false;

  const topModal = backdrops[backdrops.length - 1];
  const closeButton = topModal.querySelector<HTMLButtonElement>(
    ".panel-header .button.ghost, .modal-actions-end .button.ghost"
  );
  if (closeButton) {
    closeButton.click();
    return true;
  }
  return false;
}

export function useHotkeys() {
  const navigate = useNavigate();
  const [showOverlay, setShowOverlay] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        event.preventDefault();
        setShowOverlay(true);
        return;
      }

      if (event.key === "Escape") {
        const closed = closeTopmostModal();
        if (!closed) {
          const sidebar = document.getElementById("app-sidebar");
          if (sidebar?.classList.contains("open")) {
            const overlay = document.querySelector<HTMLElement>(".sidebar-overlay");
            overlay?.click();
          }
        }
        return;
      }

      if (isInputFocused()) return;

      switch (event.key) {
        case "F1":
          event.preventDefault();
          navigate("/sales");
          break;
        case "F2":
          event.preventDefault();
          navigate("/products");
          break;
        case "F3":
          event.preventDefault();
          navigate("/daily-cut");
          break;
        case "F4":
          event.preventDefault();
          navigate("/credit-collections");
          break;
        case "F5":
          event.preventDefault();
          document.querySelector<HTMLInputElement>(".search-input")?.focus();
          break;
        case "F6": {
          event.preventDefault();
          const debtorInput = document.querySelector<HTMLInputElement>('[list="debtor-suggestions"]');
          if (debtorInput) {
            debtorInput.focus();
          }
          break;
        }
        case "F8": {
          event.preventDefault();
          const discountSelect = document.querySelector<HTMLSelectElement>(".sales-actions select");
          if (discountSelect) {
            discountSelect.focus();
          }
          break;
        }
        case "F9": {
          event.preventDefault();
          const finalizeBtn = document.querySelector<HTMLButtonElement>(".sales-actions > .button:not(.ghost)");
          if (finalizeBtn && !finalizeBtn.disabled) {
            finalizeBtn.click();
          }
          break;
        }
      }
    },
    [navigate]
  );

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.key === "Alt") {
      setShowOverlay(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return { showOverlay };
}
