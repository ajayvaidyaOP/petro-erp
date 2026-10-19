import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, UserCog, Users } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  useToast,
} from '../components/ui';

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleKey: string;
  status: string;
  lastLoginAt: string | null;
  stationIds: string[];
  permissions: string[];
  isDemo: number;
}

interface RoleDef {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}

const blank = { name: '', email: '', phone: '', password: '', roleKey: 'OPERATOR', stationIds: [] as string[] };

export default function Employees() {
  const { can, me } = useAuth();
  const { stations } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [edit, setEdit] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', roleKey: 'OPERATOR', status: 'ACTIVE', stationIds: [] as string[] });
  const [resetFor, setResetFor] = useState<Employee | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [disable, setDisable] = useState<Employee | null>(null);

  const employees = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => apiGet<Employee[]>('/catalog/employees'),
  });
  const roles = useQuery<RoleDef[]>({
    queryKey: ['roles'],
    queryFn: () => apiGet<RoleDef[]>('/catalog/roles'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['employees'] });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/catalog/employees', {
        ...form,
        phone: form.phone || null,
        stationIds: form.roleKey === 'OWNER' ? [] : form.stationIds,
      }),
    onSuccess: () => {
      toast('Employee created', { tone: 'success', description: 'They can sign in with the temporary password.' });
      setCreateOpen(false);
      setForm({ ...blank });
      invalidate();
    },
    onError: (error: Error) => toast('Could not create employee', { tone: 'danger', description: error.message }),
  });

  const update = useMutation({
    mutationFn: () => apiPatch(`/catalog/employees/${edit?.id}`, editForm),
    onSuccess: () => {
      toast('Employee updated', { tone: 'success' });
      setEdit(null);
      invalidate();
    },
    onError: (error: Error) => toast('Update failed', { tone: 'danger', description: error.message }),
  });

  const reset = useMutation({
    mutationFn: () => apiPost(`/catalog/employees/${resetFor?.id}/reset-password`, { newPassword }),
    onSuccess: () => {
      toast('Password reset', { tone: 'success', description: 'All active sessions for this user were revoked.' });
      setResetFor(null);
      setNewPassword('');
    },
    onError: (error: Error) => toast('Reset failed', { tone: 'danger', description: error.message }),
  });

  const deactivate = useMutation({
    mutationFn: () => apiDelete(`/catalog/employees/${disable?.id}`),
    onSuccess: () => {
      toast('Employee disabled', { tone: 'success', description: 'Access revoked; historical activity is preserved.' });
      setDisable(null);
      invalidate();
    },
    onError: (error: Error) => toast('Could not disable employee', { tone: 'danger', description: error.message }),
  });

  const rows = employees.data ?? [];
  const roleMap = new Map((roles.data ?? []).map((r) => [r.key, r]));

  const toggleStation = (list: string[], id: string) =>
    list.includes(id) ? list.filter((s) => s !== id) : [...list, id];

  return (
    <div>
      <PageHeader
        title="Employees & Roles"
        description="Roles are enforced by the API on every request. Station assignment limits what each non-owner employee can see and do."
        actions={
          can('employees.write') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Add employee
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Employees" value={rows.length} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Active" value={rows.filter((r) => r.status === 'ACTIVE').length} tone="success" icon={<UserCog className="h-4 w-4" />} />
        <StatCard
          label="Roles in use"
          value={new Set(rows.map((r) => r.roleKey)).size}
          hint="Owner, manager, accountant, cashier and operator."
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader title="Team" subtitle="Owners see all stations; every other role must be granted station access explicitly." />
        {employees.isLoading ? (
          <LoadingBlock />
        ) : employees.isError ? (
          <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No employees" description="Add staff to run shifts and record payments." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Stations</th>
                  <th>Last login</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => {
                  const role = roleMap.get(employee.roleKey);
                  const names = employee.stationIds
                    .map((id) => stations.find((s) => s.id === id)?.code)
                    .filter(Boolean);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <p className="font-medium text-ink-100">{employee.name}</p>
                        <p className="text-xs text-ink-500">{employee.email}</p>
                      </td>
                      <td>
                        <Badge tone={employee.roleKey === 'OWNER' ? 'info' : 'neutral'}>{role?.label ?? employee.roleKey}</Badge>
                        <p className="mt-1 max-w-[220px] text-[11px] text-ink-500">{role?.description}</p>
                      </td>
                      <td className="text-xs text-ink-400">
                        {employee.roleKey === 'OWNER' ? 'All stations' : names.length ? names.join(', ') : '—'}
                      </td>
                      <td className="text-xs text-ink-400">{employee.lastLoginAt ? formatDateTime(employee.lastLoginAt) : 'Never'}</td>
                      <td><StatusBadge status={employee.status} /></td>
                      <td className="text-right">
                        {can('employees.write') ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEdit(employee);
                                setEditForm({
                                  name: employee.name,
                                  phone: employee.phone ?? '',
                                  roleKey: employee.roleKey,
                                  status: employee.status,
                                  stationIds: employee.stationIds,
                                });
                              }}
                              aria-label={`Edit ${employee.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setResetFor(employee)} aria-label={`Reset password for ${employee.name}`}>
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                            {employee.id !== me?.user.id && employee.roleKey !== 'OWNER' && employee.status === 'ACTIVE' ? (
                              <Button size="sm" variant="ghost" onClick={() => setDisable(employee)}>
                                Disable
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add employee"
        description="No public sign-up: accounts are created here by an authorised administrator."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create employee</Button>
          </>
        }
      >
        <EmployeeForm form={form} setForm={setForm} stations={stations} roles={roles.data ?? []} toggleStation={toggleStation} />
      </Modal>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={`Edit ${edit?.name ?? 'employee'}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button loading={update.isPending} onClick={() => update.mutate()}>Save changes</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={editForm.roleKey} onChange={(e) => setEditForm({ ...editForm, roleKey: e.target.value })}>
              {(roles.data ?? []).map((role) => (
                <option key={role.key} value={role.key}>{role.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </Field>
          {editForm.roleKey !== 'OWNER' ? (
            <Field label="Station access" className="sm:col-span-2" hint="Required for every station-scoped role.">
              <div className="grid gap-2 sm:grid-cols-2">
                {stations.map((station) => (
                  <label key={station.id} className="flex items-center gap-2 rounded-lg border border-navy-700/60 px-3 py-2 text-sm text-ink-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-navy-600 bg-navy-900 text-accent"
                      checked={editForm.stationIds.includes(station.id)}
                      onChange={() => setEditForm({ ...editForm, stationIds: toggleStation(editForm.stationIds, station.id) })}
                    />
                    {station.name} <span className="text-xs text-ink-500">{station.code}</span>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(resetFor)}
        onClose={() => setResetFor(null)}
        title={`Reset password — ${resetFor?.name ?? ''}`}
        description="The employee must change this password at next sign-in; every active session is revoked."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button loading={reset.isPending} onClick={() => reset.mutate()}>Reset password</Button>
          </>
        }
      >
        <Field label="New password" required hint="At least 10 characters, with upper, lower and a number.">
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(disable)}
        title="Disable employee?"
        message={<>{disable?.name} will be signed out immediately and cannot log in until re-enabled.</>}
        confirmLabel="Disable access"
        danger
        loading={deactivate.isPending}
        onClose={() => setDisable(null)}
        onConfirm={() => deactivate.mutate()}
      />
    </div>
  );
}

function EmployeeForm({
  form,
  setForm,
  stations,
  roles,
  toggleStation,
}: {
  form: typeof blank;
  setForm: (value: typeof blank) => void;
  stations: { id: string; name: string; code: string }[];
  roles: RoleDef[];
  toggleStation: (list: string[], id: string) => string[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name" required>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email" required>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field label="Temporary password" required hint="They will be prompted to change it.">
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <Field label="Role" required>
        <Select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>{role.label}</option>
          ))}
        </Select>
      </Field>
      {form.roleKey !== 'OWNER' ? (
        <Field label="Station access" className="sm:col-span-2" hint="At least one station is required.">
          <div className="grid gap-2 sm:grid-cols-2">
            {stations.map((station) => (
              <label key={station.id} className="flex items-center gap-2 rounded-lg border border-navy-700/60 px-3 py-2 text-sm text-ink-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-navy-600 bg-navy-900 text-accent"
                  checked={form.stationIds.includes(station.id)}
                  onChange={() => setForm({ ...form, stationIds: toggleStation(form.stationIds, station.id) })}
                />
                {station.name} <span className="text-xs text-ink-500">{station.code}</span>
              </label>
            ))}
          </div>
        </Field>
      ) : null}
    </div>
  );
}
