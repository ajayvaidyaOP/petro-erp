import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowUpRight, BarChart3, Building2, Check, ChevronDown, ChevronRight,
  Database, Fuel, KeyRound, LayoutDashboard, ListChecks, LogOut,
  Menu, Moon, Settings as SettingsIcon, ShieldCheck, Store, Sun, Users, Wallet, X,
} from 'lucide-react';
import { useAuth, useStations } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { activeSection, navigation } from '../lib/navigation';
import { cn } from '../lib/utils';
import { initials } from '../lib/format';
import { Button, Field, Input, Modal, useToast } from './ui';
import { apiPost } from '../lib/api';

const icons: Record<string, ReactNode> = {
  '/': <LayoutDashboard />, '/shifts': <ListChecks />, '/tanks': <Database />,
  '/sales': <Fuel />, '/finance': <Wallet />, '/reports': <BarChart3 />,
  '/employees': <Users />, '/settings': <SettingsIcon />,
};
const adminItems = [
  { to: '/admin', label: 'Platform overview' }, { to: '/admin/tenants', label: 'Organizations' },
  { to: '/admin/stations', label: 'Stations' }, { to: '/admin/subscriptions', label: 'Subscriptions' },
  { to: '/admin/devices', label: 'Hardware fleet' }, { to: '/admin/errors', label: 'Platform errors' },
  { to: '/admin/audit', label: 'Audit trail' },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-xl text-onaccent"><Fuel className="h-5 w-5" strokeWidth={2.2} /></span>
      <div><p className="font-display text-xl font-extrabold tracking-tight text-ink-100">Petro<span className="text-accent">Flow</span></p><p className="text-[10px] font-medium tracking-wide text-ink-500">Less paperwork. More control.</p></div>
    </div>
  );
}

function PrimaryNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can, me } = useAuth();
  const { pathname } = useLocation();
  if (me?.isSuperAdmin) return (
    <nav aria-label="Primary" className="space-y-1 px-3 py-5">
      {adminItems.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/admin'} onClick={onNavigate} className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}>{item.label}</NavLink>)}
    </nav>
  );
  const sections = navigation.filter((item) => can(item.permission));
  return (
    <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-5 scroll-thin">
      <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-500">Your workspace</p>
      {sections.map((item) => {
        const active = activeSection(pathname)?.to === item.to;
        return <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={cn('nav-item', active && 'nav-item-active')} aria-current={active ? 'page' : undefined}>
          <span className="nav-icon [&>svg]:h-[18px] [&>svg]:w-[18px]">{icons[item.to]}</span>
          <span>{item.label}</span>{active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
        </NavLink>;
      })}
    </nav>
  );
}

function SectionNav() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const section = activeSection(pathname);
  if (!section || section.children.length < 2) return null;
  const children = section.children.filter((item) => can(item.permission));
  if (children.length < 2) return null;
  return <nav aria-label={`${section.label} sections`} className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-navy-700/60 bg-navy-900 p-1 scroll-thin">
    {children.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors', isActive ? 'bg-accent/10 text-accent' : 'text-ink-400 hover:bg-navy-800 hover:text-ink-100')}>{item.label}</NavLink>)}
  </nav>;
}

function MobileNav({ onMenu }: { onMenu: () => void }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const items = navigation.filter((item) => can(item.permission)).slice(0, 4);
  return <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-navy-700/60 bg-navy-900/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
    {items.map((item) => {
      const active = activeSection(pathname)?.to === item.to;
      return <NavLink key={item.to} to={item.to} className={cn('flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium', active ? 'text-accent' : 'text-ink-500')}>
        <span className={cn('rounded-lg px-3 py-1 [&>svg]:h-5 [&>svg]:w-5', active && 'bg-accent/10')}>{icons[item.to]}</span>
        {item.to === '/' ? 'Home' : item.to === '/shifts' ? 'Shifts' : item.to === '/tanks' ? 'Stock' : 'Sales'}
      </NavLink>;
    })}
    <button type="button" onClick={onMenu} className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-ink-500"><span className="rounded-lg px-3 py-1"><Menu className="h-5 w-5" /></span>More</button>
  </nav>;
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return <button type="button" onClick={toggleTheme} title={label} aria-label={label} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink-400 transition hover:bg-navy-800 hover:text-ink-100">{theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</button>;
}

export function Layout() {
  const { me, logout } = useAuth();
  const { stations, station, selectStation } = useStations();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { toast } = useToast();
  const isDemoTenant = Boolean(me?.tenant?.isDemo);
  const section = activeSection(location.pathname);

  useEffect(() => { setMobileOpen(false); setUserMenu(false); }, [location.pathname]);
  useEffect(() => {
    const handler = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setUserMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setUserMenu(false); setMobileOpen(false); } };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled])');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const media = window.matchMedia('(min-width: 768px)');
    const onDesktop = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener('change', onDesktop);
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', trap); media.removeEventListener('change', onDesktop); previousFocus?.focus(); };
  }, [mobileOpen]);

  const changePassword = async () => {
    setSaving(true);
    try {
      await apiPost('/auth/change-password', { currentPassword, newPassword });
      toast('Password updated', { description: 'Your other sessions were signed out.' });
      setPasswordOpen(false); setCurrentPassword(''); setNewPassword('');
    } catch (error) { toast('Could not change password', { tone: 'danger', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setSaving(false); }
  };

  const stationPicker = (mobile = false) => !me?.isSuperAdmin && stations.length > 0 ? (
    <div className={cn('flex min-w-0 items-center gap-2', mobile ? 'w-full' : 'max-w-[260px]')}>
      <Store className="h-4 w-4 shrink-0 text-ink-500" />
      <select value={station?.id ?? ''} onChange={(event) => selectStation(event.target.value)} aria-label="Active station" className="min-w-0 w-full cursor-pointer truncate rounded-lg border border-navy-700/60 bg-navy-900 px-2.5 py-2 text-xs font-semibold text-ink-200">
        {stations.map((item) => <option key={item.id} value={item.id}>{item.name.replace('Sunrise Fuels — ', 'Sunrise · ')}</option>)}
      </select>
    </div>
  ) : null;

  return <div className="flex min-h-dvh bg-navy-950">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-onaccent">Skip to content</a>
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-navy-700/60 bg-navy-900 md:flex xl:w-[248px]">
      <div className="flex h-[76px] shrink-0 items-center px-5"><Brand /></div>
      <PrimaryNav />
      <div className="mx-4 mb-4 rounded-xl border border-accent/15 bg-accent/[0.04] p-3.5">
        <ShieldCheck className="mb-2 h-5 w-5 text-accent" /><p className="text-xs font-semibold text-ink-200">Simple by design.</p><p className="mt-1 text-[11px] leading-relaxed text-ink-500">One owner. One manager.<br />Everything that matters.</p>
      </div>
      <div className="border-t border-navy-700/50 px-5 py-3 text-[10px] text-ink-500">PetroFlow ERP <span className="float-right">v2.0</span></div>
    </aside>

    {mobileOpen && <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-scrim/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation menu" className="relative flex h-dvh w-[286px] max-w-[88vw] flex-col bg-navy-900 shadow-pop">
        <div className="flex items-center justify-between px-4 py-5"><Brand /><button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-lg text-ink-400 hover:bg-navy-800"><X className="h-5 w-5" /></button></div>
        <div className="px-4 pb-3">{stationPicker(true)}</div><PrimaryNav onNavigate={() => setMobileOpen(false)} />
        <div className="border-t border-navy-700/60 p-4"><p className="text-sm font-semibold text-ink-100">{me?.user.name}</p><p className="mt-1 text-xs text-ink-500">{me?.user.roleName} · {me?.tenant?.name}</p><Button variant="ghost" className="mt-3 w-full" onClick={() => void logout()} icon={<LogOut className="h-4 w-4" />}>Sign out</Button></div>
      </aside>
    </div>}

    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 border-b border-navy-700/60 bg-navy-900/95 px-4 backdrop-blur-xl sm:px-6 md:h-[76px] lg:px-8">
        <div className="min-w-0 flex-1">
          <div className="hidden items-center gap-2 text-xs text-ink-500 md:flex"><Building2 className="h-3.5 w-3.5" /><span className="truncate">{me?.tenant?.name ?? 'Platform administration'}</span><ChevronRight className="h-3 w-3" /><span className="font-medium text-ink-200">{section?.label ?? 'Administration'}</span></div>
          <div className="md:hidden">{stationPicker(true) ?? <span className="font-display font-bold text-ink-100">PetroFlow</span>}</div>
        </div>
        <div className="hidden lg:block">{stationPicker()}</div>
        {isDemoTenant && <span className="hidden rounded-md border border-warn/20 bg-warn/5 px-2 py-1 text-[10px] font-semibold text-warn sm:inline">DEMO</span>}
        <ThemeToggle />
        <div className="relative" ref={menuRef}>
          <button onClick={() => setUserMenu((value) => !value)} className="flex min-h-10 items-center gap-2 rounded-xl p-1 pr-1.5 transition hover:bg-navy-800" aria-haspopup="menu" aria-expanded={userMenu} aria-label="Account menu">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent/10 text-xs font-bold text-accent">{initials(me?.user.name ?? '')}</span>
            <span className="hidden text-left xl:block"><span className="block text-xs font-semibold text-ink-100">{me?.user.name}</span><span className="block text-[10px] text-ink-500">{me?.user.roleName}</span></span><ChevronDown className="hidden h-3.5 w-3.5 text-ink-500 sm:block" />
          </button>
          {userMenu && <div role="menu" className="absolute right-0 top-12 z-50 w-64 animate-fade-in overflow-hidden rounded-xl border border-navy-700 bg-navy-900 shadow-pop">
            <div className="border-b border-navy-700/60 px-4 py-3"><p className="text-sm font-semibold text-ink-100">{me?.user.name}</p><p className="mt-0.5 truncate text-xs text-ink-500">{me?.user.email}</p></div>
            <div className="p-1.5"><button role="menuitem" onClick={() => { setPasswordOpen(true); setUserMenu(false); }} className="menu-item"><KeyRound className="h-4 w-4" />Change password</button><button role="menuitem" onClick={() => void logout()} className="menu-item text-danger"><LogOut className="h-4 w-4" />Sign out</button></div>
          </div>}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1536px] flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-8 lg:px-8 lg:pt-8">
        {isDemoTenant && <p className="mb-5 flex items-center gap-1.5 text-[11px] text-ink-500"><ShieldCheck className="h-3.5 w-3.5" />Demo workspace · Sample records and simulated hardware readings.</p>}
        {!me?.isSuperAdmin && <SectionNav />}
        <div key={location.pathname} className="animate-fade-in"><Outlet /></div>
      </main>
      <footer className="hidden items-center justify-between gap-3 border-t border-navy-700/50 px-8 py-4 text-[10px] text-ink-500 md:flex"><span>PetroFlow · Built for your everyday pump operations</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ok" />All amounts in INR · Times in IST</span></footer>
    </div>
    {!me?.isSuperAdmin && <MobileNav onMenu={() => setMobileOpen(true)} />}
    <Modal open={passwordOpen} onClose={() => setPasswordOpen(false)} title="Change password" description="Use at least 10 characters, including upper- and lowercase letters and a number." size="sm" footer={<><Button variant="ghost" onClick={() => setPasswordOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void changePassword()} loading={saving} disabled={newPassword.length < 10 || !currentPassword}>Update password</Button></>}>
      <div className="space-y-4"><Field label="Current password" required><Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field label="New password" required><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field></div>
    </Modal>
  </div>;
}
