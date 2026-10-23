import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CreditCard, ShieldBan, ShieldCheck } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
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
  KeyValue,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  useToast,
} from '../../components/ui';

interface TenantDetailData {
  tenant: {
    id: string; name: string; slug: string; legalName: string | null; gstin: string | null;
    contactEmail: string; contactPhone: string | null; city: string | null; state: string | null;
    status: string; isDemo: number; notes: string | null; createdAt: string;
  };
  subscription: {
    id: string; status: string; planName: string; planCode: string; monthlyPrice: string;
    startsAt: string; endsAt: string | null; trialEndsAt: string | null; maxStations: number; maxUsers: number;
  } | null;
  stations: { id: string; name: string; code: string; city: string | null; status: string }[];
  users: { id: string; name: string; email: string; roleKey: string; status: string; lastLoginAt: string | null }[];
  invoices: { id: string; invoiceNumber: string; periodStart: string; periodEnd: string; totalAmount: string; status: string; issuedAt: string; dueAt: string }[];
  devices: { id: string; name: string; code: string; stationName: string; status: string; isSimulated: number; lastHeartbeatAt: string | null }[];
  auditTrail: { id: string; action: string; summary: string | null; actorEmail: string | null; createdAt: string }[];
  usage: { stations: number; users: number; dispensers: number; maxStations: number | null; maxUsers: number | null; maxDispensers: number | null };
}

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [statusChange, setStatusChange] = useState<string | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({ planCode: '', trialDays: '0', status: 'ACTIVE' });
  const [payFor, setPayFor] = useState<{ id: string; invoiceNumber: string } | null>(null);
  const [payment, setPayment] = useState({ reference: '', method: 'BANK' });

  const query = useQuery<TenantDetailData>({
    queryKey: ['admin-tenant', id],
    queryFn: () => apiGet<TenantDetailData>(`/admin/tenants/${id}`),
    enabled: Boolean(id),
  });
  const plans = useQuery<{ code: string; name: string; monthlyPrice: string }[]>({
    queryKey: ['admin-plans'],
    queryFn: () => apiGet('/admin/plans'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
  };

  const setStatus = useMutation({
    mutationFn: (next: string) => apiPatch(`/admin/tenants/${id}`, { status: next }),
    onSuccess: () => {
      toast('Organization status updated', { tone: 'success' });
      setStatusChange(null);
      invalidate();
    },
    onError: (error: Error) => toast('Update failed', { tone: 'danger', description: error.message }),
  });

  const changePlan = useMutation({
    mutationFn: () =>
      apiPost(`/admin/tenants/${id}/subscription`, {
        planCode: renewForm.planCode,
        status: renewForm.status,
        trialDays: Number(renewForm.trialDays),
      }),
    onSuccess: () => {
      toast('Subscription updated', { tone: 'success', description: 'The previous active subscription was cancelled and audited.' });
      setRenewOpen(false);
      invalidate();
    },
    onError: (error: Error) => toast('Could not update subscription', { tone: 'danger', description: error.message }),
  });

  const markPaid = useMutation({
    mutationFn: () => apiPost(`/admin/invoices/${payFor?.id}/mark-paid`, { paymentReference: payment.reference, paymentMethod: payment.method }),
    onSuccess: () => {
      toast('Invoice marked paid', { tone: 'success' });
      setPayFor(null);
      setPayment({ reference: '', method: 'BANK' });
      invalidate();
    },
    onError: (error: Error) => toast('Could not mark paid', { tone: 'danger', description: error.message }),
  });

  if (query.isLoading) return <LoadingBlock label="Loading organization…" rows={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  const tenant = data.tenant;
  const sub = data.subscription;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/admin/tenants" className="inline-flex items-center gap-1 hover:text-ink-300">
            <ArrowLeft className="h-3 w-3" /> Organizations
          </Link>
        }
        title={tenant.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {tenant.slug} · onboarded {formatDate(tenant.createdAt)}
            <StatusBadge status={tenant.status} />
            {tenant.isDemo ? <Badge tone="warning">DEMO</Badge> : null}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setRenewOpen(true); setRenewForm({ planCode: sub?.planCode ?? plans.data?.[0]?.code ?? '', trialDays: '0', status: 'ACTIVE' }); }}>
              <CreditCard className="h-4 w-4" /> Change plan
            </Button>
            <Button
              variant={tenant.status === 'SUSPENDED' ? 'primary' : 'danger'}
              onClick={() => setStatusChange(tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}
            >
              {tenant.status === 'SUSPENDED' ? <ShieldCheck className="h-4 w-4" /> : <ShieldBan className="h-4 w-4" />}
              {tenant.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="label">Subscription</p>
          <p className="text-lg text-ink-100">{sub?.planName ?? 'None'}</p>
          <div className="mt-1"><StatusBadge status={sub?.status ?? 'NONE'} /></div>
          <p className="mt-2 text-xs text-ink-500">
            {sub?.trialEndsAt ? `Trial ends ${formatDate(sub.trialEndsAt)}` : sub?.endsAt ? `Renews ${formatDate(sub.endsAt)}` : 'No end date'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="label">Stations</p>
          <p className="num text-lg text-ink-100">{data.usage.stations} <span className="text-xs text-ink-500">/ {data.usage.maxStations ?? '∞'}</span></p>
          <p className="mt-2 text-xs text-ink-500">Dispensers {data.usage.dispensers} / {data.usage.maxDispensers ?? '∞'}</p>
        </Card>
        <Card className="p-4">
          <p className="label">Users</p>
          <p className="num text-lg text-ink-100">{data.usage.users} <span className="text-xs text-ink-500">/ {data.usage.maxUsers ?? '∞'}</span></p>
          <p className="mt-2 text-xs text-ink-500">{data.users.filter((u) => u.status === 'ACTIVE').length} active</p>
        </Card>
        <Card className="p-4">
          <p className="label">Invoices unpaid</p>
          <p className="num text-lg text-ink-100">
            {formatINR(data.invoices.filter((i) => ['ISSUED', 'OVERDUE'].includes(i.status)).reduce((acc, i) => acc + Number(i.totalAmount), 0).toFixed(2))}
          </p>
          <p className="mt-2 text-xs text-ink-500">{data.invoices.length} invoices on record</p>
        </Card>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'stations', label: 'Stations', count: data.stations.length },
          { key: 'users', label: 'Users', count: data.users.length },
          { key: 'billing', label: 'Billing', count: data.invoices.length },
          { key: 'hardware', label: 'Hardware', count: data.devices.length },
          { key: 'audit', label: 'Audit trail', count: data.auditTrail.length },
        ]}
      />

      <div className="mt-4">
        {tab === 'overview' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Organization profile" />
              <div className="p-4">
                <KeyValue
                  items={[
                    { label: 'Legal name', value: tenant.legalName ?? '—' },
                    { label: 'GSTIN', value: tenant.gstin ?? '—' },
                    { label: 'Contact email', value: tenant.contactEmail },
                    { label: 'Contact phone', value: tenant.contactPhone ?? '—' },
                    { label: 'City', value: tenant.city ?? '—' },
                    { label: 'State', value: tenant.state ?? '—' },
                    { label: 'Status', value: <StatusBadge status={tenant.status} /> },
                    { label: 'Demo data', value: tenant.isDemo ? 'Yes — clearly labelled' : 'No' },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Platform notes" subtitle="Visible only to platform administrators." />
              <div className="p-4 text-sm text-ink-400">
                {tenant.notes || 'No notes recorded for this organization.'}
                <p className="mt-3 text-xs text-ink-500">
                  Platform administrators see subscription and aggregate operational metadata only. Fuel sales, customer credit and tank ledgers
                  belong to the tenant and are not exposed through this console.
                </p>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'stations' ? (
          <Card>
            <CardHeader title="Stations" action={<Link className="link text-xs" to={`/admin/stations?tenantId=${tenant.id}`}>Manage →</Link>} />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Station</th><th>City</th><th>Status</th></tr></thead>
                <tbody>
                  {data.stations.map((station) => (
                    <tr key={station.id}>
                      <td><span className="text-ink-100">{station.name}</span> <Badge tone="neutral">{station.code}</Badge></td>
                      <td className="text-ink-400">{station.city ?? '—'}</td>
                      <td><StatusBadge status={station.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'users' ? (
          <Card>
            <CardHeader title="Users" subtitle="Accounts are created by the tenant owner; no public registration exists." />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>User</th><th>Role</th><th>Last login</th><th>Status</th></tr></thead>
                <tbody>
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <td><p className="text-ink-100">{user.name}</p><p className="text-xs text-ink-500">{user.email}</p></td>
                      <td><Badge tone="neutral">{user.roleKey}</Badge></td>
                      <td className="text-xs text-ink-400">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</td>
                      <td><StatusBadge status={user.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'billing' ? (
          <Card>
            <CardHeader title="Subscription invoices" subtitle="Platform billing only. Settlement does not post to station cash." />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Invoice</th><th>Period</th><th className="text-right">Total</th><th>Due</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.invoices.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-sm text-ink-500">No invoices issued.</td></tr>
                  ) : (
                    data.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="font-mono text-xs text-ink-200">{invoice.invoiceNumber}</td>
                        <td className="text-xs text-ink-400">{formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}</td>
                        <td className="num text-right">{formatINR(invoice.totalAmount)}</td>
                        <td className="text-xs text-ink-400">{formatDate(invoice.dueAt)}</td>
                        <td><StatusBadge status={invoice.status} /></td>
                        <td className="text-right">
                          {invoice.status !== 'PAID' ? (
                            <Button size="sm" variant="outline" onClick={() => setPayFor({ id: invoice.id, invoiceNumber: invoice.invoiceNumber })}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'hardware' ? (
          <Card>
            <CardHeader title="Gateways" subtitle="Real hardware support is unverified; simulated gateways are labelled." />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Gateway</th><th>Station</th><th>Last heartbeat</th><th>Status</th></tr></thead>
                <tbody>
                  {data.devices.length === 0 ? (
                    <tr><td colSpan={4} className="py-6 text-center text-sm text-ink-500">No devices registered.</td></tr>
                  ) : (
                    data.devices.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <p className="text-ink-100">{device.name}</p>
                          <p className="text-xs text-ink-500">{device.code} {device.isSimulated ? '· SIMULATED' : ''}</p>
                        </td>
                        <td className="text-ink-400">{device.stationName}</td>
                        <td className="text-xs text-ink-400">{device.lastHeartbeatAt ? formatDateTime(device.lastHeartbeatAt) : 'Never'}</td>
                        <td><StatusBadge status={device.status} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'audit' ? (
          <Card>
            <CardHeader title="Tenant audit trail" subtitle="Platform actions affecting this organization." />
            {data.auditTrail.length === 0 ? (
              <EmptyState title="No audit records" description="Actions on this organization will appear here." />
            ) : (
              <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>When</th><th>Action</th><th>Summary</th><th>Actor</th></tr></thead>
                  <tbody>
                    {data.auditTrail.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap text-xs text-ink-400">{formatDateTime(row.createdAt)}</td>
                        <td><Badge tone="neutral">{row.action}</Badge></td>
                        <td className="text-sm text-ink-200">{row.summary ?? '—'}</td>
                        <td className="text-xs text-ink-400">{row.actorEmail ?? 'system'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(statusChange)}
        title={statusChange === 'SUSPENDED' ? 'Suspend organization?' : 'Reactivate organization?'}
        message={
          statusChange === 'SUSPENDED'
            ? 'Every tenant session is revoked immediately and the subscription is marked suspended. History is retained and the action is audited.'
            : 'Tenant access will be restored. Billing status is not changed automatically — update the subscription separately if required.'
        }
        confirmLabel={statusChange === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
        danger={statusChange === 'SUSPENDED'}
        loading={setStatus.isPending}
        onClose={() => setStatusChange(null)}
        onConfirm={() => statusChange && setStatus.mutate(statusChange)}
      />

      <Modal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        title="Change subscription plan"
        description="Creates a new subscription and cancels the current active one. Both records are retained for billing history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button loading={changePlan.isPending} onClick={() => changePlan.mutate()}>Apply plan</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan" required className="sm:col-span-2">
            <Select value={renewForm.planCode} onChange={(e) => setRenewForm({ ...renewForm, planCode: e.target.value })}>
              {(plans.data ?? []).map((plan) => (
                <option key={plan.code} value={plan.code}>{plan.name} · {formatINR(plan.monthlyPrice)}/mo</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={renewForm.status} onChange={(e) => setRenewForm({ ...renewForm, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="TRIALING">Trialing</option>
            </Select>
          </Field>
          <Field label="Trial days" hint="Ignored for an active subscription.">
            <Input type="number" min={0} max={90} value={renewForm.trialDays} onChange={(e) => setRenewForm({ ...renewForm, trialDays: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        title={`Mark ${payFor?.invoiceNumber ?? ''} paid`}
        description="Record the bank/UPI reference. This settles the platform invoice; it never posts to station cash."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button loading={markPaid.isPending} onClick={() => markPaid.mutate()}>Mark paid</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment reference" required>
            <Input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} placeholder="NEFT-88213" />
          </Field>
          <Field label="Method">
            <Select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
              <option value="BANK">Bank transfer</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
