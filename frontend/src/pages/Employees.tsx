import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, KeyRound, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { initials } from '../lib/format';
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, useToast } from '../components/ui';
import { AttendancePanel } from '../components/AttendancePanel';

interface Employee { id: string; name: string; email: string; phone: string | null; roleKey: string; status: string; stationIds: string[] }
const roleInfo = {
  OWNER: { title: 'Owner', subtitle: 'The business, in your control.', abilities: ['All pumps & organization-wide reports', 'Fuel prices, finance and subscription', 'Manager access and pump settings'], icon: ShieldCheck },
  MANAGER: { title: 'Manager', subtitle: 'The everyday operations partner.', abilities: ['Shifts, readings and stock deliveries', 'Customer credit, payments and expenses', 'Daily reports for assigned pumps'], icon: Users },
};

export default function Employees() {
  const { me, refresh } = useAuth();
  const { stations } = useStations();
  const { toast } = useToast();
  const client = useQueryClient();
  const [edit, setEdit] = useState<Employee | null>(null);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', stationIds: [] as string[] });
  const [resetFor, setResetFor] = useState<Employee | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const employees = useQuery<Employee[]>({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/catalog/employees') });
  const rows = employees.data ?? [];
  const manager = rows.find((row) => row.roleKey === 'MANAGER' && row.status === 'ACTIVE') ?? rows.find((row) => row.roleKey === 'MANAGER');
  const team = [rows.find((row) => row.roleKey === 'OWNER' && row.status === 'ACTIVE'), manager].filter((row): row is Employee => Boolean(row));
  const invalidate = () => { void client.invalidateQueries({ queryKey: ['employees'] }); void client.invalidateQueries({ queryKey: ['attendance'] }); refresh(); };
  const openEdit = (employee: Employee) => { setEdit(employee); setCreate(false); setForm({ name: employee.name, phone: employee.phone ?? '', email: employee.email, password: '', stationIds: employee.stationIds }); };
  const openCreate = () => { setEdit(null); setCreate(true); setForm({ name: '', phone: '', email: '', password: '', stationIds: stations.map((station) => station.id) }); };
  const save = useMutation({
    mutationFn: () => create
      ? apiPost('/catalog/employees', { name: form.name, email: form.email, phone: form.phone || null, password: form.password, roleKey: 'MANAGER', stationIds: form.stationIds })
      : apiPatch(`/catalog/employees/${edit?.id}`, { name: form.name, phone: form.phone || null, ...(edit?.roleKey === 'MANAGER' ? { stationIds: form.stationIds, status: 'ACTIVE' } : {}) }),
    onSuccess: () => { toast(create ? 'Manager added' : 'Account updated'); setEdit(null); setCreate(false); invalidate(); },
    onError: (error: Error) => toast('Could not save account', { tone: 'danger', description: error.message }),
  });
  const reset = useMutation({
    mutationFn: () => apiPost(`/catalog/employees/${resetFor?.id}/reset-password`, { newPassword }),
    onSuccess: () => { toast('Password reset', { description: 'Other sessions were signed out.' }); setResetFor(null); setNewPassword(''); },
    onError: (error: Error) => toast('Could not reset password', { tone: 'danger', description: error.message }),
  });
  const toggleStation = (id: string) => setForm((value) => ({ ...value, stationIds: value.stationIds.includes(id) ? value.stationIds.filter((stationId) => stationId !== id) : [...value.stationIds, id] }));

  return <>
    <PageHeader title="Your team" description="One owner. One manager. Clear responsibilities, no unnecessary roles." actions={!manager ? <Button variant="primary" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>Set up manager</Button> : <Badge tone="accent" dot>Simple two-role access</Badge>} />
    {employees.isLoading ? <LoadingBlock rows={6} /> : employees.isError ? <ErrorState error={employees.error} onRetry={() => void employees.refetch()} /> : <>
      <div className="grid gap-5 lg:grid-cols-2">{team.map((employee) => {
        const info = roleInfo[employee.roleKey as keyof typeof roleInfo];
        const Icon = info.icon;
        return (
          <Card key={employee.id} className="relative overflow-hidden">
            <span
              aria-hidden
              className={
                employee.roleKey === 'OWNER'
                  ? 'brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90'
                  : 'absolute inset-x-0 top-0 h-[2.5px] bg-carbon-600/70'
              }
            />
            <div className="hero-mesh border-b border-carbon-700/60 p-6">
              <div className="flex items-start justify-between">
                <span className="brand-gradient grid h-14 w-14 place-items-center rounded-2xl font-display text-lg font-extrabold text-onbrand shadow-glow">
                  {initials(employee.name)}
                </span>
                <Badge tone={employee.roleKey === 'OWNER' ? 'accent' : 'neutral'} dot>
                  <Icon className="h-3 w-3" aria-hidden />
                  {info.title}
                </Badge>
              </div>
              <h2 className="mt-4 font-display text-xl font-extrabold tracking-tight text-ink-100">
                {employee.name}
                {employee.id === me?.user.id && (
                  <span className="ml-2 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 align-middle font-sans text-[10px] font-bold uppercase tracking-wider text-accent">
                    You
                  </span>
                )}
              </h2>
              <p className="mt-1 font-mono text-xs text-ink-400">{employee.email}</p>
              <p className="mt-3 text-xs leading-relaxed text-ink-500">{info.subtitle}</p>
            </div>
            <CardBodyTeam>
              <p className="eyebrow mb-3">What this role can do</p>
              <ul className="space-y-2.5">
                {info.abilities.map((ability) => (
                  <li key={ability} className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-300">
                    <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-md bg-accent/12 p-0.5 text-accent">
                      <Check className="h-3 w-3" />
                    </span>
                    {ability}
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl border border-carbon-700/65 bg-carbon-800/45 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Pump access</p>
                <p className="mt-1 text-xs font-semibold text-ink-100">
                  {employee.roleKey === 'OWNER'
                    ? 'All pumps'
                    : stations
                        .filter((station) => employee.stationIds.includes(station.id))
                        .map((station) => station.name)
                        .join(' · ') || 'No pumps assigned'}
                </p>
                {employee.status !== 'ACTIVE' && <Badge tone="warning" className="mt-2">Access disabled</Badge>}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEdit(employee)}
                  icon={employee.roleKey === 'MANAGER' && employee.status !== 'ACTIVE' ? <Plus className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                >
                  {employee.status !== 'ACTIVE' ? 'Re-enable manager' : employee.roleKey === 'MANAGER' ? 'Edit access' : 'Edit profile'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResetFor(employee)} icon={<KeyRound className="h-3.5 w-3.5" />}>
                  Reset password
                </Button>
              </div>
            </CardBodyTeam>
          </Card>
        );
      })}</div>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-accent/15 bg-accent/[0.04] p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><div><p className="text-xs font-semibold text-ink-200">Less complexity. The same accountability.</p><p className="mt-1 text-xs leading-relaxed text-ink-500">Roles are fixed and permissions are checked by the server. The owner controls setup and prices; the manager handles the day-to-day. Every change stays in the audit log.</p></div></div>
      <details className="card mt-6 group"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-ink-200">Attendance & monthly summary <ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary><div className="border-t border-carbon-700/60 p-4"><AttendancePanel canWrite /></div></details>
    </>}
    <Modal open={Boolean(edit) || create} onClose={() => { setEdit(null); setCreate(false); }} title={create ? 'Set up your manager' : edit?.roleKey === 'OWNER' ? 'Edit owner profile' : 'Edit manager access'} description="A fixed role with clearly defined access. No extra role selection needed." footer={<><Button variant="ghost" onClick={() => { setEdit(null); setCreate(false); }}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!form.name.trim() || (create && (!form.email || form.password.length < 10)) || (!create && edit?.roleKey === 'MANAGER' && form.stationIds.length === 0)} onClick={() => save.mutate()}>{create ? 'Create manager' : 'Save changes'}</Button></>}>
      <div className="space-y-4"><Field label="Full name" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>{create && <><Field label="Email address" required><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Field label="Temporary password" required hint="At least 10 characters, with upper- and lowercase letters and a number."><Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field></>}<Field label="Phone"><Input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>{(create || edit?.roleKey === 'MANAGER') && <fieldset><legend className="label">Assigned pumps</legend><div className="space-y-2">{stations.map((station) => <label key={station.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-carbon-700/70 p-3 text-sm text-ink-200"><input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={() => toggleStation(station.id)} className="h-4 w-4 accent-accent" />{station.name}</label>)}</div><p className="mt-2 text-xs text-ink-500">Choose at least one pump. The manager cannot access unassigned pumps.</p></fieldset>}</div>
    </Modal>
    <Modal open={Boolean(resetFor)} onClose={() => setResetFor(null)} title={`Reset password · ${resetFor?.name ?? ''}`} description="All existing sessions for this account will be signed out." size="sm" footer={<><Button variant="ghost" onClick={() => setResetFor(null)}>Cancel</Button><Button variant="primary" loading={reset.isPending} disabled={newPassword.length < 10} onClick={() => reset.mutate()}>Reset password</Button></>}><Field label="New password" required hint="At least 10 characters, with upper- and lowercase letters and a number."><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field></Modal>
  </>;
}

function CardBodyTeam({ children }: { children: React.ReactNode }) { return <div className="p-6">{children}</div>; }
