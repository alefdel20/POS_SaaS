import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";

export function AppLayout() {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    closeSidebar();
  }, [closeSidebar, location.pathname]);

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
    <div className="app-shell">
      <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} />
      {isSidebarOpen ? <div aria-hidden="true" className="sidebar-overlay" onClick={closeSidebar} /> : null}
      <div className="app-main">
        <Header isSidebarOpen={isSidebarOpen} menuToggleRef={menuToggleRef} onMenuToggle={toggleSidebar} />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
