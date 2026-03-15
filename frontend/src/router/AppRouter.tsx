import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuth } from "../context/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { CreditCollectionsPage } from "../pages/CreditCollectionsPage";
import { DailyCutPage } from "../pages/DailyCutPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProductsPage } from "../pages/ProductsPage";
import { RemindersPage } from "../pages/RemindersPage";
import { SalesHistoryPage } from "../pages/SalesHistoryPage";
import { SalesPage } from "../pages/SalesPage";
import { UsersPage } from "../pages/UsersPage";
import { getDefaultRouteForRole } from "../utils/roles";
import { Navigate } from "react-router-dom";

function RoleHomeRedirect() {
  const { user } = useAuth();

  return <Navigate replace to={getDefaultRouteForRole(user?.role)} />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<RoleHomeRedirect />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route element={<ProtectedRoute roles={["superadmin", "admin"]} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/sales-history" element={<SalesHistoryPage />} />
              <Route path="/credit-collections" element={<CreditCollectionsPage />} />
              <Route path="/daily-cut" element={<DailyCutPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
