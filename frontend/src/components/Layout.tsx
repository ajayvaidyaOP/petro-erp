import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BadgeIndianRupee,
  Banknote,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Database,
  Droplets,
  FlaskConical,
  Fuel,
  Gauge,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Package,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
  KeyRound,
  ScrollText,
  TriangleAlert,
} from 'lucide-react';
import { useAuth, useStations } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { cn } from '../lib/utils';
import { Badge, Button, Field, Input, Modal, useToast } from './ui';
import { apiPost } from '../lib/api';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permission?: string;
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function tenantNav(can: (p: string) => boolean): NavGroup[] {
  // Groups follow the pump's day: forecourt pehle, phir stock, phir paisa, phir setup.
  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [{ to: '/', label: 'Station Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, permission: 'reports.read', end: true }],
    },
    {
      title: 'Forecourt · Roz ka kaam',
      items: [
        { to: '/shifts', label: 'Shifts', icon: <ListChecks className="h-4 w-4" />, permission: 'shifts.read' },
        { to: '/readings', label: 'Live Readings', icon: <Gauge className="h-4 w-4" />, permission: 'readings.read' },
        { to: '/sales', label: 'Nozzle Sales', icon: <Fuel className="h-4 w-4" />, permission: 'sales.read' },
        { to: '/density', label: 'Density Register', icon: <FlaskConical className="h-4 w-4" />, permission: 'density.read' },
        { to: '/devices', label: 'Gateways & Devices', icon: <HardDrive className="h-4 w-4" />, permission: 'devices.read' },
      ],
    },
    {
      title: 'Stock & Supply',
      items: [
        { to: '/tanks', label: 'Tanks & Stock', icon: <Database className="h-4 w-4" />, permission: 'stock.read' },
        { to: '/deliveries', label: 'Deliveries', icon: <Truck className="h-4 w-4" />, permission: 'deliveries.read' },
        { to: '/lubricants', label: 'Lubricants & Oil', icon: <Droplets className="h-4 w-4" />, permission: 'lubricants.read' },
      ],
    },
    {
      title: 'Paisa · Finance',
      items: [
        { to: '/customers', label: 'Customers & Credit', icon: <Users className="h-4 w-4" />, permission: 'customers.read' },
        { to: '/suppliers', label: 'Supplier Ledger', icon: <Building2 className="h-4 w-4" />, permission: 'suppliers.read' },
        { to: '/finance', label: 'Payments & Expenses', icon: <Wallet className="h-4 w-4" />, permission: 'payments.read' },
        { to: '/reconciliation', label: 'Reconciliation', icon: <Banknote className="h-4 w-4" />, permission: 'reconciliation.read' },
        { to: '/reports', label: 'DSR & Reports', icon: <BarChart3 className="h-4 w-4" />, permission: 'reports.read' },
      ],
    },
    {
      title: 'Pump Setup',
      items: [
        { to: '/stations', label: 'Stations', icon: <Store className="h-4 w-4" />, permission: 'stations.read' },
        { to: '/products', label: 'Products & Prices', icon: <Package className="h-4 w-4" />, permission: 'products.read' },
        { to: '/dispensers', label: 'Dispensers & Nozzles', icon: <Fuel className="h-4 w-4" />, permission: 'dispensers.read' },
        { to: '/employees', label: 'Employees & Roles', icon: <Users className="h-4 w-4" />, permission: 'employees.read' },
        { to: '/compliance', label: 'Licences & Compliance', icon: <ShieldCheck className="h-4 w-4" />, permission: 'compliance.read' },
        { to: '/audit', label: 'Audit Log', icon: <ScrollText className="h-4 w-4" />, permission: 'audit.read' },
        { to: '/billing', label: 'Subscription', icon: <CreditCard className="h-4 w-4" />, permission: 'billing.read' },
        { to: '/settings', label: 'Settings & Diagnostics', icon: <Settings className="h-4 w-4" />, permission: 'settings.read' },
      ],
    },
  ];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => (!item.permission || can(item.permission)) && (item.to !== '/suppliers' || can('reports.read'))) }))
    .filter((group) => group.items.length > 0);
}

