import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Info, RefreshCw } from 'lucide-react';
import { useAuth, useStations } from '../lib/auth';
import { useAttentionItems, type AlertLevel } from '../lib/alerts';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/utils';

const levelStyle: Record<AlertLevel, { icon: typeof Info; tone: string }> = {
  error: { icon: AlertTriangle, tone: 'text-danger' },
  warning: { icon: AlertTriangle, tone: 'text-warn' },
  info: { icon: Info, tone: 'text-info' },
};

/**
 * Header notification centre. It lists the live attention items for the selected pump
 * (the same data as the Overview "Needs attention" card). It has no fake read state:
 * an item disappears when the underlying condition is resolved.
 */
export function NotificationCenter() {
  const { can, me } = useAuth();
  const { stationId } = useStations();
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
  const hasError = attention.items.some((item) => item.level === 'error');
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
        className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-400 transition hover:bg-navy-800 hover:text-ink-100"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className={cn(
              'num absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-navy-900 px-1 text-[10px] font-bold leading-none text-onaccent',
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
          className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-navy-700 bg-navy-900 shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-navy-700/60 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink-100">Needs attention</p>
              <p className="text-[11px] text-ink-500">{count ? `${count} open ${count === 1 ? 'item' : 'items'} for this pump` : 'Nothing open for this pump'}</p>
            </div>
            <button
              type="button"
              onClick={() => attention.refetch()}
              aria-label="Refresh notifications"
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-navy-800 hover:text-ink-200"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto scroll-thin">
            {attention.isLoading ? (
              <p className="px-4 py-6 text-center text-xs text-ink-500">Checking this pump…</p>
            ) : attention.isError ? (
              <p className="px-4 py-6 text-center text-xs text-danger">Could not load notifications. Try refresh.</p>
            ) : count === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-ok" aria-hidden />
                <p className="mt-2 text-xs text-ink-400">All clear. Nothing needs attention right now.</p>
              </div>
            ) : (
              <ul className="divide-y divide-navy-700/50">
                {attention.items.map((item) => {
                  const style = levelStyle[item.level];
                  const Icon = style.icon;
                  const body = (
                    <>
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.tone)} aria-hidden />
                      <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-200">{item.message}</span>
                      {item.to && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden />}
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.to ? (
                        <Link to={item.to} className="flex items-start gap-3 px-4 py-3 transition hover:bg-navy-800/70">{body}</Link>
                      ) : (
                        <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="border-t border-navy-700/60 px-4 py-2 text-[10px] text-ink-500">
            {updated ? `Updated ${timeAgo(updated)} · refreshes every minute` : 'Refreshes every minute'}
          </p>
        </div>
      )}
    </div>
  );
}
