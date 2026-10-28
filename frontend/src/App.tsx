import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Button, EmptyState, PageLoader } from './components/ui';

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
const Density = lazy(() => import('./pages/Density'));
const Lubricants = lazy(() => import('./pages/Lubricants'));
const Compliance = lazy(() => import('./pages/Compliance'));
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

function PermissionOnly({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <CardAccessDenied />;
  return <>{children}</>;
}
function CardAccessDenied() {
  return <EmptyState title="Owner access required" description="This section is managed by the owner. Your manager workspace has the tools for daily operations." action={<Link to="/"><Button variant="outline">Back to overview</Button></Link>} />;
}
const pages = [
  ['shifts', Shifts, 'shifts.read'], ['readings', Readings, 'readings.read'],
  ['sales', Sales, 'sales.read'], ['tanks', Tanks, 'stock.read'],
  ['deliveries', Deliveries, 'deliveries.read'], ['density', Density, 'density.read'],
  ['lubricants', Lubricants, 'lubricants.read'], ['compliance', Compliance, 'compliance.read'],
  ['devices', Devices, 'devices.read'], ['customers', Customers, 'customers.read'],
  ['suppliers', Suppliers, 'suppliers.read'], ['finance', Finance, 'payments.read'],
  ['reconciliation', Reconciliation, 'reconciliation.read'], ['reports', Reports, 'reports.read'],
  ['stations', Stations, 'stations.read'], ['products', Products, 'products.read'],
  ['dispensers', Dispensers, 'dispensers.read'], ['employees', Employees, 'employees.read'],
  ['audit', Audit, 'audit.read'], ['billing', Billing, 'billing.read'], ['settings', Settings, 'settings.read'],
] as const;

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
          {pages.map(([path, Page, permission]) => <Route key={path} path={path} element={<TenantOnly><PermissionOnly permission={permission}><Page /></PermissionOnly></TenantOnly>} />)}

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