const adminNav: NavGroup[] = [
  {
    title: 'Platform',
    items: [
      { to: '/admin', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" />, end: true },
      { to: '/admin/tenants', label: 'Organizations', icon: <Building2 className="h-4 w-4" /> },
      { to: '/admin/stations', label: 'Stations', icon: <Store className="h-4 w-4" /> },
      { to: '/admin/subscriptions', label: 'Subscriptions & Billing', icon: <BadgeIndianRupee className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/admin/devices', label: 'Hardware Fleet', icon: <HardDrive className="h-4 w-4" /> },
      { to: '/admin/errors', label: 'Platform Errors', icon: <TriangleAlert className="h-4 w-4" /> },
      { to: '/admin/audit', label: 'Audit Trail', icon: <ScrollText className="h-4 w-4" /> },
    ],
  },
];

function SidebarNav({ groups, collapsed }: { groups: NavGroup[]; collapsed: boolean }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5 scroll-thin" aria-label="Primary">
      {groups.map((group) => (
        <div key={group.title}>
          {!collapsed && (
            <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-500/80">
              {group.title}
            </p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center rounded-xl text-sm transition-all duration-150',
                    collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
                    isActive
                      ? 'brand-gradient font-semibold text-onaccent shadow-glow'
                      : 'text-ink-400 hover:bg-accent/[0.08] hover:text-ink-100',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('shrink-0', isActive ? 'text-onaccent' : 'text-ink-500 group-hover:text-accent')}>{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const { me, logout, can } = useAuth();
  const { stations, station, selectStation } = useStations();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('petroflow.sidebar') === 'collapsed');
  // Tablets (768–1023px) get a compact icon rail instead of a full drawer.
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const railCollapsed = collapsed || isTablet;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const groups = me?.isSuperAdmin ? adminNav : tenantNav(can);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
  }, [location.pathname]);

  // Lock background scrolling while the mobile drawer is open and allow Escape to close it.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    // Rotating a tablet to landscape reveals the rail — drop the drawer (and the scroll lock) with it.
    const desktop = window.matchMedia('(min-width: 768px)');
    const onDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onDesktop);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onDesktop);
    };
  }, [mobileOpen]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem('petroflow.sidebar', value ? 'expanded' : 'collapsed');
      return !value;
    });
  };

  const changePassword = async () => {
    setSaving(true);
    try {
      await apiPost('/auth/change-password', { currentPassword, newPassword });
      toast('Password updated', { description: 'Other sessions were signed out.' });
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      toast('Could not change password', {
        tone: 'danger',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const isDemoTenant = Boolean(me?.tenant && Number(me.tenant.isDemo) === 1);
  const subscription = me?.subscription;
  const trialEndingSoon =
    subscription?.status === 'TRIALING' &&
    subscription.trialEndsAt &&
    new Date(subscription.trialEndsAt).getTime() - Date.now() < 5 * 86_400_000;

  return (
    <div className="flex min-h-dvh bg-navy-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-onaccent"
      >
        Skip to content
      </a>

      {/* desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-navy-700/50 bg-gradient-to-b from-navy-900 via-navy-900 to-navy-950 backdrop-blur transition-[width] duration-200 md:flex',
          railCollapsed ? 'w-[72px]' : 'w-[264px]',
        )}
      >
        <Brand collapsed={railCollapsed} />
        <SidebarNav groups={groups} collapsed={railCollapsed} />
        {!isTablet && (
          <div className="border-t border-navy-700/60 p-2">
            <button
              onClick={toggleCollapsed}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-ink-500 transition hover:bg-navy-800/60 hover:text-ink-200"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {!collapsed && 'Collapse'}
            </button>
          </div>
        )}
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-scrim/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in relative flex h-[100dvh] w-[270px] max-w-[85vw] flex-col border-r border-navy-700 bg-navy-900">
            <div className="flex shrink-0 items-center justify-between px-3">
              <Brand collapsed={false} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2 text-ink-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            {!me?.isSuperAdmin && stations.length > 0 && (
              <div className="shrink-0 border-b border-navy-700/60 px-2 py-3">
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500/70">
                  {stations.length > 1 ? 'Switch station' : 'Active station'}
                </p>
                <div className="space-y-0.5">
                  {stations.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        selectStation(s.id);
                        navigate(location.pathname);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        s.id === station?.id
                          ? 'bg-accent/10 font-medium text-ink-100'
                          : 'text-ink-400 hover:bg-navy-800/60 hover:text-ink-100',
                      )}
                    >
                      <Store className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {s.id === station?.id && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <SidebarNav groups={groups} collapsed={false} />
            <div className="shrink-0 border-t border-navy-700/60 px-4 py-3 text-[11px] text-ink-500 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p className="truncate text-ink-300">{me?.user.name}</p>
              <p className="truncate">{me?.tenant?.name ?? 'Platform administration'}</p>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-navy-700/60 bg-navy-900/85 px-3 backdrop-blur-xl sm:px-5">
          <button
            className="shrink-0 rounded-md p-2 text-ink-300 hover:bg-navy-800 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Phones: the active station must stay switchable — this tenant runs multiple pumps. */}
          {!me?.isSuperAdmin && stations.length > 0 && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:hidden">
              <Store className="h-3.5 w-3.5 shrink-0 text-ink-500" />
              <select
                value={station?.id ?? ''}
                onChange={(e) => {
                  selectStation(e.target.value);
                  navigate(location.pathname);
                }}
                className="min-w-0 flex-1 cursor-pointer truncate rounded-md border border-navy-700/70 bg-navy-850/60 px-1.5 py-1 text-xs font-medium text-ink-100 focus:border-accent/50 focus:outline-none"
                aria-label="Active station"
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id} className="bg-navy-850">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="hidden items-center gap-2 sm:flex">
            {me?.isSuperAdmin ? (
              <Badge tone="accent" dot>
                Platform administration
              </Badge>
            ) : stations.length > 0 ? (
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-ink-500" />
                <select
                  value={station?.id ?? ''}
                  onChange={(e) => {
                    selectStation(e.target.value);
                    navigate(location.pathname);
                  }}
                  className="max-w-[240px] cursor-pointer rounded-md border border-transparent bg-transparent py-1 pr-6 text-sm font-medium text-ink-100 transition hover:border-navy-600 focus:border-accent/50 focus:outline-none"
        aria-label="Active station"
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id} className="bg-navy-850">
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {isDemoTenant && (
              <Badge tone="warning" className="hidden sm:inline-flex">
                Demo tenant
              </Badge>
            )}
            {trialEndingSoon && (
              <Badge tone="warning" className="hidden md:inline-flex">
                Trial ends soon
              </Badge>
            )}
            <IstClock />
            <ThemeToggle />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-transparent p-1 pr-2 transition hover:border-navy-600 hover:bg-navy-800/60"
                aria-haspopup="menu"
                aria-expanded={userMenu}
              >
                <span className="brand-gradient grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-onaccent shadow-glow">
                  {me?.user.name
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-xs font-medium text-ink-100">{me?.user.name}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-ink-500">
                    {me?.user.roleName ?? me?.user.roleKey.replace(/_/g, ' ')}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
              </button>
              {userMenu && (
                <div
                  role="menu"
                  className="animate-fade-in absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-navy-600/80 bg-navy-850 shadow-2xl"
                >
                  <div className="border-b border-navy-700/60 px-4 py-3">
                    <p className="text-sm font-medium text-ink-100">{me?.user.name}</p>
                    <p className="truncate text-xs text-ink-500">{me?.user.email}</p>
                    {me?.tenant && <p className="mt-1 text-[11px] text-ink-500">{me.tenant.name}</p>}
                  </div>
                  <div className="p-1">
                    <button
                      onClick={() => {
                        setPasswordOpen(true);
                        setUserMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-300 hover:bg-navy-800"
                      role="menuitem"
                    >
                      <KeyRound className="h-4 w-4" /> Change password
                    </button>
                    <button
                      onClick={() => void logout()}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-danger hover:bg-rose-500/10"
                      role="menuitem"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          id="main"
          className="mx-auto w-full max-w-[1500px] flex-1 px-3 pb-24 pt-5 sm:px-5 md:pb-8 lg:px-6"
        >
          {isDemoTenant && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-warn/90">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              This tenant contains seeded DEMO records. Hardware readings in this environment are SIMULATED and are
              not derived from physical dispensers.
            </div>
          )}
          {/* Re-keying on the pathname gives every screen a subtle entrance animation. */}
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-navy-800/60 px-4 py-3 text-[11px] text-ink-600">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2">
            <span>PetroFlow ERP · India · Asia/Kolkata · INR</span>
            <span className="flex items-center gap-2">
              <Activity className="h-3 w-3" /> API v1 ·{' '}
              <span className={me ? 'text-ok' : 'text-danger'}>{me ? 'session active' : 'signed out'}</span>
            </span>
          </div>
        </footer>
      </div>

      {!me?.isSuperAdmin && <MobileBottomNav can={can} onMenu={() => setMobileOpen(true)} />}

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Change password"
        description="Use at least 10 characters including letters and numbers."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void changePassword()}
              loading={saving}
              disabled={newPassword.length < 10 || !currentPassword}
            >
              Update password
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Current password" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="New password" required hint="Minimum 10 characters, letters and numbers.">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/** Live IST clock — pump ka din ghadi se chalta hai (price change 6 AM, shift change). */
function IstClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const time = new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(now);
  const day = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
  }).format(now);
  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-navy-700/60 bg-navy-800/50 py-1.5 pl-3 pr-3.5 lg:flex"
      aria-label="Current time in India"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
      </span>
      <span className="text-xs text-ink-400">
        {day} · <span className="num font-semibold text-ink-100">{time} IST</span>
      </span>
    </div>
  );
}

/** Forecourt-friendly bottom navigation: filler/manager phone ek haath se chala sake. */
function MobileBottomNav({ can, onMenu }: { can: (p: string) => boolean; onMenu: () => void }) {
  const items: NavItem[] = [
    { to: '/', label: 'Home', icon: <LayoutDashboard className="h-5 w-5" />, permission: 'reports.read', end: true },
    { to: '/shifts', label: 'Shifts', icon: <ListChecks className="h-5 w-5" />, permission: 'shifts.read' },
    { to: '/readings', label: 'Readings', icon: <Gauge className="h-5 w-5" />, permission: 'readings.read' },
    { to: '/tanks', label: 'Tanks', icon: <Database className="h-5 w-5" />, permission: 'stock.read' },
  ].filter((item) => (!item.permission || can(item.permission)) && (item.to !== '/suppliers' || can('reports.read')));

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-navy-700/50 bg-navy-900/95 pb-[env(safe-area-inset-bottom)] shadow-pop backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-md auto-cols-fr grid-flow-col">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-ink-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('rounded-full px-3.5 py-1 transition-all', isActive && 'bg-accent/15')}>{item.icon}</span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open full menu"
          className="flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10px] font-medium text-ink-500"
        >
          <span className="rounded-full px-3.5 py-1">
            <Menu className="h-5 w-5" />
          </span>
          Menu
        </button>
      </div>
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-transparent text-ink-400 transition-colors hover:border-navy-600 hover:bg-navy-800/70 hover:text-ink-100"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-16 items-center gap-3 border-b border-navy-700/50 px-4', collapsed && 'justify-center px-2')}>
      <div className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-onaccent shadow-glow">
        <Fuel className="h-5 w-5" strokeWidth={2.5} />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="font-display text-[17px] font-bold leading-tight tracking-tight text-ink-100">
            Petro<span className="text-accent">Flow</span>
          </p>
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-ink-500">Petrol Pump ERP</p>
        </div>
      )}
    </div>
  );
}
