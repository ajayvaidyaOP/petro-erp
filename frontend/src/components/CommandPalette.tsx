import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CornerDownLeft,
  CreditCard,
  Database,
  FileBadge2,
  Fuel,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  Receipt,
  Scale,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Store,
  Sun,
  Tags,
  Thermometer,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth, useStations } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { navigation } from '../lib/navigation';
import { cn } from '../lib/utils';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  keywords?: string;
  icon: ReactNode;
  badge?: string;
  onSelect: () => void;
}

const routeIcons: Record<string, ReactNode> = {
  '/': <LayoutDashboard className="h-4 w-4" />,
  '/shifts': <ListChecks className="h-4 w-4" />,
  '/readings': <Activity className="h-4 w-4" />,
  '/density': <Thermometer className="h-4 w-4" />,
  '/tanks': <Database className="h-4 w-4" />,
  '/deliveries': <Truck className="h-4 w-4" />,
  '/lubricants': <Fuel className="h-4 w-4" />,
  '/sales': <Fuel className="h-4 w-4" />,
  '/customers': <Users className="h-4 w-4" />,
  '/finance': <Wallet className="h-4 w-4" />,
  '/suppliers': <Truck className="h-4 w-4" />,
  '/reconciliation': <Scale className="h-4 w-4" />,
  '/reports': <BarChart3 className="h-4 w-4" />,
  '/employees': <Users className="h-4 w-4" />,
  '/settings': <SettingsIcon className="h-4 w-4" />,
  '/stations': <Store className="h-4 w-4" />,
  '/products': <Tags className="h-4 w-4" />,
  '/dispensers': <Fuel className="h-4 w-4" />,
  '/devices': <HardDrive className="h-4 w-4" />,
  '/compliance': <FileBadge2 className="h-4 w-4" />,
  '/audit': <ScrollText className="h-4 w-4" />,
  '/billing': <CreditCard className="h-4 w-4" />,
  '/admin': <LayoutDashboard className="h-4 w-4" />,
  '/admin/tenants': <Building2 className="h-4 w-4" />,
  '/admin/stations': <Store className="h-4 w-4" />,
  '/admin/subscriptions': <Receipt className="h-4 w-4" />,
  '/admin/devices': <HardDrive className="h-4 w-4" />,
  '/admin/errors': <ShieldAlert className="h-4 w-4" />,
  '/admin/audit': <ScrollText className="h-4 w-4" />,
};

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { can, me } = useAuth();
  const { stations, station, selectStation } = useStations();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    if (!me?.isSuperAdmin) {
      if (can('shifts.open')) {
        result.push({
          id: 'act-open-shift',
          group: 'Quick Actions',
          label: 'Open a new forecourt shift',
          subtitle: 'Capture opening nozzle totalizers & assign operator',
          keywords: 'start crew totalizer',
          icon: <Plus className="h-4 w-4" />,
          badge: 'Action',
          onSelect: () => navigate('/shifts?new=shift'),
        });
      }
      if (can('deliveries.write')) {
        result.push({
          id: 'act-delivery',
          group: 'Quick Actions',
          label: 'Record supplier fuel delivery',
          subtitle: 'Receive TT decantation into underground tanks',
          keywords: 'tanker invoice receipt stock',
          icon: <Truck className="h-4 w-4" />,
          badge: 'Action',
          onSelect: () => navigate('/deliveries?new=delivery'),
        });
      }
      if (can('expenses.write')) {
        result.push({
          id: 'act-expense',
          group: 'Quick Actions',
          label: 'Record station expense',
          subtitle: 'Log petty cash or digital payout for reconciliation',
          keywords: 'bill electricity cash out',
          icon: <Wallet className="h-4 w-4" />,
          badge: 'Action',
          onSelect: () => navigate('/finance?new=expense'),
        });
      }

      if (stations.length > 1) {
        for (const item of stations) {
          result.push({
            id: `station-${item.id}`,
            group: 'Switch Active Pump',
            label: item.name,
            subtitle: `Outlet code ${item.code}`,
            keywords: `pump station outlet ${item.code}`,
            icon: <Store className="h-4 w-4" />,
            badge: station?.id === item.id ? 'Active' : item.code,
            onSelect: () => selectStation(item.id),
          });
        }
      }

      const seen = new Set<string>();
      for (const section of navigation) {
        if (can(section.permission) && !seen.has(section.to)) {
          seen.add(section.to);
          result.push({
            id: `nav-${section.to}`,
            group: section.group,
            label: section.label,
            subtitle: section.description,
            keywords: section.to,
            icon: routeIcons[section.to] ?? <ArrowRight className="h-4 w-4" />,
            onSelect: () => navigate(section.to),
          });
        }
        for (const child of section.children) {
          if (can(child.permission) && !seen.has(child.to)) {
            seen.add(child.to);
            result.push({
              id: `nav-${child.to}`,
              group: section.group,
              label: child.label,
              subtitle: `${section.label} · ${section.description}`,
              keywords: `${section.label} ${child.to}`,
              icon: routeIcons[child.to] ?? <ArrowRight className="h-4 w-4" />,
              onSelect: () => navigate(child.to),
            });
          }
        }
      }
    } else {
      const adminRoutes = [
        { to: '/admin', label: 'Platform overview', subtitle: 'SaaS MRR, subscriptions & hardware metrics' },
        { to: '/admin/tenants', label: 'Organizations', subtitle: 'Manage fuel retail tenants & onboarding' },
        { to: '/admin/stations', label: 'Stations', subtitle: 'Cross-tenant outlet directory' },
        { to: '/admin/subscriptions', label: 'Subscriptions', subtitle: 'Plans, trials & billing status' },
        { to: '/admin/devices', label: 'Hardware fleet', subtitle: 'Forecourt controllers & heartbeats' },
        { to: '/admin/errors', label: 'Platform errors', subtitle: 'Server exception telemetry' },
        { to: '/admin/audit', label: 'Audit trail', subtitle: 'Immutable platform security log' },
      ];
      for (const r of adminRoutes) {
        result.push({
          id: `adm-${r.to}`,
          group: 'Platform Administration',
          label: r.label,
          subtitle: r.subtitle,
          icon: routeIcons[r.to] ?? <ArrowRight className="h-4 w-4" />,
          onSelect: () => navigate(r.to),
        });
      }
    }

    result.push({
      id: 'theme-toggle',
      group: 'Preferences',
      label: theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
      subtitle: 'Change workspace appearance instantly',
      keywords: 'dark light mode appearance color',
      icon: theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
      onSelect: () => toggleTheme(),
    });

    return result;
  }, [can, me?.isSuperAdmin, navigate, selectStation, station?.id, stations, theme, toggleTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.label} ${item.subtitle ?? ''} ${item.group} ${item.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (event.key === 'Enter' && filtered[activeIndex]) {
        event.preventDefault();
        filtered[activeIndex].onSelect();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIndex, filtered, onClose, open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const grouped: { group: string; entries: { item: CommandItem; index: number }[] }[] = [];
  filtered.forEach((item, index) => {
    const last = grouped[grouped.length - 1];
    if (last && last.group === item.group) {
      last.entries.push({ item, index });
    } else {
      grouped.push({ group: item.group, entries: [{ item, index }] });
    }
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-scrim/60 px-4 pt-[10vh] backdrop-blur-[3px] sm:pt-[13vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-scale-in flex max-h-[72dvh] w-full max-w-xl flex-col overflow-hidden rounded-2.5xl border border-carbon-700/90 bg-carbon-850 shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-carbon-700/75 bg-carbon-900/65 px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to module, switch pump, or run an action…"
            aria-label="Search commands"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="rounded-lg p-1 text-ink-500 hover:bg-carbon-800 hover:text-ink-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="kbd hidden sm:inline-block">ESC</kbd>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2 scroll-thin">
          {grouped.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-ink-200">No matching modules or commands</p>
              <p className="mt-1 text-xs text-ink-500">Try searching for Shifts, Tanks, DSR, Credit, or Dispensers.</p>
            </div>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-2 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-500">
                  {section.group}
                </p>
                <div className="space-y-0.5">
                  {section.entries.map(({ item, index }) => {
                    const active = index === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-cmd-index={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          item.onSelect();
                          onClose();
                        }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-accent/12 text-ink-100' : 'text-ink-300 hover:bg-carbon-800/70',
                        )}
                      >
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors',
                            active
                              ? 'border-accent/35 bg-accent/15 text-accent'
                              : 'border-carbon-700/80 bg-carbon-900 text-ink-400',
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-ink-100">{item.label}</span>
                          {item.subtitle && (
                            <span className="block truncate text-[11px] text-ink-500">{item.subtitle}</span>
                          )}
                        </span>
                        {item.badge && (
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                              item.badge === 'Active'
                                ? 'border-ok/30 bg-ok/12 text-ok'
                                : 'border-accent/25 bg-accent/10 text-accent',
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                        {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-carbon-700/70 bg-carbon-900/50 px-4 py-2 text-[10.5px] text-ink-500">
          <span className="flex items-center gap-2">
            <span>
              <kbd className="kbd mr-1">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="kbd mr-1">↵</kbd> Open
            </span>
          </span>
          <span className="font-medium text-ink-400">PetroFlow Command</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
