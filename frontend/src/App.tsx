import { useEffect } from "react";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { AppRouter } from "./router/AppRouter";

function RetailThemeSync() {
  const { user } = useAuth();

  useEffect(() => {
    document.documentElement.dataset.posType = user?.pos_type || "Otro";
  }, [user?.pos_type]);

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
