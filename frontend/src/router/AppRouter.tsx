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
import { ROUTE_ROLES } from "../utils/roles";
import { getDefaultRouteForUser } from "../utils/navigation";
import { Navigate } from "react-router-dom";

function RoleHomeRedirect() {
  const { user } = useAuth();

  return <Navigate replace to={getDefaultRouteForUser(user?.role, user?.pos_type)} />;
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
              <Route path="/retail/sales" element={<SalesPage />} />
              <Route path="/health/sales/accessories" element={<SalesPage />} />
              <Route path="/health/sales/medications" element={<SalesPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.management, "cajero"]} posTypes={["FarmaciaConsultorio"]} />}>
              <Route path="/health/products/medications" element={<ProductsPage />} />
              <Route path="/health/products/medications/new" element={<ProductsPage />} />
              <Route path="/health/products/medications/restock" element={<ProductsPage />} />
            </Route>
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/reminders/new" element={<RemindersPage />} />
            <Route path="/reminders/calendar" element={<RemindersPage />} />
            <Route path="/retail/admin/reminders" element={<RemindersPage />} />
            <Route path="/retail/admin/reminders/new" element={<RemindersPage />} />
            <Route path="/retail/admin/reminders/calendar" element={<RemindersPage />} />
            <Route path="/health/admin/reminders" element={<RemindersPage />} />
            <Route path="/health/admin/reminders/new" element={<RemindersPage />} />
            <Route path="/health/admin/reminders/calendar" element={<RemindersPage />} />
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.users]} />}>
              <Route path="/users" element={<UsersPage />} />
              <Route path="/retail/admin/users" element={<UsersPage />} />
              <Route path="/health/admin/users" element={<UsersPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.dailyCut]} />}>
              <Route path="/daily-cut" element={<DailyCutPage />} />
              <Route path="/retail/admin/daily-cut" element={<DailyCutPage />} />
              <Route path="/health/admin/daily-cut" element={<DailyCutPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.management, ...ROUTE_ROLES.clinical]} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/retail/admin/summary" element={<DashboardPage />} />
              <Route path="/health/admin/summary" element={<DashboardPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.sales, ...ROUTE_ROLES.management]} />}>
              <Route path="/product-update-requests" element={<ProductUpdateRequestsPage />} />
              <Route path="/retail/admin/approvals" element={<ProductUpdateRequestsPage />} />
              <Route path="/health/admin/approvals" element={<ProductUpdateRequestsPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.management, "clinico"]} />}>
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/retail/admin/profile" element={<ProfilePage />} />
              <Route path="/health/admin/profile" element={<ProfilePage />} />
              <Route path="/health/doctor/profile" element={<ProfilePage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/new" element={<ProductsPage />} />
              <Route path="/products/restock" element={<ProductsPage />} />
              <Route path="/retail/products" element={<ProductsPage />} />
              <Route path="/retail/products/new" element={<ProductsPage />} />
              <Route path="/retail/products/restock" element={<ProductsPage />} />
              <Route path="/health/products/accessories" element={<ProductsPage />} />
              <Route path="/health/products/accessories/new" element={<ProductsPage />} />
              <Route path="/health/products/accessories/restock" element={<ProductsPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/retail/suppliers" element={<SuppliersPage />} />
              <Route path="/health/suppliers/accessories" element={<SuppliersPage />} />
              <Route path="/health/suppliers/medications" element={<SuppliersPage />} />
              <Route path="/remate" element={<RematePage />} />
              <Route path="/sales-history" element={<SalesHistoryPage />} />
              <Route path="/retail/history" element={<SalesHistoryPage />} />
              <Route path="/credit-collections" element={<CreditCollectionsPage />} />
              <Route path="/retail/admin/credit-collections" element={<CreditCollectionsPage />} />
              <Route path="/health/admin/credit-collections" element={<CreditCollectionsPage />} />
              <Route path="/finances" element={<FinancesPage />} />
              <Route path="/retail/admin/finances" element={<FinancesPage />} />
              <Route path="/health/admin/finances" element={<FinancesPage />} />
              <Route path="/services" element={<ServicesPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.clinical]} />}>
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/health/clients" element={<ClientsPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/health/patients" element={<PatientsPage />} />
              <Route path="/medical-appointments" element={<MedicalAppointmentsPage />} />
              <Route path="/health/appointments/estetica" element={<MedicalAppointmentsPage />} />
              <Route path="/health/appointments/medica" element={<MedicalAppointmentsPage />} />
              <Route path="/medical-consultations" element={<MedicalConsultationsPage />} />
              <Route path="/health/consultations" element={<MedicalConsultationsPage />} />
              <Route path="/health/consultations/recetas" element={<MedicalConsultationsPage />} />
              <Route path="/medical-history" element={<MedicalHistoryPage />} />
              <Route path="/health/medical-history/carnet" element={<MedicalHistoryPage />} />
              <Route path="/health/medical-history/calendar" element={<MedicalHistoryPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.invoices]} />}>
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/retail/admin/invoices" element={<InvoicesPage />} />
              <Route path="/health/admin/invoices" element={<InvoicesPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={[...ROUTE_ROLES.businesses]} />}>
              <Route path="/businesses" element={<BusinessesPage />} />
              <Route path="/retail/admin/businesses" element={<BusinessesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
