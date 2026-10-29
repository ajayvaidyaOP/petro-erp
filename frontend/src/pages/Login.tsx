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
  { icon: Activity, label: 'Shifts', detail: 'Every reading, in place', tone: 'text-panel-energy' },
  { icon: Database, label: 'Stock', detail: 'Every tank, in view', tone: 'text-live' },
  { icon: Scale, label: 'Sales', detail: 'Every rupee, accounted for', tone: 'text-panel-energy' },
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
      {/* The illustration is decorative; no sample figures are presented as live data. */}
      <section className="login-story relative hidden min-h-dvh flex-col overflow-hidden border-r border-white/5 px-10 py-9 text-panel-text lg:flex xl:px-14 xl:py-10">
        <div aria-hidden className="pointer-events-none absolute right-[-120px] top-[-150px] h-[380px] w-[380px] rounded-full border border-white/[0.04] shadow-[0_0_0_55px_rgb(255_255_255/0.015),0_0_0_110px_rgb(255_255_255/0.01)]" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="brand-gradient grid h-11 w-11 place-items-center rounded-xl text-onbrand shadow-glow">
              <Fuel className="h-5 w-5" strokeWidth={2.3} aria-hidden />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold tracking-[-0.03em] text-panel-text">
                Petro<span className="text-panel-energy">Flow</span>
              </p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.17em] text-panel-dim">Station management</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-panel-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
            Built for fuel retail
          </span>
        </div>

        <div className="relative flex flex-1 flex-col justify-center py-8">
          <span className="inline-flex w-fit items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-panel-energy">
            <span className="h-px w-7 bg-panel-energy" aria-hidden />
            Your forecourt, connected
          </span>
          <h1 className="mt-4 max-w-[620px] font-display text-[38px] font-extrabold leading-[1.1] tracking-[-0.045em] text-white xl:text-[48px]">
            A better way to run <span className="text-panel-energy">your fuel station.</span>
          </h1>
          <p className="mt-4 max-w-[520px] text-sm leading-relaxed text-panel-muted">
            From the first reading to the final settlement, bring your people, pumps and numbers together.
          </p>

          <div className="relative mt-7 overflow-hidden rounded-2.5xl border border-white/10 bg-panel-deep shadow-[0_24px_55px_-22px_rgb(0_0_0/0.7)]">
            <img
              src="/forecourt-illustration.webp"
              alt=""
              className="aspect-[16/8.2] w-full object-cover object-[center_62%]"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel-deep/70 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-panel-deep/80 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
              ONE WORKSPACE. EVERY PUMP.
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {PILLARS.map((item) => (
              <div key={item.label} className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-3">
                <item.icon className={cn('mt-0.5 h-4 w-4 shrink-0', item.tone)} aria-hidden />
                <div>
                  <p className="text-xs font-bold text-panel-text">{item.label}</p>
                  <p className="mt-1 text-[10.5px] leading-snug text-panel-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between gap-4 border-t border-white/10 pt-4 text-xs text-panel-muted">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-live" aria-hidden />
            Made for Indian fuel retailers
          </span>
          <span className="font-mono text-[10px] font-semibold text-panel-dim">IST · INR</span>
        </div>
      </section>

      {/* Right Sign-In Workspace */}
      <main className="relative flex flex-col justify-center px-5 py-12 sm:px-10">
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
            <span className="brand-gradient relative grid h-11 w-11 place-items-center overflow-hidden rounded-xl text-onbrand shadow-glow">
              <Fuel className="h-5 w-5" />
            </span>
            <div>
              <span className="font-display text-xl font-extrabold tracking-tight text-ink-100">
                Petro<span className="text-accent">Flow</span>
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-ink-500">
                Station management
              </span>
            </div>
          </div>

          <div className="card relative overflow-hidden p-6 sm:p-8">
            <span
              aria-hidden
              className="brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90"
            />
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Your station workspace
            </div>
            <h2 className="mt-3 font-display text-2xl font-extrabold tracking-[-0.03em] text-ink-100 sm:text-[27px]">
              Welcome back
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400 sm:text-sm">
              Sign in and pick up right where you left off.
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

              <div>
                <label htmlFor="login-password" className="label">Password</label>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
                    aria-hidden
                  />
                  <Input
                    id="login-password"
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
              </div>

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
            <section className="card mt-4 p-5 sm:px-6" aria-label="Demo accounts">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-display text-[13px] font-bold text-ink-100">Explore the demo</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">Choose a workspace to try sample data</p>
                </div>
                <span className="rounded-full border border-ok/25 bg-ok/10 px-2.5 py-1 text-[9px] font-bold tracking-wider text-ok">
                  SANDBOX
                </span>
              </div>

              <div className="mt-3.5 grid gap-2">
                {demo.data.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    disabled={busy}
                    onClick={() => void signInAs(account)}
                    className="group flex min-w-0 items-center gap-3 rounded-xl border border-carbon-700/70 bg-carbon-900/75 px-3 py-2.5 text-left transition-all duration-150 hover:border-accent/45 hover:bg-accent/6 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-onaccent">
                      {account.roleKey === 'OWNER' ? (
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                      ) : (
                        <Users className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-xs font-bold text-ink-100">
                        {account.roleKey === 'OWNER' ? 'Owner workspace' : account.roleKey === 'STAFF' ? 'Staff login' : 'Manager workspace'}
                      </span>
                      <span title={account.email} className="mt-0.5 block truncate text-[10.5px] text-ink-500">
                        {account.email}
                      </span>
                    </span>
                    {signingInAs === account.email ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                    )}
                  </button>
                ))}
              </div>

              <p className="mt-3.5 flex items-center gap-1.5 text-[10.5px] text-ink-500">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
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
