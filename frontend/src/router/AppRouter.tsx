import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuth } from "../context/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { ClientsPage } from "../pages/ClientsPage";
import { CreditCollectionsPage } from "../pages/CreditCollectionsPage";
import { DailyCutPage } from "../pages/DailyCutPage";
import { FinancesPage } from "../pages/FinancesPage";
import { LoginPage } from "../pages/LoginPage";
import { MedicalAppointmentsPage } from "../pages/MedicalAppointmentsPage";
import { MedicalConsultationsPage } from "../pages/MedicalConsultationsPage";
import { MedicalHistoryPage } from "../pages/MedicalHistoryPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PatientsPage } from "../pages/PatientsPage";
import { ProfilePage } from "../pages/ProfilePage";
import { ProductsPage } from "../pages/ProductsPage";
import { ProductUpdateRequestsPage } from "../pages/ProductUpdateRequestsPage";
import { RegisterBusinessPage } from "../pages/RegisterBusinessPage";
import { RematePage } from "../pages/RematePage";
import { RemindersPage } from "../pages/RemindersPage";
import { SalesHistoryPage } from "../pages/SalesHistoryPage";
import { SalesPage } from "../pages/SalesPage";
import { ServicesPage } from "../pages/ServicesPage";
import { UsersPage } from "../pages/UsersPage";
import { SuppliersPage } from "../pages/SuppliersPage";
import { BusinessesPage } from "../pages/BusinessesPage";
import { InvoicesPage } from "../pages/InvoicesPage";
import { getDefaultRouteForRole, ROUTE_ROLES } from "../utils/roles";
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
        <Route path="/register-business" element={<RegisterBusinessPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<RoleHomeRedirect />} />
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.sales]} />}>
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/product-update-requests" element={<ProductUpdateRequestsPage />} />
            </Route>
            <Route path="/reminders" element={<RemindersPage />} />
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.users]} />}>
              <Route path="/users" element={<UsersPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.dailyCut]} />}>
              <Route path="/daily-cut" element={<DailyCutPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.management]} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/remate" element={<RematePage />} />
              <Route path="/sales-history" element={<SalesHistoryPage />} />
              <Route path="/credit-collections" element={<CreditCollectionsPage />} />
              <Route path="/finances" element={<FinancesPage />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/medical-appointments" element={<MedicalAppointmentsPage />} />
              <Route path="/medical-consultations" element={<MedicalConsultationsPage />} />
              <Route path="/medical-history" element={<MedicalHistoryPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.invoices]} />}>
              <Route path="/invoices" element={<InvoicesPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.businesses]} />}>
              <Route path="/businesses" element={<BusinessesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
