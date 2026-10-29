import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Fuel,
  Loader2,
  LockKeyhole,
  Mail,
  Moon,
  Scale,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Button, Input } from '../components/ui';

interface DemoAccount {
  email: string;
  name: string;
  roleKey: string;
  tenantName: string | null;
}
interface DemoAccounts {
  warning: string;
  password: string;
  accounts: DemoAccount[];
}

const PILLARS = [
  { icon: Activity, label: 'Nozzle totalizer & quality verification' },
  { icon: Database, label: 'Underground tank ledger, dip & ullage control' },
  { icon: Scale, label: 'Note-wise shift settlement & day-closing lock' },
  { icon: Users, label: 'Vehicle-wise fleet credit & FIFO ageing' },
];

export default function Login() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const demo = useQuery<DemoAccounts>({
    queryKey: ['demo-accounts'],
    queryFn: () => apiGet<DemoAccounts>('/auth/demo-accounts'),
    retry: false,
    staleTime: Infinity,
  });
  const busy = loading || signingInAs !== null;

  const signIn = async (user: string, pass: string) => {
    const me = await login(user.trim(), pass);
    navigate(me.isSuperAdmin ? '/admin' : '/', { replace: true });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const signInAs = async (account: DemoAccount) => {
    setError(null);
    setSigningInAs(account.email);
    setEmail(account.email);
    setPassword(demo.data?.password ?? '');
    try {
      await signIn(account.email, demo.data?.password ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
      setSigningInAs(null);
    }
  };

  return (
    <div className="grid min-h-dvh bg-navy-950 lg:grid-cols-[1.08fr_1fr]">
      {/* Left Fuel-Tech Showcase Panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-panel-line bg-panel p-11 text-panel-text lg:flex xl:p-14">
        {/* Subtle technical grid + two brand glows (ink panel is always dark, by design) */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(var(--panel-line)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--panel-line)) 1px, transparent 1px)',
            backgroundSize: '38px 38px',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-32 right-[-4rem] h-96 w-96 rounded-full bg-panel-accent/12 blur-[110px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-[-6rem] h-96 w-96 rounded-full bg-panel-energy/10 blur-[120px]"
          aria-hidden
        />

        {/* Brand */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="brand-gradient grid h-10 w-10 place-items-center rounded-xl text-onaccent shadow-glow ring-1 ring-panel-accent/30">
              <Fuel className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold tracking-[-0.03em] text-panel-text">
                Petro<span className="text-panel-accent">Flow</span>
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-panel-dim">
                Forecourt Operations ERP
              </p>
            </div>
          </div>
          <span className="rounded-full border border-panel-line bg-panel-raised/70 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-panel-muted backdrop-blur-sm">
            MULTI-OUTLET · INDIA
          </span>
        </div>

        {/* Center Pitch + Instrument Preview */}
        <div className="relative my-auto py-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-panel-accent/25 bg-panel-accent/10 px-3 py-1 text-[11px] font-semibold text-panel-accent backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-panel-accent" />
            Purpose-built for retail fuel stations
          </span>

          <h1 className="mt-5 max-w-xl font-display text-[38px] font-extrabold leading-[1.12] tracking-[-0.035em] text-panel-text xl:text-[44px]">
            Every nozzle, tank and rupee — <span className="text-panel-accent">reconciled</span> with precision.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-panel-muted">
            Run single or multi-outlet petrol pumps from one auditable command workspace: totalizer shifts, TT
            decantation, 15°C density checks, and fleet credit control.
          </p>

          {/* Compact Forecourt Telemetry Preview */}
          <div className="mt-7 rounded-2xl border border-panel-line bg-panel-raised/70 p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-panel-line/80 pb-2.5 text-[11px]">
              <span className="font-semibold text-panel-text">Forecourt Telemetry · Outlet Snapshot</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-panel-accent">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-panel-accent" /> SHIFT #2 ACTIVE
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-panel-line/80 bg-panel-deep/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">Nozzle MS-N1</p>
                <p className="num mt-1 font-mono text-xs font-bold text-panel-text">58,342.750 L</p>
                <p className="mt-0.5 text-[10px] text-panel-accent">Delta verified</p>
              </div>
              <div className="rounded-xl border border-panel-line/80 bg-panel-deep/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">HSD Tank 01</p>
                <p className="num mt-1 font-mono text-xs font-bold text-panel-text">15,600 L · 78%</p>
                <p className="mt-0.5 text-[10px] text-panel-energy">Ullage 4,400 L</p>
              </div>
              <div className="rounded-xl border border-panel-line/80 bg-panel-deep/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">Settlement</p>
                <p className="num mt-1 font-mono text-xs font-bold text-panel-text">Cash + UPI</p>
                <p className="mt-0.5 text-[10px] text-panel-accent">Balanced · ₹0 diff</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PILLARS.map((item) => (
              <div key={item.label} className="flex items-center gap-2.5 text-xs text-panel-muted">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-panel-line bg-panel-raised text-panel-accent">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer governance note */}
        <div className="relative flex items-center justify-between gap-4 border-t border-panel-line/80 pt-5 text-xs text-panel-muted">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-panel-accent" />
            <span>Two-role governance: Owner &amp; Station Manager with full server-side audit logs.</span>
          </div>
          <span className="font-mono text-[10px] text-panel-dim">IST · INR</span>
        </div>
      </section>

      {/* Right Sign-In Panel */}
      <main className="relative flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-5 top-5 sm:right-8 sm:top-6">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid h-9 w-9 place-items-center rounded-lg border border-navy-700 bg-navy-900 text-ink-400 transition hover:border-navy-600 hover:bg-navy-800 hover:text-ink-100"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="brand-gradient grid h-10 w-10 place-items-center rounded-xl text-onaccent shadow-glow">
              <Fuel className="h-5 w-5" />
            </span>
            <div>
              <span className="font-display text-xl font-extrabold text-ink-100">
                Petro<span className="text-accent">Flow</span>
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-500">
                Forecourt ERP
              </span>
            </div>
          </div>

          <div className="card p-6 sm:p-7">
            <p className="eyebrow mb-2 text-accent">Operator &amp; Owner Sign-in</p>
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-100 sm:text-[26px]">
              Welcome back
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400 sm:text-sm">
              Sign in to access your fuel stations, shifts and ledgers.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="label">Email address</span>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
                    aria-hidden
                  />
                  <Input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="owner@yourpump.in"
                    className="min-h-11 pl-9"
                  />
                </div>
              </label>

              <label className="block">
                <span className="label">Password</span>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
                    aria-hidden
                  />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="min-h-11 pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-ink-500 transition hover:bg-navy-800 hover:text-ink-100"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {error && (
                <div role="alert" className="callout-danger leading-relaxed">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={busy}>
                Sign in <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </form>

            {window.self !== window.top && (
              <p className="mt-4 text-center text-xs text-ink-400">
                Session not staying signed in?{' '}
                <a className="link" href="/login" target="_blank" rel="noopener noreferrer">
                  Open in a new tab
                </a>
              </p>
            )}
          </div>

          {demo.data && demo.data.accounts.length > 0 && (
            <section className="card mt-4 p-5" aria-label="Demo accounts">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-ink-100">Instant demo workspace</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Sunrise Fuels · 2 outlets (Baner &amp; Hinjewadi)
                  </p>
                </div>
                <span className="rounded border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-warn">
                  DEMO
                </span>
              </div>

              <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {demo.data.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    disabled={busy}
                    onClick={() => void signInAs(account)}
                    className="group rounded-lg border border-navy-700 bg-navy-900/70 p-3.5 text-left transition hover:border-accent/55 hover:bg-accent/6 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="mb-2.5 flex items-center justify-between">
                      <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/25 bg-accent/10 text-accent">
                        {account.roleKey === 'OWNER' ? (
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Users className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </span>
                      {signingInAs === account.email ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
                      ) : (
                        <ArrowRight
                          className="h-3.5 w-3.5 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-accent"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="block text-xs font-bold text-ink-100">
                      {account.roleKey === 'OWNER' ? 'Owner' : 'Manager'}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-ink-500">
                      {account.roleKey === 'OWNER'
                        ? 'Both outlets, pricing & finance'
                        : 'Shifts, stock & credit ops'}
                    </span>
                    <span
                      title={account.email}
                      className="mt-2 block truncate font-mono text-[10px] text-ink-400"
                    >
                      {account.email}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-500">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-accent" aria-hidden />
                <span>
                  Demo password: <code className="font-mono font-semibold text-ink-300">{demo.data.password}</code>
                </span>
              </p>
            </section>
          )}

          <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-500">
            <LockKeyhole className="h-3 w-3" aria-hidden />
            <span>Authenticated server-side sessions · Role-enforced API</span>
          </p>
        </div>
      </main>
    </div>
  );
}
