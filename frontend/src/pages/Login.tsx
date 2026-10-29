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
import { cn } from '../lib/utils';
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
  { icon: Activity, label: 'Shifts & readings', detail: 'Every nozzle accounted for', tone: 'text-panel-energy' },
  { icon: Database, label: 'Stock & deliveries', detail: 'Know what’s in every tank', tone: 'text-live' },
  { icon: Scale, label: 'Sales & settlement', detail: 'Keep every rupee in view', tone: 'text-panel-energy' },
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
    <div className="grid min-h-dvh bg-carbon-950 lg:grid-cols-[1.12fr_1fr]">
      {/* Brand illustration is decorative; no sample figures are presented as live data. */}
      <section className="relative hidden min-h-dvh flex-col overflow-hidden bg-panel px-10 py-9 text-panel-text lg:flex xl:px-14 xl:py-11">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-40 h-[430px] w-[430px] rounded-full bg-orange-500/25 blur-[100px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-20 h-[380px] w-[380px] rounded-full bg-emerald-500/12 blur-[110px]" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="brand-gradient grid h-11 w-11 place-items-center rounded-2xl text-onbrand shadow-glow">
              <Fuel className="h-5 w-5" strokeWidth={2.3} aria-hidden />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold tracking-[-0.03em] text-panel-text">
                Petro<span className="text-panel-energy">Flow</span>
              </p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-panel-dim">Fuel station ERP</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-panel-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
            Made for fuel retail
          </span>
        </div>

        <div className="relative flex flex-1 flex-col justify-center py-8">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-panel-energy/25 bg-panel-energy/10 px-3 py-1.5 text-[11px] font-semibold text-panel-energy">
            <span className="h-1.5 w-1.5 rounded-full bg-panel-energy" aria-hidden />
            YOUR FORECOURT, CONNECTED
          </span>
          <h1 className="mt-5 max-w-[600px] font-display text-[38px] font-extrabold leading-[1.12] tracking-[-0.04em] text-white xl:text-[46px]">
            A brighter way to run <span className="text-panel-energy">your fuel station.</span>
          </h1>
          <p className="mt-4 max-w-[550px] text-sm leading-relaxed text-panel-muted">
            From the first nozzle reading to the final settlement, keep your people, pumps and numbers moving together.
          </p>

          <div className="relative mt-7 overflow-hidden rounded-2.5xl border border-white/10 bg-panel-deep shadow-[0_24px_55px_-22px_rgb(0_0_0/0.7)]">
            <img
              src="/forecourt-illustration.webp"
              alt=""
              className="aspect-[16/8.5] w-full object-cover object-[center_62%]"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel-deep/55 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-panel-deep/75 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-panel-energy" aria-hidden />
              ONE WORKSPACE. EVERY PUMP.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2.5">
            {PILLARS.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <item.icon className={cn('h-4 w-4', item.tone)} aria-hidden />
                <p className="mt-2 text-xs font-bold text-panel-text">{item.label}</p>
                <p className="mt-1 text-[10.5px] leading-snug text-panel-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between gap-4 border-t border-white/10 pt-4 text-xs text-panel-muted">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-live" aria-hidden />
            Thoughtfully built for Indian fuel retailers
          </span>
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
            className="grid h-9.5 w-9.5 place-items-center rounded-xl border border-carbon-700/85 bg-carbon-900 text-ink-400 shadow-sheen transition hover:border-carbon-600 hover:bg-carbon-800 hover:text-ink-100"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-auto w-full max-w-[430px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl text-onbrand shadow-glow">
              <Fuel className="h-5 w-5" />
            </span>
            <div>
              <span className="font-display text-xl font-extrabold tracking-tight text-ink-100">
                Petro<span className="text-accent">Flow</span>
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-ink-500">
                Fuel Station ERP
              </span>
            </div>
          </div>

          <div className="card relative overflow-hidden p-6 sm:p-8">
            <span
              aria-hidden
              className="brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90"
            />
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-accent">
              <Sparkles className="h-3 w-3" aria-hidden /> Secure workspace
            </div>
            <h2 className="mt-3 font-display text-2xl font-extrabold tracking-[-0.03em] text-ink-100 sm:text-[27px]">
              Welcome back
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400 sm:text-sm">
              Sign in to keep your station running smoothly.
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
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-500 transition hover:bg-carbon-800 hover:text-ink-100"
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
                  <p className="font-display text-[13px] font-bold text-ink-100">Explore the demo</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Try sample data from two Sunrise Fuels outlets
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
                    className="group relative overflow-hidden rounded-xl border border-carbon-700/85 bg-carbon-900/75 p-3.5 text-left shadow-sheen transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/55 hover:bg-accent/6 disabled:cursor-wait disabled:opacity-60"
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
                        ? 'Both pumps, prices & finance'
                        : 'Shifts, stock & daily operations'}
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
            <span>Secure access for your team and your business</span>
          </p>
        </div>
      </main>
    </div>
  );
}
