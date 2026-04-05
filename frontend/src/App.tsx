import { useEffect } from "react";
import { apiRequest } from "./api/client";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { getStoredTheme, setStoredTheme } from "./services/storage";
import type { CompanyProfile } from "./types";
import { AppRouter } from "./router/AppRouter";

function RetailThemeSync() {
  const { user, token } = useAuth();

  useEffect(() => {
    document.documentElement.dataset.posType = user?.pos_type || "Otro";
  }, [user?.pos_type]);

  useEffect(() => {
    if (!user?.business_id) {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.palette = "default";
      return;
    }

    const cachedTheme = getStoredTheme(user.business_id);
    document.documentElement.dataset.theme = cachedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.palette = "default";
  }, [user?.business_id]);

  useEffect(() => {
    let isCancelled = false;

    async function syncTheme() {
      if (!token || !user?.business_id) {
        return;
      }

      const profile = await apiRequest<CompanyProfile>("/profile", { token });
      const nextTheme = profile.theme === "light" ? "light" : "dark";
      const nextPalette = profile.accent_palette || "default";
      if (isCancelled) {
        return;
      }
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.dataset.palette = nextPalette;
      setStoredTheme(user.business_id, nextTheme);
    }

    syncTheme().catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [token, user?.business_id]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <RetailThemeSync />
      <AppRouter />
    </AuthProvider>
  );
}
