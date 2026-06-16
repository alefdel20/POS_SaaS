import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../api/client";

export function useCfdiAddon() {
  const { token } = useAuth();
  const [cfdiAddonActive, setCfdiAddonActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest<{ addon?: { status?: string } }>("/cfdi/status", { token })
      .then((data) => setCfdiAddonActive(data?.addon?.status === "active"))
      .catch(() => setCfdiAddonActive(false));
  }, [token]);

  return { cfdiAddonActive };
}
