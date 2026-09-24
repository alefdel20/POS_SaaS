import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { HotkeysOverlay } from "../components/HotkeysOverlay";
import { OnboardingTour, type OnboardingTourHandle } from "../components/OnboardingTour";
import { WhatsNewModal } from "../components/WhatsNewModal";
import { useAuth } from "../context/AuthContext";
import { useHotkeys } from "../hooks/useHotkeys";
import { isBundleSkipped } from "../services/storage";
import type { OnboardingBundleResponse } from "../types";
import { ROLE_ADMIN, normalizeRole } from "../utils/roles";

const ONBOARDING_BUNDLE_PATH_PREFIX = "/onboarding/bundle";

export function AppLayout() {
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showOverlay } = useHotkeys();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const tourRef = useRef<OnboardingTourHandle | null>(null);
  const isAdmin = normalizeRole(user?.role) === ROLE_ADMIN;
  const isOnBundleWizard = location.pathname.startsWith(ONBOARDING_BUNDLE_PATH_PREFIX);
  // Solo admin consulta el paquete inicial; el tour espera a que se resuelva para no arrancar sobre el wizard.
  const [bundleChecked, setBundleChecked] = useState(false);
  const shouldAutoStart = Boolean(user && user.tutorial_seen === false && (!isAdmin || bundleChecked) && !isOnBundleWizard);
  const hasRailSidebar = user?.pos_type === "Veterinaria";
  // El rail solo ocupa espacio propio cuando esta visible; mientras el panel esta
  // abierto el rail se oculta (ver VeterinariaSidebarRail) y no hay que reservarle margen.
  const isRailVisible = hasRailSidebar && !isSidebarOpen;
  const isSidebarVisible = isSidebarOpen;

  const releaseSidebarFocus = useCallback(() => {
    const sidebar = document.getElementById("app-sidebar");
    const activeElement = document.activeElement;
    if (!sidebar || !(activeElement instanceof HTMLElement) || !sidebar.contains(activeElement)) {
      return;
    }

    if (menuToggleRef.current && !menuToggleRef.current.disabled) {
      menuToggleRef.current.focus();
      return;
    }

    if (document.body instanceof HTMLElement) {
      document.body.focus();
    }
  }, []);

  const closeSidebar = useCallback(() => {
    releaseSidebarFocus();
    setIsSidebarOpen(false);
  }, [releaseSidebarFocus]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((current) => {
      if (current) {
        releaseSidebarFocus();
      }
      return !current;
    });
  }, [releaseSidebarFocus]);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  useEffect(() => {
    closeSidebar();
  }, [closeSidebar, location.pathname]);

  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    // Entrada directa al wizard: el Paso 1 hace su propio GET, no duplicarlo aqui.
    if (location.pathname.startsWith(ONBOARDING_BUNDLE_PATH_PREFIX) || isBundleSkipped(user.business_id)) {
      setBundleChecked(true);
      return;
    }

    let cancelled = false;
    apiRequest<OnboardingBundleResponse>("/onboarding/bundle", { token })
      .then((bundle) => {
        if (cancelled) return;
        if (bundle.needsBundle) {
          navigate(ONBOARDING_BUNDLE_PATH_PREFIX, { replace: true, state: { bundle } });
        }
      })
      .catch(() => {
        // Sin paquete disponible (red, negocio sin contexto): seguir con el dashboard normal.
      })
      .finally(() => {
        if (!cancelled) setBundleChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // Una consulta por sesion de usuario; no se repite en cada cambio de ruta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user?.id, token]);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    function handleScroll() {
      const currentY = window.scrollY;
      const header = document.querySelector<HTMLElement>(".header");
      if (!header) return;

      if (currentY > lastScrollY && currentY > 80) {
        header.classList.add("header-hidden");
      } else if (currentY < lastScrollY) {
        header.classList.remove("header-hidden");
      }
      lastScrollY = currentY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSidebar();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSidebar, isSidebarOpen]);

  return (
    <div className={`app-shell ${isRailVisible ? "has-rail-sidebar" : ""}`}>
      <Sidebar isOpen={isSidebarVisible} onClose={closeSidebar} onOpen={openSidebar} />
      {isSidebarOpen ? <div aria-hidden="true" className="sidebar-overlay" onClick={closeSidebar} /> : null}
      <div className="app-main">
        <Header isSidebarOpen={isSidebarVisible} menuToggleRef={menuToggleRef} onMenuToggle={toggleSidebar} showMenuToggle={!hasRailSidebar} />
        <main className="content">
          <Outlet />
        </main>
      </div>
      {user ? <OnboardingTour autoStart={shouldAutoStart} ref={tourRef} /> : null}
      <WhatsNewModal />
      <HotkeysOverlay visible={showOverlay} />
    </div>
  );
}
