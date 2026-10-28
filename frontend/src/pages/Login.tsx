import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, EyeOff, Fuel, Loader2, LockKeyhole, Mail, ShieldCheck, Users } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Input } from '../components/ui';

interface DemoAccount { email: string; name: string; roleKey: string; tenantName: string | null }
interface DemoAccounts { warning: string; password: string; accounts: DemoAccount[] }

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const demo = useQuery<DemoAccounts>({ queryKey: ['demo-accounts'], queryFn: () => apiGet<DemoAccounts>('/auth/demo-accounts'), retry: false, staleTime: Infinity });
  const busy = loading || signingInAs !== null;

  const signIn = async (user: string, pass: string) => {
    const me = await login(user.trim(), pass);
    navigate(me.isSuperAdmin ? '/admin' : '/', { replace: true });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setLoading(true);
    try { await signIn(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.'); }
    finally { setLoading(false); }
  };
  const signInAs = async (account: DemoAccount) => {
    setError(null); setSigningInAs(account.email); setEmail(account.email); setPassword(demo.data?.password ?? '');
    try { await signIn(account.email, demo.data?.password ?? ''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in'); setSigningInAs(null); }
  };

  return <div className="grid min-h-dvh bg-navy-900 lg:grid-cols-[1fr_1fr]">
    <section className="relative hidden overflow-hidden bg-[#103c2e] p-12 text-white lg:flex lg:flex-col xl:p-16">
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full border-[90px] border-white/[0.025]" aria-hidden />
      <div className="pointer-events-none absolute -right-28 top-28 h-80 w-80 rounded-full border-[60px] border-white/[0.025]" aria-hidden />
      <div className="relative flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#68d5a6] text-[#103c2e]"><Fuel className="h-6 w-6" /></span><div><p className="font-display text-2xl font-extrabold tracking-tight">PetroFlow</p><p className="text-[10px] tracking-widest text-white/50">PETROL PUMP MANAGEMENT</p></div></div>
      <div className="relative my-auto py-16"><span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-[#a5e8c9]"><span className="h-1.5 w-1.5 rounded-full bg-[#68d5a6]" />Made for Indian petrol pumps</span><h1 className="mt-7 max-w-lg font-display text-[46px] font-extrabold leading-[1.16] tracking-tight xl:text-[54px]">A simpler day.<br />A clearer <span className="text-[#8bddb7]">hisaab.</span></h1><p className="mt-6 max-w-sm text-[15px] leading-relaxed text-white/60">Shifts, stock aur udhaar — sab ek jagah. Less clutter, more control over what matters.</p><div className="mt-10 space-y-5">{['Close shifts with confidence', 'Know what’s in every tank', 'Keep every rupay accounted for'].map((text) => <p key={text} className="flex items-center gap-3 text-sm text-white/80"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-[#8bddb7]"><Check className="h-3.5 w-3.5" /></span>{text}</p>)}</div></div>
      <div className="relative flex items-center gap-3 border-t border-white/10 pt-6"><ShieldCheck className="h-5 w-5 text-[#8bddb7]" /><p className="text-xs leading-relaxed text-white/50">One owner. One manager.<br /><span className="text-white/80">The right access, without the complexity.</span></p></div>
    </section>

    <main className="flex items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-[410px]">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden"><span className="brand-gradient grid h-10 w-10 place-items-center rounded-xl text-onaccent"><Fuel className="h-5 w-5" /></span><span className="font-display text-xl font-extrabold text-ink-100">Petro<span className="text-accent">Flow</span></span></div>
        <p className="eyebrow mb-3">Your workspace, simplified</p><h2 className="font-display text-[30px] font-extrabold tracking-tight text-ink-100">Welcome back.</h2><p className="mt-2 text-sm text-ink-400">Sign in to get your pump’s day in order.</p>
        <form onSubmit={submit} className="mt-8 space-y-5">
          <label className="block"><span className="label">Email address</span><div className="relative"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" /><Input type="email" autoComplete="username" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourpump.in" className="min-h-12 pl-10" /></div></label>
          <label className="block"><span className="label">Password</span><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" /><Input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="min-h-12 pl-10 pr-11" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:text-ink-100">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
          {error && <div role="alert" className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-3 text-xs leading-relaxed text-danger">{error}</div>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={busy}>Sign in <ArrowRight className="h-4 w-4" /></Button>
        </form>
        {window.self !== window.top && <p className="mt-4 text-center text-xs text-ink-400">Session not staying signed in? <a className="link" href="/login" target="_blank" rel="noopener noreferrer">Open in a new tab</a></p>}
        {demo.data && demo.data.accounts.length > 0 && <section className="mt-8 border-t border-navy-700/70 pt-6" aria-label="Demo accounts"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-ink-200">Take a look around</p><span className="rounded-md bg-warn/10 px-2 py-1 text-[9px] font-bold tracking-wide text-warn">DEMO ACCESS</span></div><p className="mt-1.5 text-xs text-ink-500">Two roles. One-click sign in. No setup needed.</p><div className="mt-4 grid grid-cols-2 gap-3">{demo.data.accounts.map((account) => <button key={account.email} type="button" disabled={busy} onClick={() => void signInAs(account)} className="group rounded-xl border border-navy-700 bg-navy-950/50 p-4 text-left transition hover:border-accent/50 hover:bg-accent/5 disabled:cursor-wait disabled:opacity-60"><span className="mb-3 flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">{account.roleKey === 'OWNER' ? <ShieldCheck className="h-4 w-4" /> : <Users className="h-4 w-4" />}</span>{signingInAs === account.email ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <ArrowRight className="h-3.5 w-3.5 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-accent" />}</span><span className="block text-sm font-bold text-ink-100">{account.roleKey === 'OWNER' ? 'Owner' : 'Manager'}</span><span className="mt-1 block text-[10px] text-ink-500">{account.roleKey === 'OWNER' ? 'Full business control' : 'Daily pump operations'}</span><span title={account.email} className="mt-3 block truncate text-[10px] text-ink-400 sm:text-[11px]">{account.email}</span></button>)}</div><p className="mt-3 text-[10px] leading-relaxed text-ink-500">Sample data only. Demo password: <span className="font-medium text-ink-400">{demo.data.password}</span></p></section>}
        <p className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-ink-500"><LockKeyhole className="h-3 w-3" />Secure, server-side sessions. No public registration.</p>
      </div>
    </main>
  </div>;
}
