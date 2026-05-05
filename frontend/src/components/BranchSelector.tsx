import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface Branch {
  id: number;
  name: string;
  is_active: boolean;
}

export function BranchSelector() {
  const { token, user, activeBranchId, setActiveBranchId } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest<Branch[]>("/branches", { token })
      .then((data) => {
        if (!cancelled) setBranches(data.filter((b) => b.is_active));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  if (branches.length < 2) return null;

  const role = user?.role;
  const canSwitch = role === "admin" || role === "superusuario";

  if (!canSwitch) {
    const branch = branches.find((b) => b.id === activeBranchId);
    return branch ? <span className="header-branch-name">{branch.name}</span> : null;
  }

  return (
    <select
      className="branch-selector"
      value={activeBranchId ?? ""}
      onChange={(e) => setActiveBranchId(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Todas las sucursales</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}
