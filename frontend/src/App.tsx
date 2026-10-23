import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Stations from './pages/Stations';
import Products from './pages/Products';
import Dispensers from './pages/Dispensers';
import Tanks from './pages/Tanks';
import Deliveries from './pages/Deliveries';
import Devices from './pages/Devices';
import Readings from './pages/Readings';
import Shifts from './pages/Shifts';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Finance from './pages/Finance';
import Reconciliation from './pages/Reconciliation';
import Reports from './pages/Reports';
import Employees from './pages/Employees';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import AdminDashboard from './pages/admin/AdminDashboard';
import Tenants from './pages/admin/Tenants';
import TenantDetail from './pages/admin/TenantDetail';
import AdminStations from './pages/admin/AdminStations';
import Subscriptions from './pages/admin/Subscriptions';
import AdminDevices from './pages/admin/Devices';
import AdminErrors from './pages/admin/Errors';
import AdminAudit from './pages/admin/Audit';
import NotFound from './pages/NotFound';

function FullPageLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-navy-950">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7" />
        <p className="text-xs uppercase tracking-[0.2em] text-ink-500">Loading PetroFlow</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function TenantOnly({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  if (me?.isSuperAdmin) return <Navigate to="/admin" replace />;
  if (!me?.tenant) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  if (!me?.isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, me } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={me?.isSuperAdmin ? '/admin' : '/'} replace /> : <Login />}
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <TenantOnly>
              <Dashboard />
            </TenantOnly>
          }
        />
        <Route path="shifts" element={<TenantOnly><Shifts /></TenantOnly>} />
        <Route path="readings" element={<TenantOnly><Readings /></TenantOnly>} />
        <Route path="sales" element={<TenantOnly><Sales /></TenantOnly>} />
        <Route path="tanks" element={<TenantOnly><Tanks /></TenantOnly>} />
        <Route path="deliveries" element={<TenantOnly><Deliveries /></TenantOnly>} />
        <Route path="devices" element={<TenantOnly><Devices /></TenantOnly>} />
        <Route path="customers" element={<TenantOnly><Customers /></TenantOnly>} />
        <Route path="suppliers" element={<TenantOnly><Suppliers /></TenantOnly>} />
        <Route path="finance" element={<TenantOnly><Finance /></TenantOnly>} />
        <Route path="reconciliation" element={<TenantOnly><Reconciliation /></TenantOnly>} />
        <Route path="reports" element={<TenantOnly><Reports /></TenantOnly>} />
        <Route path="stations" element={<TenantOnly><Stations /></TenantOnly>} />
        <Route path="products" element={<TenantOnly><Products /></TenantOnly>} />
        <Route path="dispensers" element={<TenantOnly><Dispensers /></TenantOnly>} />
        <Route path="employees" element={<TenantOnly><Employees /></TenantOnly>} />
        <Route path="audit" element={<TenantOnly><Audit /></TenantOnly>} />
        <Route path="billing" element={<TenantOnly><Billing /></TenantOnly>} />
        <Route path="settings" element={<TenantOnly><Settings /></TenantOnly>} />

        <Route path="admin" element={<AdminOnly><AdminDashboard /></AdminOnly>} />
        <Route path="admin/tenants" element={<AdminOnly><Tenants /></AdminOnly>} />
        <Route path="admin/tenants/:id" element={<AdminOnly><TenantDetail /></AdminOnly>} />
        <Route path="admin/stations" element={<AdminOnly><AdminStations /></AdminOnly>} />
        <Route path="admin/subscriptions" element={<AdminOnly><Subscriptions /></AdminOnly>} />
        <Route path="admin/devices" element={<AdminOnly><AdminDevices /></AdminOnly>} />
        <Route path="admin/errors" element={<AdminOnly><AdminErrors /></AdminOnly>} />
        <Route path="admin/audit" element={<AdminOnly><AdminAudit /></AdminOnly>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
