import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';

/* ------------------------------------------------------------------ button */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-navy-950 font-semibold hover:bg-accent-teal shadow-sm shadow-accent/20 border border-accent/50',
  secondary:
    'bg-navy-750 text-ink-100 border border-navy-600/80 hover:bg-navy-700 hover:border-navy-600',
  ghost: 'text-ink-300 hover:bg-navy-800/70 hover:text-ink-100 border border-transparent',
  danger: 'bg-rose-500/90 text-white hover:bg-rose-500 border border-rose-400/40',
  success: 'bg-emerald-500 text-navy-950 font-semibold hover:bg-emerald-400 border border-emerald-400/50',
  outline: 'border border-navy-600 text-ink-200 hover:bg-navy-800/70 hover:border-accent/40',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9.5 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- card */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-navy-700/60 px-4 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ badges */
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-navy-700/60 text-ink-200 border-navy-600/60',
  accent: 'bg-accent/12 text-accent border-accent/30',
  success: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/12 text-amber-300 border-amber-500/30',
  danger: 'bg-rose-500/12 text-rose-300 border-rose-500/30',
  info: 'bg-sky-500/12 text-sky-300 border-sky-500/30',
  muted: 'bg-navy-800 text-ink-500 border-navy-700',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  ACTIVE: 'success',
  ONLINE: 'success',
  VALID: 'success',
  CLOSED: 'success',
  BALANCED: 'success',
  PAID: 'success',
  APPROVED: 'success',
  SETTLED: 'success',
  PROCESSED: 'success',
  CAPTURED: 'success',
  RECEIVED: 'success',
  POSTED: 'info',
  OPEN: 'info',
  TRIALING: 'info',
  PENDING: 'warning',
  FLAGGED: 'warning',
  VARIANCE: 'warning',
  PAST_DUE: 'warning',
  OVERDUE: 'warning',
  SUSPICIOUS: 'warning',
  STALE: 'warning',
  GAP: 'warning',
  DRAFT: 'muted',
  CLOSED_EMPTY: 'muted',
  INACTIVE: 'muted',
  OFFLINE: 'danger',
  SUSPENDED: 'danger',
  DISABLED: 'danger',
  REJECTED: 'danger',
  ERROR: 'danger',
  NEGATIVE: 'danger',
  RESET: 'danger',
  DISPUTED: 'danger',
  REVERSED: 'danger',
  CANCELLED: 'danger',
  MAINTENANCE: 'warning',
  BLOCKED: 'danger',
  ISSUED: 'info',
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Badge tone="muted">—</Badge>;
  return (
    <Badge tone={statusTone[status] ?? 'neutral'} dot>
      {label ?? status.replace(/_/g, ' ')}
    </Badge>
  );
}

/* ------------------------------------------------------------------- forms */
export function Field({
  label,
  error,
  hint,
  children,
  required,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="label">
        {label} {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-400">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input appearance-none bg-navy-900/90', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input min-h-[76px] resize-y', className)} {...props} />;
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm text-ink-200', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-navy-600 bg-navy-900 text-accent focus:ring-accent/40"
      />
      {label}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ states */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-accent', className)} />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-lg bg-navy-800/70"
          style={{ animationDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong';
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-rose-500/25 bg-rose-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-rose-300">
        <AlertTriangle className="h-4 w-4" />
        {message}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 rounded-full border border-navy-700 bg-navy-800/60 p-3 text-ink-400">
        {icon ?? <Info className="h-5 w-5" />}
      </div>
      <p className="text-sm font-medium text-ink-100">{title}</p>
      {description && <p className="max-w-md text-xs text-ink-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- modal */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useMemo(() => `modal-${Math.random().toString(36).slice(2)}`, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([data-close])',
      );
      focusable?.focus();
    }, 50);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-navy-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'animate-fade-in my-auto w-full rounded-t-2xl border border-navy-700/80 bg-navy-850 shadow-2xl sm:rounded-2xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-navy-700/60 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink-100">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
          </div>
          <button
            data-close
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 transition hover:bg-navy-800 hover:text-ink-100"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-navy-700/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-300">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ toasts */
interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'danger' | 'info' | 'warning';
}

interface ToastContextValue {
  toast: (title: string, options?: { description?: string; tone?: Toast['tone'] }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (title: string, options?: { description?: string; tone?: Toast['tone'] }) => {
      const id = crypto.randomUUID();
      setToasts((current) => [
        ...current.slice(-3),
        { id, title, description: options?.description, tone: options?.tone ?? 'success' },
      ]);
      setTimeout(() => dismiss(id), 5200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);
  const icons = {
    success: <Check className="h-4 w-4 text-emerald-400" />,
    danger: <XCircle className="h-4 w-4 text-rose-400" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    info: <Info className="h-4 w-4 text-sky-400" />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border border-navy-600/80 bg-navy-800/95 p-3 shadow-xl backdrop-blur"
          >
            <div className="mt-0.5">{icons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-100">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-ink-400">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-500 hover:text-ink-200" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* ------------------------------------------------------------- pagination */
export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-700/60 px-4 py-3">
      <p className="text-xs text-ink-500">
        Showing <span className="text-ink-300">{from}</span>–<span className="text-ink-300">{to}</span> of{' '}
        <span className="text-ink-300">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 text-xs text-ink-400">
          Page {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ layout */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">{breadcrumb}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink-100 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  footer?: ReactNode;
}) {
  const tones = {
    default: 'text-ink-100',
    accent: 'text-accent',
    success: 'text-emerald-300',
    warning: 'text-amber-300',
    danger: 'text-rose-300',
  };
  return (
    <div className="card card-hover p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
        {icon && <div className="rounded-md bg-navy-800 p-1.5 text-ink-400">{icon}</div>}
      </div>
      <p className={cn('mt-2 text-[22px] font-semibold leading-tight tracking-tight', tones[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {footer && <div className="mt-3 border-t border-navy-700/60 pt-2 text-xs text-ink-500">{footer}</div>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-navy-700/60 pb-px">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'relative whitespace-nowrap px-3 py-2 text-sm transition-colors',
            active === tab.key
              ? 'text-ink-100 after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
              : 'text-ink-400 hover:text-ink-200',
          )}
        >
          {tab.label}
          {typeof tab.count === 'number' && (
            <span className="ml-1.5 rounded bg-navy-700/70 px-1.5 py-0.5 text-[10px] text-ink-300">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children ?? 'DEMO DATA — seeded demonstration records. Clearly separated from real operational data and never created in production.'}</span>
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-500">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-ink-200">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
