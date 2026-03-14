import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";
import { getDefaultRouteForRole, normalizeRole } from "../utils/roles";

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="screen-center">Cargando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles) {
    const userRole = normalizeRole(user.role);
    const allowedRoles = roles.map((role) => normalizeRole(role));

    if (!userRole || !allowedRoles.includes(userRole)) {
      return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
    }
  }

  return <Outlet />;
}
