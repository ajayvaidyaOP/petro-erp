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
  Sparkles,
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
  { icon: Activity, label: 'Nozzle totalizer & 15°C density checks' },
  { icon: Database, label: 'Underground tank dip & ullage ledger' },
  { icon: Scale, label: 'Note-wise shift cash & UPI settlement' },
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
    <div className="grid min-h-dvh bg-navy-950 lg:grid-cols-[1.12fr_1fr]">
      {/* Left Architectural Forecourt Showcase Panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-panel-line bg-panel p-11 text-panel-text lg:flex xl:p-14">
        {/* Precision blueprint grid + atmospheric radial glows */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(var(--panel-line)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--panel-line)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-36 right-[-5rem] h-[440px] w-[440px] rounded-full bg-panel-accent/14 blur-[125px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-36 left-[-6rem] h-[420px] w-[420px] rounded-full bg-cyan-400/10 blur-[130px]"
          aria-hidden
        />

        {/* Brand Header */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <span className="brand-gradient relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl text-onaccent shadow-glow ring-1 ring-panel-accent/35">
              <span aria-hidden className="absolute inset-0 bg-[linear-gradient(145deg,rgb(255_255_255/0.3),transparent_55%)]" />
              <Fuel className="relative h-5 w-5" strokeWidth={2.3} />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold tracking-[-0.03em] text-panel-text">
                Petro<span className="text-panel-accent">Flow</span>
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.19em] text-panel-dim">
                Forecourt Command ERP
              </p>
            </div>
          </div>
          <span className="rounded-full border border-panel-line bg-panel-raised/80 px-3 py-1 font-mono text-[10px] font-semibold tracking-wider text-panel-muted backdrop-blur-md">
            MULTI-OUTLET · INDIA
          </span>
        </div>

        {/* Center Pitch + Live Instrument Cockpit */}
        <div className="relative my-auto py-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-panel-accent/25 bg-panel-accent/10 px-3.5 py-1 text-[11px] font-semibold text-panel-accent backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-panel-accent" />
            Engineered for modern Indian fuel stations
          </span>

          <h1 className="mt-5 max-w-xl font-display text-[38px] font-extrabold leading-[1.1] tracking-[-0.038em] text-panel-text xl:text-[44px]">
            Every nozzle, tank and rupee —{' '}
            <span className="bg-gradient-to-r from-[#20e0ac] to-[#22d3ee] bg-clip-text text-transparent">
              reconciled
            </span>{' '}
            with precision.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-panel-muted">
            Run single or multi-outlet petrol pumps from one auditable command workspace: totalizer shifts, TT
            decantation, 15°C density checks, and vehicle-level fleet credit.
          </p>

          {/* Forecourt Telemetry Instrument Card */}
          <div className="mt-7 overflow-hidden rounded-2.5xl border border-panel-line bg-panel-raised/75 shadow-[0_28px_70px_-24px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-panel-line/85 bg-panel-deep/45 px-4 py-3 text-[11px]">
              <span className="flex items-center gap-2 font-semibold text-panel-text">
                <span className="h-2 w-2 rounded-full bg-panel-accent shadow-[0_0_8px_rgb(32_224_172/0.7)]" />
                Live Forecourt Telemetry · Baner Outlet
              </span>
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="text-panel-muted">MS ₹104.20/L</span>
                <span className="text-panel-dim">·</span>
                <span className="text-panel-muted">HSD ₹90.75/L</span>
                <span className="rounded-md border border-panel-accent/25 bg-panel-accent/12 px-1.5 py-0.5 font-bold text-panel-accent">
                  SHIFT #2 LIVE
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 p-4">
              <div className="rounded-xl border border-panel-line/85 bg-panel-deep/65 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">Nozzle MS-N1</p>
                <p className="num mt-1.5 font-mono text-xs font-bold text-panel-text xl:text-[13px]">58,342.750 L</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-panel-accent">
                  <CheckCircle2 className="h-3 w-3" /> Totalizer locked
                </p>
              </div>
              <div className="rounded-xl border border-panel-line/85 bg-panel-deep/65 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">HSD Tank 01</p>
                  <span className="font-mono text-[10px] font-bold text-panel-energy">78%</span>
                </div>
                <p className="num mt-1 font-mono text-xs font-bold text-panel-text xl:text-[13px]">15,600 L</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel-line">
                  <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-[#20e0ac] to-[#22d3ee]" />
                </div>
              </div>
              <div className="rounded-xl border border-panel-line/85 bg-panel-deep/65 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-dim">Day Settlement</p>
                <p className="num mt-1.5 font-mono text-xs font-bold text-panel-text xl:text-[13px]">₹1,84,250</p>
                <p className="mt-1 text-[10px] font-medium text-panel-accent">Balanced · ₹0 diff</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PILLARS.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-2.5 rounded-xl border border-panel-line/60 bg-panel-raised/40 px-3 py-2 text-xs text-panel-muted"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-panel-line bg-panel-deep text-panel-accent">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Governance Note */}
        <div className="relative flex items-center justify-between gap-4 border-t border-panel-line/80 pt-5 text-xs text-panel-muted">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-panel-accent" />
            <span>Two-role governance: Owner &amp; Station Manager with immutable server-side audit logs.</span>
          </div>
          <span className="font-mono text-[10px] font-semibold text-panel-dim">IST · INR</span>
        </div>
      </section>

      {/* Right Sign-In Workspace */}
      <main className="relative flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-5 top-5 sm:right-8 sm:top-6">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid h-9.5 w-9.5 place-items-center rounded-xl border border-navy-700/85 bg-navy-900 text-ink-400 shadow-sheen transition hover:border-navy-600 hover:bg-navy-800 hover:text-ink-100"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-auto w-full max-w-[430px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl text-onaccent shadow-glow">
              <Fuel className="h-5 w-5" />
            </span>
            <div>
              <span className="font-display text-xl font-extrabold tracking-tight text-ink-100">
                Petro<span className="text-accent">Flow</span>
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-ink-500">
                Forecourt Command
              </span>
            </div>
          </div>

          <div className="card relative overflow-hidden p-6 sm:p-8">
            <span
              aria-hidden
              className="brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90"
            />
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-accent">
              <Sparkles className="h-3 w-3" aria-hidden /> Operator &amp; Owner Access
            </div>
            <h2 className="mt-3 font-display text-2xl font-extrabold tracking-[-0.03em] text-ink-100 sm:text-[27px]">
              Welcome back
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400 sm:text-sm">
              Sign in to command your fuel stations, shifts and financial ledgers.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="label">Email address</span>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
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
                    className="min-h-11 pl-10"
                  />
                </div>
              </label>

              <label className="block">
                <span className="label">Password</span>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
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
                    className="min-h-11 pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-500 transition hover:bg-navy-800 hover:text-ink-100"
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
            <section className="card mt-4 p-5 sm:p-6" aria-label="Demo accounts">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-display text-[13px] font-bold text-ink-100">One-click demo workspace</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Sunrise Fuels · 2 live outlets (Baner &amp; Hinjewadi)
                  </p>
                </div>
                <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-warn">
                  SANDBOX
                </span>
              </div>

              <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {demo.data.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    disabled={busy}
                    onClick={() => void signInAs(account)}
                    className="group relative overflow-hidden rounded-xl border border-navy-700/85 bg-navy-900/75 p-3.5 text-left shadow-sheen transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/55 hover:bg-accent/6 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="mb-2.5 flex items-center justify-between">
                      <span className="grid h-7.5 w-7.5 place-items-center rounded-lg border border-accent/25 bg-accent/10 p-1.5 text-accent transition group-hover:bg-accent group-hover:text-onaccent">
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
                    <span className="block font-display text-xs font-extrabold text-ink-100">
                      {account.roleKey === 'OWNER' ? 'Owner Workspace' : 'Manager Workspace'}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-500">
                      {account.roleKey === 'OWNER'
                        ? 'Both outlets, pricing & finance'
                        : 'Shifts, stock & credit ops'}
                    </span>
                    <span
                      title={account.email}
                      className="mt-2 block truncate font-mono text-[10px] font-medium text-ink-400"
                    >
                      {account.email}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-3.5 flex items-center gap-1.5 text-[10.5px] text-ink-500">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                <span>
                  Demo password: <code className="mono-code text-ink-200">{demo.data.password}</code>
                </span>
              </p>
            </section>
          )}

          <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-500">
            <LockKeyhole className="h-3 w-3 text-accent" aria-hidden />
            <span>Authenticated server-side sessions · Role-enforced API</span>
          </p>
        </div>
      </main>
    </div>
  );
}
