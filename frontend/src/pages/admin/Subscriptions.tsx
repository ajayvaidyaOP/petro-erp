import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeIndianRupee, CheckCircle2, CreditCard, Plus } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDate, formatINR, todayIst } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
  Tabs,
  useToast,
} from '../../components/ui';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  annualPrice: string;
  maxStations: number;
  maxUsers: number;
  maxDispensers: number;
  trialDays: number;
  subscribers: number;
  features: string[];
  isActive: number;
}

interface Subscription {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  planName: string;
  planCode: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  trialEndsAt: string | null;
  monthlyPrice: string;
}

interface Invoice {
  id: string;
  tenantId: string;
  tenantName: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paymentReference: string | null;
}

const blankPlan = {
  code: '',
  name: '',
  description: '',
  monthlyPrice: '',
  annualPrice: '',
  maxStations: '2',
  maxUsers: '10',
  maxDispensers: '10',
  trialDays: '14',
  features: '',
};

export default function Subscriptions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('plans');
  const [planOpen, setPlanOpen] = useState(false);
  const [form, setForm] = useState({ ...blankPlan });
  const [invoiceFor, setInvoiceFor] = useState<Subscription | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ periodStart: todayIst(), periodEnd: todayIst(), amount: '', taxAmount: '0' });
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [payment, setPayment] = useState({ reference: '', method: 'BANK' });

  const plans = useQuery<Plan[]>({ queryKey: ['admin-plans'], queryFn: () => apiGet<Plan[]>('/admin/plans') });
  const subscriptions = useQuery<Subscription[]>({
    queryKey: ['admin-subscriptions'],
    queryFn: () => apiGet<Subscription[]>('/admin/subscriptions'),
  });
  const invoices = useQuery<Invoice[]>({
    queryKey: ['admin-invoices'],
    queryFn: () => apiGet<Invoice[]>('/admin/invoices'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-plans'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
  };

  const createPlan = useMutation({
    mutationFn: () =>
      apiPost('/admin/plans', {
        code: form.code,
        name: form.name,
        description: form.description || null,
        monthlyPrice: form.monthlyPrice,
        annualPrice: form.annualPrice || undefined,
        maxStations: Number(form.maxStations),
        maxUsers: Number(form.maxUsers),
        maxDispensers: Number(form.maxDispensers),
        trialDays: Number(form.trialDays),
        features: form.features ? form.features.split(',').map((f) => f.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      toast('Plan created', { tone: 'success' });
      setPlanOpen(false);
      setForm({ ...blankPlan });
      invalidate();
    },
    onError: (error: Error) => toast('Could not create plan', { tone: 'danger', description: error.message }),
  });

  const togglePlan = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiPatch(`/admin/plans/${id}`, { isActive }),
    onSuccess: () => {
      toast('Plan updated', { tone: 'success' });
      invalidate();
    },
    onError: (error: Error) => toast('Update failed', { tone: 'danger', description: error.message }),
  });

  const createInvoice = useMutation({
    mutationFn: () =>
      apiPost(`/admin/tenants/${invoiceFor?.tenantId}/invoices`, {
        periodStart: invoiceForm.periodStart,
        periodEnd: invoiceForm.periodEnd,
        amount: invoiceForm.amount || undefined,
        taxAmount: invoiceForm.taxAmount || '0',
        dueInDays: 7,
      }),
    onSuccess: () => {
      toast('Invoice issued', { tone: 'success' });
      setInvoiceFor(null);
      invalidate();
    },
    onError: (error: Error) => toast('Could not issue invoice', { tone: 'danger', description: error.message }),
  });

  const markPaid = useMutation({
    mutationFn: () => apiPost(`/admin/invoices/${payFor?.id}/mark-paid`, { paymentReference: payment.reference, paymentMethod: payment.method }),
    onSuccess: () => {
      toast('Invoice marked paid', { tone: 'success' });
      setPayFor(null);
      setPayment({ reference: '', method: 'BANK' });
      invalidate();
    },
    onError: (error: Error) => toast('Could not mark invoice paid', { tone: 'danger', description: error.message }),
  });

  const outstanding = (invoices.data ?? [])
    .filter((invoice) => ['ISSUED', 'OVERDUE'].includes(invoice.status))
    .reduce((acc, invoice) => acc + Number(invoice.totalAmount), 0);

  return (
    <div>
      <PageHeader
        title="Subscriptions & Billing"
        description="Plans, tenant subscriptions and platform invoices. Subscription revenue is tracked separately from tenant fuel sales."
        actions={
          <Button variant="primary" size="sm" onClick={() => setPlanOpen(true)}>
            <Plus className="h-4 w-4" /> New plan
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Plans" value={plans.data?.length ?? 0} icon={<BadgeIndianRupee className="h-4 w-4" />} />
        <StatCard label="Active subscriptions" value={(subscriptions.data ?? []).filter((s) => s.status === 'ACTIVE').length} tone="success" />
        <StatCard label="Trialing" value={(subscriptions.data ?? []).filter((s) => s.status === 'TRIALING').length} tone="warning" />
        <StatCard label="Unpaid invoices" value={formatINR(outstanding.toFixed(2))} tone={outstanding > 0 ? 'warning' : 'default'} icon={<CreditCard className="h-4 w-4" />} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'plans', label: 'Plans', count: plans.data?.length },
          { key: 'subscriptions', label: 'Subscriptions', count: subscriptions.data?.length },
          { key: 'invoices', label: 'Invoices', count: invoices.data?.length },
        ]}
      />

      <div className="mt-4">
        {tab === 'plans' ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.isLoading ? <LoadingBlock /> : plans.isError ? <ErrorState error={plans.error} /> : (plans.data ?? []).length === 0 ? (
              <Card className="lg:col-span-3"><EmptyState title="No plans" description="Create a plan before onboarding organizations." /></Card>
            ) : (
              (plans.data ?? []).map((plan) => (
                <Card key={plan.id}>
                  <CardHeader
                    title={<span className="flex items-center gap-2">{plan.name} <Badge tone="neutral">{plan.code}</Badge></span>}
                    subtitle={plan.description ?? undefined}
                    action={<StatusBadge status={plan.isActive ? 'ACTIVE' : 'INACTIVE'} />}
                  />
                  <div className="p-4">
                    <p className="num text-2xl text-ink-100">{formatINR(plan.monthlyPrice)}<span className="text-sm text-ink-500">/mo</span></p>
                    <p className="text-xs text-ink-500">Annual {formatINR(plan.annualPrice)} · {plan.subscribers} active subscribers</p>
                    <ul className="mt-3 space-y-1 text-sm text-ink-300">
                      <li>{plan.maxStations} stations</li>
                      <li>{plan.maxUsers} users</li>
                      <li>{plan.maxDispensers} dispensers</li>
                      <li>{plan.trialDays}-day trial</li>
                    </ul>
                    {(plan.features ?? []).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {plan.features.map((feature) => <Badge key={feature} tone="info">{feature}</Badge>)}
                      </div>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-4 w-full"
                      loading={togglePlan.isPending}
                      onClick={() => togglePlan.mutate({ id: plan.id, isActive: !plan.isActive })}
                    >
                      {plan.isActive ? 'Deactivate plan' : 'Activate plan'}
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        ) : null}

        {tab === 'subscriptions' ? (
          <Card>
            {subscriptions.isLoading ? <LoadingBlock /> : subscriptions.isError ? <ErrorState error={subscriptions.error} /> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Started</th><th>Ends</th><th className="text-right">Monthly</th><th /></tr></thead>
                  <tbody>
                    {(subscriptions.data ?? []).map((sub) => (
                      <tr key={sub.id}>
                        <td><span className="text-ink-100">{sub.tenantName}</span><p className="text-xs text-ink-500">{sub.tenantSlug}</p></td>
                        <td className="text-ink-300">{sub.planName}</td>
                        <td><StatusBadge status={sub.status} /></td>
                        <td className="text-xs text-ink-400">{formatDate(sub.startsAt)}</td>
                        <td className="text-xs text-ink-400">{sub.endsAt ? formatDate(sub.endsAt) : sub.trialEndsAt ? `trial → ${formatDate(sub.trialEndsAt)}` : '—'}</td>
                        <td className="num text-right">{formatINR(sub.monthlyPrice)}</td>
                        <td className="text-right">
                          <Button size="sm" variant="outline" onClick={() => { setInvoiceFor(sub); setInvoiceForm({ periodStart: todayIst(), periodEnd: todayIst(), amount: sub.monthlyPrice, taxAmount: '0' }); }}>
                            Issue invoice
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}

        {tab === 'invoices' ? (
          <Card>
            {invoices.isLoading ? <LoadingBlock /> : invoices.isError ? <ErrorState error={invoices.error} /> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Organization</th><th>Period</th><th className="text-right">Total</th><th>Due</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {(invoices.data ?? []).map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="font-mono text-xs text-ink-200">{invoice.invoiceNumber}</td>
                        <td className="text-ink-300">{invoice.tenantName}</td>
                        <td className="text-xs text-ink-400">{formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}</td>
                        <td className="num text-right">{formatINR(invoice.totalAmount)}</td>
                        <td className="text-xs text-ink-400">{formatDate(invoice.dueAt)}</td>
                        <td>
                          <StatusBadge status={invoice.status} />
                          {invoice.paymentReference ? <p className="text-[11px] text-ink-500">{invoice.paymentReference}</p> : null}
                        </td>
                        <td className="text-right">
                          {invoice.status !== 'PAID' ? (
                            <Button size="sm" variant="outline" onClick={() => setPayFor(invoice)}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}
      </div>

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        size="lg"
        title="New subscription plan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button loading={createPlan.isPending} onClick={() => createPlan.mutate()}>Create plan</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" required hint="Uppercase, e.g. GROWTH">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Monthly price (₹)" required>
            <Input inputMode="decimal" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} />
          </Field>
          <Field label="Annual price (₹)" hint="Leave blank for 12 × monthly less 10%.">
            <Input inputMode="decimal" value={form.annualPrice} onChange={(e) => setForm({ ...form, annualPrice: e.target.value })} />
          </Field>
          <Field label="Max stations">
            <Input type="number" min={1} value={form.maxStations} onChange={(e) => setForm({ ...form, maxStations: e.target.value })} />
          </Field>
          <Field label="Max users">
            <Input type="number" min={1} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} />
          </Field>
          <Field label="Max dispensers">
            <Input type="number" min={1} value={form.maxDispensers} onChange={(e) => setForm({ ...form, maxDispensers: e.target.value })} />
          </Field>
          <Field label="Trial days">
            <Input type="number" min={0} max={90} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
          </Field>
          <Field label="Features" className="sm:col-span-2" hint="Comma separated, e.g. DSR exports, multiple stations">
            <Input value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(invoiceFor)}
        onClose={() => setInvoiceFor(null)}
        title={`Issue invoice — ${invoiceFor?.tenantName ?? ''}`}
        description="Invoices are numbered sequentially per day. Issuing an invoice does not mark it paid."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInvoiceFor(null)}>Cancel</Button>
            <Button loading={createInvoice.isPending} onClick={() => createInvoice.mutate()}>Issue invoice</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Period start" required>
            <Input type="date" value={invoiceForm.periodStart} onChange={(e) => setInvoiceForm({ ...invoiceForm, periodStart: e.target.value })} />
          </Field>
          <Field label="Period end" required>
            <Input type="date" value={invoiceForm.periodEnd} onChange={(e) => setInvoiceForm({ ...invoiceForm, periodEnd: e.target.value })} />
          </Field>
          <Field label="Amount (₹)" hint="Defaults to the plan's monthly price.">
            <Input inputMode="decimal" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} />
          </Field>
          <Field label="Tax (₹)">
            <Input inputMode="decimal" value={invoiceForm.taxAmount} onChange={(e) => setInvoiceForm({ ...invoiceForm, taxAmount: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        title={`Mark ${payFor?.invoiceNumber ?? ''} paid`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button loading={markPaid.isPending} onClick={() => markPaid.mutate()}>Mark paid</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment reference" required>
            <Input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />
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
