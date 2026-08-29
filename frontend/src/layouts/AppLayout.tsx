import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { HotkeysOverlay } from "../components/HotkeysOverlay";
import { OnboardingTour, type OnboardingTourHandle } from "../components/OnboardingTour";
import { WhatsNewModal } from "../components/WhatsNewModal";
import { useAuth } from "../context/AuthContext";
import { useHotkeys } from "../hooks/useHotkeys";
import { useMediaQuery } from "../hooks/useMediaQuery";

export function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const { showOverlay } = useHotkeys();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const tourRef = useRef<OnboardingTourHandle | null>(null);
  const shouldAutoStart = Boolean(user && user.tutorial_seen === false);
  const hasRailSidebar = user?.pos_type === "Veterinaria";
  // El rail solo ocupa espacio propio cuando esta visible; mientras el panel esta
  // abierto el rail se oculta (ver VeterinariaSidebarRail) y no hay que reservarle margen.
  const isRailVisible = hasRailSidebar && !isSidebarOpen;
  const isDesktopPush = useMediaQuery("(min-width: 1024px)");
  // En >=1024px el sidebar legacy (no-Veterinaria) pasa a push-layout permanente:
  // siempre visible, sin overlay. El rail de Veterinaria no se fuerza a abrirse -
  // su colapsado/expandido sigue dependiendo solo de isSidebarOpen, igual que hoy.
  const isPushSidebarForced = isDesktopPush && !hasRailSidebar;
  const isSidebarVisible = isSidebarOpen || isPushSidebarForced;

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
    <div className={`app-shell ${isRailVisible ? "has-rail-sidebar" : ""} ${isDesktopPush && isSidebarVisible ? "sidebar-push-open" : ""}`}>
      <Sidebar isOpen={isSidebarVisible} onClose={closeSidebar} onOpen={openSidebar} />
      {isSidebarOpen && !isDesktopPush ? <div aria-hidden="true" className="sidebar-overlay" onClick={closeSidebar} /> : null}
      <div className="app-main">
        <Header isSidebarOpen={isSidebarVisible} menuToggleRef={menuToggleRef} onMenuToggle={toggleSidebar} showMenuToggle={!hasRailSidebar && !isDesktopPush} />
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
