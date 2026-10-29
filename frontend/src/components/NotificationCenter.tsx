import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronRight, Info, RefreshCw } from 'lucide-react';
import { useAuth, useStations } from '../lib/auth';
import { useAttentionItems, type AlertLevel } from '../lib/alerts';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/utils';

const levelStyle: Record<
  AlertLevel,
  { icon: typeof Info; badgeBg: string; tone: string; label: string }
> = {
  error: {
    icon: AlertCircle,
    badgeBg: 'bg-danger/12 border-danger/25 text-danger',
    tone: 'text-danger',
    label: 'Critical',
  },
  warning: {
    icon: AlertTriangle,
    badgeBg: 'bg-warn/12 border-warn/25 text-warn',
    tone: 'text-warn',
    label: 'Attention',
  },
  info: {
    icon: Info,
    badgeBg: 'bg-info/12 border-info/25 text-info',
    tone: 'text-info',
    label: 'Notice',
  },
};

export function NotificationCenter() {
  const { can, me } = useAuth();
  const { station, stationId } = useStations();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const attention = useAttentionItems(me?.isSuperAdmin ? null : stationId);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (me?.isSuperAdmin || !stationId || !(can('reports.read') || can('shifts.read'))) return null;

  const count = attention.items.length;
  const errorCount = attention.items.filter((item) => item.level === 'error').length;
  const warnCount = attention.items.filter((item) => item.level === 'warning').length;
  const hasError = errorCount > 0;
  const updated = attention.dataUpdatedAt ? new Date(attention.dataUpdatedAt).toISOString() : null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? `Notifications, ${count} need attention` : 'Notifications, all clear'}
        className={cn(
          'relative grid h-9.5 w-9.5 shrink-0 place-items-center rounded-xl border shadow-sheen transition-all duration-150',
          open
            ? 'border-accent/45 bg-accent/12 text-accent'
            : 'border-navy-700/85 bg-navy-900 text-ink-400 hover:border-navy-600 hover:bg-navy-800 hover:text-ink-100',
        )}
      >
        <Bell className="h-[17px] w-[17px]" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className={cn(
              'num absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-navy-900 px-1 text-[10px] font-bold leading-none text-white shadow-sm',
              hasError ? 'bg-danger' : 'bg-warn',
            )}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="animate-scale-in absolute right-0 top-12 z-50 w-[min(392px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-navy-700/90 bg-navy-850 shadow-pop"
        >
          <div className="hero-mesh flex items-start justify-between gap-3 border-b border-navy-700/75 bg-navy-900/65 px-4 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-display text-sm font-bold text-ink-100">Operational alerts</p>
                {station?.code && (
                  <span className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                    {station.code}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {count
                  ? `${count} active ${count === 1 ? 'condition' : 'conditions'}${errorCount ? ` · ${errorCount} critical` : ''}${warnCount ? ` · ${warnCount} warning` : ''}`
                  : 'All forecourt checks clear for this outlet'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => attention.refetch()}
              aria-label="Refresh notifications"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-navy-700/80 bg-navy-900 text-ink-400 transition hover:border-navy-600 hover:bg-navy-800 hover:text-ink-100"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', attention.isFetching && 'animate-spin')} aria-hidden />
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto scroll-thin">
            {attention.isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-ink-500">Checking outlet telemetry…</p>
            ) : attention.isError ? (
              <p className="px-4 py-8 text-center text-xs text-danger">Could not load notifications. Try refresh.</p>
            ) : count === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-ok/25 bg-ok/10 text-ok">
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-3 font-display text-xs font-bold text-ink-100">All systems nominal</p>
                <p className="mt-0.5 text-[11px] text-ink-500">No open shift, tank, device or compliance alerts.</p>
              </div>
            ) : (
              <ul className="divide-y divide-navy-700/55">
                {attention.items.map((item) => {
                  const style = levelStyle[item.level];
                  const Icon = style.icon;
                  const body = (
                    <>
                      <span
                        className={cn(
                          'mt-0.5 grid h-7.5 w-7.5 shrink-0 place-items-center rounded-xl border p-1.5',
                          style.badgeBg,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[10px] font-bold uppercase tracking-wider', style.tone)}>
                          {style.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-200">{item.message}</span>
                      </span>
                      {item.to && (
                        <ChevronRight
                          className="mt-2 h-4 w-4 shrink-0 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-accent"
                          aria-hidden
                        />
                      )}
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.to ? (
                        <Link
                          to={item.to}
                          className="group flex items-start gap-3 px-4 py-3.5 transition hover:bg-navy-800/70"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-4 py-3.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-navy-700/75 bg-navy-900/55 px-4 py-2.5 text-[10.5px] text-ink-500">
            <span>{updated ? `Synced ${timeAgo(updated)}` : 'Live status'}</span>
            <span>Auto-resolves when cleared</span>
          </div>
        </div>
      )}
    </div>
  );
}
