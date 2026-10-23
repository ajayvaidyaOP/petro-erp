import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Fuel, Gauge, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Input } from '../components/ui';

interface DemoAccount {
  email: string;
  name: string;
  role_key: string;
  tenant_name: string | null;
}

interface DemoAccounts {
  note: string;
  password: string;
  accounts: DemoAccount[];
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const demo = useQuery<DemoAccounts>({
    queryKey: ['demo-accounts'],
    queryFn: () => apiGet<DemoAccounts>('/auth/demo-accounts'),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (demo.data?.password) setPassword(demo.data.password);
  }, [demo.data?.password]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const me = await login(email.trim(), password);
      navigate(me.isSuperAdmin ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(demo.data?.password ?? 'PetroFlow@2025');
    setError(null);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-navy-800 bg-navy-900/40 p-10 lg:flex">
        <div className="absolute inset-0 opacity-60 [background:radial-gradient(600px_400px_at_20%_10%,rgba(56,189,248,0.12),transparent_60%),radial-gradient(500px_400px_at_80%_90%,rgba(45,212,191,0.08),transparent_60%)]" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-teal text-navy-950">
              <Fuel className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-ink-100">PetroFlow ERP</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500">Forecourt operations platform</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-lg text-4xl font-semibold leading-[1.1] tracking-tight text-ink-100">
            Run every nozzle, tank and rupee with confidence.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-400">
            Multi-tenant petrol pump management built for India — totalizer capture, shift controls, stock ledgers,
            credit accounting and hardware gateway monitoring in one auditable system.
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
            {[
              { icon: <Gauge className="h-4 w-4" />, title: 'Totalizer pipeline', text: 'Validated device readings with duplicate protection' },
              { icon: <Lock className="h-4 w-4" />, title: 'Tenant isolation', text: 'Server-enforced access boundaries' },
              { icon: <ShieldCheck className="h-4 w-4" />, title: 'Audit trail', text: 'Financial and hardware actions recorded' },
              { icon: <Sparkles className="h-4 w-4" />, title: 'Variance controls', text: 'Flagged readings need human approval' },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-navy-700/70 bg-navy-850/60 p-3">
                <div className="mb-1.5 text-accent">{item.icon}</div>
                <p className="text-xs font-medium text-ink-200">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-[11px] text-ink-600">
          INR · Asia/Kolkata · Hardware readings shown in this environment are SIMULATED and verified only against the
          bundled simulator.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-teal text-navy-950">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-ink-100">PetroFlow ERP</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500">Forecourt operations</p>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold text-ink-100">Sign in</h2>
            <p className="mt-1 text-xs text-ink-500">Use your organization credentials. Sessions are server-side.</p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="label">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.in"
                    className="pl-9"
                  />
                </div>
              </label>
              <label className="block">
                <span className="label">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="pl-9"
                  />
                </div>
              </label>

              {error && (
                <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <p className="mt-4 text-center text-[11px] text-ink-600">
              Organization owners are onboarded by the platform administrator. Public staff registration is disabled.
            </p>
          </div>

          {demo.data && demo.data.accounts.length > 0 && (
            <div className="card mt-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">Demo accounts</p>
                <span className="text-[10px] text-ink-500">password: {demo.data.password}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-500">{demo.data.note}</p>
              <div className="mt-3 grid gap-1.5">
                {demo.data.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => quickFill(account)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-navy-700/70 bg-navy-800/40 px-3 py-2 text-left transition hover:border-accent/40 hover:bg-navy-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink-200">
                        {account.name} · <span className="text-ink-500">{account.role_key.replace(/_/g, ' ')}</span>
                      </span>
                      <span className="block truncate text-[10px] text-ink-500">
                        {account.tenant_name ?? 'Platform'} — {account.email}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
