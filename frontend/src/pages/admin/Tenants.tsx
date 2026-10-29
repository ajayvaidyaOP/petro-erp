import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, ExternalLink, Plus, Search, ShieldBan, ShieldCheck } from 'lucide-react';
import { apiGet, apiList, apiPatch, apiPost, type ListMeta } from '../../lib/api';
import { formatDate } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  useToast,
} from '../../components/ui';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  gstin: string | null;
  contactEmail: string;
  contactPhone: string | null;
  status: string;
  isDemo: number;
  stationCount: number;
  userCount: number;
  planName: string | null;
  planCode: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  createdAt: string;
}

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  maxStations: number;
  maxUsers: number;
  trialDays: number;
}

const empty = {
  name: '',
  slug: '',
  legalName: '',
  gstin: '',
  contactEmail: '',
  contactPhone: '',
  city: '',
  state: 'Maharashtra',
  planCode: '',
  trialDays: '14',
  ownerName: '',
  ownerEmail: '',
  ownerPassword: '',
  createDefaultStation: true,
};

export default function Tenants() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [suspend, setSuspend] = useState<{ tenant: Tenant; next: string } | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const tenants = useQuery<{ data: Tenant[]; meta: ListMeta }>({
    queryKey: ['admin-tenants', params.toString()],
    queryFn: () => apiList<Tenant>(`/admin/tenants?${params.toString()}`),
  });
  const plans = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: () => apiGet<Plan[]>('/admin/plans'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
  };

  const create = useMutation({
    mutationFn: () => apiPost('/admin/tenants', { ...form, trialDays: Number(form.trialDays) }),
    onSuccess: () => {
      toast('Organization onboarded', { tone: 'success', description: 'The owner can now sign in with the credentials you set.' });
      setCreateOpen(false);
      setForm({ ...empty });
      invalidate();
    },
    onError: (error: Error) => toast('Onboarding failed', { tone: 'danger', description: error.message }),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) => apiPatch(`/admin/tenants/${id}`, { status: nextStatus }),
    onSuccess: (_data, vars) => {
      toast(vars.nextStatus === 'SUSPENDED' ? 'Organization suspended' : 'Organization reactivated', {
        tone: 'success',
        description: vars.nextStatus === 'SUSPENDED' ? 'All tenant sessions were revoked.' : undefined,
      });
      setSuspend(null);
      invalidate();
    },
    onError: (error: Error) => toast('Could not update organization', { tone: 'danger', description: error.message }),
  });

  const rows = tenants.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Tenant lifecycle for the platform. Suspension blocks every tenant session immediately; no station data is deleted."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Onboard organization
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-navy-700/60 p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input
              className="pl-8"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, slug or email"
            />
          </div>
          <Field label="Status" className="w-full sm:w-44">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="PENDING">Pending</option>
            </Select>
          </Field>
        </div>

        {tenants.isLoading ? (
          <LoadingBlock />
        ) : tenants.isError ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th>Subscription</th>
                    <th className="text-right">Stations</th>
                    <th className="text-right">Users</th>
                    <th>Onboarded</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sm text-ink-500">No organizations match this filter.</td>
                    </tr>
                  ) : (
                    rows.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Link to={`/admin/tenants/${tenant.id}`} className="link font-medium">{tenant.name}</Link>
                            {tenant.isDemo ? <Badge tone="warning">DEMO</Badge> : null}
                          </div>
                          <p className="text-xs text-ink-500">{tenant.slug} · {tenant.contactEmail}</p>
                        </td>
                        <td className="text-sm text-ink-300">{tenant.planName ?? '—'}</td>
                        <td><StatusBadge status={tenant.subscriptionStatus ?? 'NONE'} /></td>
                        <td className="text-right tabular-nums">{tenant.stationCount}</td>
                        <td className="text-right tabular-nums">{tenant.userCount}</td>
                        <td className="text-xs text-ink-400">{formatDate(tenant.createdAt)}</td>
                        <td><StatusBadge status={tenant.status} /></td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setSuspend({ tenant, next: tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })}>
                              {tenant.status === 'SUSPENDED' ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldBan className="h-3.5 w-3.5" />}
                              {tenant.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                            </Button>
                            <Link to={`/admin/tenants/${tenant.id}`}>
                              <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /> Open</Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {tenants.data ? (
              <Pagination
                page={tenants.data.meta.page}
                pageSize={tenants.data.meta.pageSize}
                total={tenants.data.meta.total}
                totalPages={tenants.data.meta.totalPages}
                onPage={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="lg"
        title="Onboard organization"
        description="Creates the tenant, an OWNER account, the subscription and optionally one station. No public self-registration exists."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create organization</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organization name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Slug" required hint="Lowercase letters, numbers and hyphens.">
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
          </Field>
          <Field label="Legal name">
            <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Contact email" required>
            <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </Field>
          <Field label="Plan" required>
            <Select value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
              <option value="">Select a plan…</option>
              {(plans.data ?? []).map((plan) => (
                <option key={plan.id} value={plan.code}>{plan.name} · {plan.maxStations} stations · ₹{plan.monthlyPrice}/mo</option>
              ))}
            </Select>
          </Field>
          <Field label="Trial days">
            <Input type="number" min={0} max={90} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
          </Field>

          <div className="sm:col-span-2 mt-2 border-t border-navy-700/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Owner account</p>
          </div>
          <Field label="Owner name" required>
            <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label="Owner email" required>
            <Input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
          </Field>
          <Field label="Initial password" required hint="Minimum 10 characters with mixed case and a number.">
            <Input type="password" value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} />
          </Field>
          <Field label="First station">
            <Select
              value={form.createDefaultStation ? 'yes' : 'no'}
              onChange={(e) => setForm({ ...form, createDefaultStation: e.target.value === 'yes' })}
            >
              <option value="yes">Create a default station</option>
              <option value="no">No station yet</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(suspend)}
        title={suspend?.next === 'SUSPENDED' ? 'Suspend organization?' : 'Reactivate organization?'}
        message={
          suspend?.next === 'SUSPENDED' ? (
            <>
              <strong className="text-ink-200">{suspend?.tenant.name}</strong> will lose access immediately and all sessions are revoked.
              Financial history and audit logs are retained. This action is audited.
            </>
          ) : (
            <>Access will be restored for <strong className="text-ink-200">{suspend?.tenant.name}</strong> and its subscription set back to active.</>
          )
        }
        confirmLabel={suspend?.next === 'SUSPENDED' ? 'Suspend organization' : 'Reactivate'}
        danger={suspend?.next === 'SUSPENDED'}
        loading={changeStatus.isPending}
        onClose={() => setSuspend(null)}
        onConfirm={() => suspend && changeStatus.mutate({ id: suspend.tenant.id, nextStatus: suspend.next })}
      />
    </div>
  );
}
