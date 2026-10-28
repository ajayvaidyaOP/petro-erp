import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { EmptyState, PageLoader } from './components/ui';

// Route-level code splitting: the shell (auth, layout, routing) loads up front and
// each screen is fetched on demand, which keeps the first paint fast on forecourt
// tablets and phones instead of shipping every screen in one large bundle.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Stations = lazy(() => import('./pages/Stations'));
const Products = lazy(() => import('./pages/Products'));
const Dispensers = lazy(() => import('./pages/Dispensers'));
const Tanks = lazy(() => import('./pages/Tanks'));
const Deliveries = lazy(() => import('./pages/Deliveries'));
const Devices = lazy(() => import('./pages/Devices'));
const Readings = lazy(() => import('./pages/Readings'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Sales = lazy(() => import('./pages/Sales'));
const Customers = lazy(() => import('./pages/Customers'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Finance = lazy(() => import('./pages/Finance'));
const Reconciliation = lazy(() => import('./pages/Reconciliation'));
const Reports = lazy(() => import('./pages/Reports'));
const Employees = lazy(() => import('./pages/Employees'));
const Audit = lazy(() => import('./pages/Audit'));
const Settings = lazy(() => import('./pages/Settings'));
const Billing = lazy(() => import('./pages/Billing'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const Tenants = lazy(() => import('./pages/admin/Tenants'));
const TenantDetail = lazy(() => import('./pages/admin/TenantDetail'));
const AdminStations = lazy(() => import('./pages/admin/AdminStations'));
const Subscriptions = lazy(() => import('./pages/admin/Subscriptions'));
const AdminDevices = lazy(() => import('./pages/admin/Devices'));
const AdminErrors = lazy(() => import('./pages/admin/Errors'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader label="Loading PetroFlow" />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function TenantOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  if (me?.isSuperAdmin) return <Navigate to="/admin" replace />;
  if (!me?.tenant) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  if (!me?.isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function TenantHome() {
  const { can } = useAuth();
  if (can('reports.read')) return <Dashboard />;
  if (can('shifts.read')) return <Navigate to="/shifts" replace />;
  if (can('readings.read')) return <Navigate to="/readings" replace />;
  return <EmptyState title="No permitted screens" description="Ask your organization owner to grant access." />;
}

export default function App() {
  const { isAuthenticated, me } = useAuth();

  return (
    <Suspense fallback={<PageLoader label="Loading screen" />}>
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
                <TenantHome />
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
    </Suspense>
  );
}
