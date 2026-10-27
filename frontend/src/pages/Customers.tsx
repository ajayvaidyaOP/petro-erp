import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, IndianRupee, Plus, UserPlus, Users } from 'lucide-react';
import { apiGet, apiList, apiPatch, apiPost, idempotencyKey, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDate, formatDateTime, formatINR, formatNumber, todayIst } from '../lib/format';
import {
  Badge,
  TableScrollHint,
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
  Pagination,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
} from '../components/ui';

interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  creditLimit: string;
  creditDays: number;
  balance: string;
  status: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amount: string;
  reference: string | null;
  occurredAt: string;
  dueDate: string | null;
  note: string | null;
  runningBalance: string;
  stationName: string | null;
}

interface Ledger {
  customer: Customer;
  entries: LedgerEntry[];
  closingBalance: string;
  creditLimit: string;
  availableCredit: string;
  overdueEntries: Record<string, unknown>[];
}

interface Product { id: string; code: string; name: string; isActive: number }

const emptyCustomer = {
  code: '',
  name: '',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  creditLimit: '50000',
  creditDays: 15,
  status: 'ACTIVE',
};

export default function Customers() {
  const { can } = useAuth();
  const { stationId } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyCustomer });
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const list = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => apiList<Customer>(`/catalog/customers?page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });

  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiGet<Product[]>('/catalog/products?pageSize=50'),
    enabled: can('products.read'),
  });

  const ledger = useQuery({
    queryKey: ['customer-ledger', ledgerCustomer?.id],
    queryFn: () => apiGet<Ledger>(`/finance/customer-ledger?customerId=${ledgerCustomer!.id}`),
    enabled: Boolean(ledgerCustomer),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['customer-ledger'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: () => apiPost('/catalog/customers', form),
    onSuccess: () => {
      toast('Customer created');
      setCreateOpen(false);
      setForm({ ...emptyCustomer });
      invalidate();
    },
    onError: (error) => toast('Could not create customer', { tone: 'danger', description: (error as Error).message }),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/catalog/customers/${editCustomer!.id}`, {
        name: editCustomer!.name,
        phone: editCustomer!.phone,
        email: editCustomer!.email,
        gstin: editCustomer!.gstin,
        address: editCustomer!.address,
        creditLimit: editCustomer!.creditLimit,
        creditDays: editCustomer!.creditDays,
        status: editCustomer!.status,
      }),
    onSuccess: () => {
      toast('Customer updated');
      setEditCustomer(null);
      invalidate();
    },
    onError: (error) => toast('Update failed', { tone: 'danger', description: (error as Error).message }),
  });

  const rows = list.data?.data ?? [];
  const meta: ListMeta = list.data?.meta ?? { page: 1, pageSize: 15, total: 0, totalPages: 1 };
  const totalOutstanding = rows.reduce((acc, c) => acc + Number(c.balance), 0);

  return (
    <>
      <PageHeader
        title="Customers & credit ledger"
        description="Credit limits, outstanding balances and customer receipts. Credit sales are never counted as cash received."
        actions={
          can('customers.write') ? (
            <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              New customer
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Customers" value={meta.total} hint="Active and blocked accounts" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Outstanding (listed)" value={formatINR(totalOutstanding, true)} hint="Sum of positive customer balances" icon={<IndianRupee className="h-4 w-4" />} tone={totalOutstanding > 0 ? 'warning' : 'default'} />
        <StatCard
          label="Credit exposure"
          value={formatINR(rows.reduce((acc, c) => acc + Number(c.creditLimit), 0), true)}
          hint="Total sanctioned credit limits"
          icon={<BookOpen className="h-4 w-4" />}
        />
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Customer accounts"
          subtitle="Balances are derived from the credit entry ledger"
          action={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, code, phone…" className="w-full sm:w-56" />}
        />
        {list.isLoading ? (
          <LoadingBlock rows={5} />
        ) : list.isError ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No customers yet" description="Add credit customers to track fuel on account and receipts." action={can('customers.write') ? <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>New customer</Button> : undefined} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="text-right">Credit limit</th>
                    <th className="text-right">Balance</th>
                    <th>Limit use</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((customer) => {
                    const limit = Number(customer.creditLimit);
                    const balance = Number(customer.balance);
                    const util = limit > 0 ? Math.min(100, (balance / limit) * 100) : 0;
                    return (
                      <tr key={customer.id}>
                        <td>
                          <p className="font-medium text-ink-100">{customer.name}</p>
                          <p className="text-[10px] text-ink-500">{customer.code}{customer.gstin ? ` · ${customer.gstin}` : ''}</p>
                        </td>
                        <td className="text-xs text-ink-400">{customer.phone ?? '—'}<br /><span className="text-ink-600">{customer.email ?? ''}</span></td>
                        <td><StatusBadge status={customer.status} /></td>
                        <td className="num text-right text-ink-400">{formatINR(customer.creditLimit)}</td>
                        <td className={`num text-right ${balance > 0 ? 'text-warn' : 'text-ink-300'}`}>{formatINR(customer.balance)}</td>
                        <td className="w-36">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-navy-700">
                              <div className={`h-full rounded-full ${util > 90 ? 'bg-rose-400' : util > 70 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${util}%` }} />
                            </div>
                            <span className="text-[10px] text-ink-500">{formatNumber(util, 0)}%</span>
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setLedgerCustomer(customer)}>Ledger</Button>
                            {can('customers.write') && <Button size="sm" variant="ghost" onClick={() => setEditCustomer({ ...customer })}>Edit</Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...meta} onPage={setPage} />
          </>
        )}
      </Card>

      {/* Create customer */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New credit customer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={createMutation.isPending} disabled={!form.name || !form.code} onClick={() => createMutation.mutate()}>
              Create customer
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer code" required>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CUST-004" />
          </Field>
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></Field>
          <Field label="Credit limit (INR)"><Input inputMode="decimal" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></Field>
          <Field label="Credit days"><Input type="number" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: Number(e.target.value) })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        </div>
      </Modal>

      {/* Edit customer */}
      <Modal
        open={Boolean(editCustomer)}
        onClose={() => setEditCustomer(null)}
        title="Edit customer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditCustomer(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMutation.isPending} onClick={() => updateMutation.mutate()}>Save changes</Button>
          </>
        }
      >
        {editCustomer && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={editCustomer.name} onChange={(e) => setEditCustomer({ ...editCustomer, name: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={editCustomer.status} onChange={(e) => setEditCustomer({ ...editCustomer, status: e.target.value })}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="BLOCKED">BLOCKED</option>
              </Select>
            </Field>
            <Field label="Phone"><Input value={editCustomer.phone ?? ''} onChange={(e) => setEditCustomer({ ...editCustomer, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={editCustomer.email ?? ''} onChange={(e) => setEditCustomer({ ...editCustomer, email: e.target.value })} /></Field>
            <Field label="Credit limit (INR)"><Input value={editCustomer.creditLimit} onChange={(e) => setEditCustomer({ ...editCustomer, creditLimit: e.target.value })} /></Field>
            <Field label="Credit days"><Input type="number" value={editCustomer.creditDays} onChange={(e) => setEditCustomer({ ...editCustomer, creditDays: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Modal>

      {/* Ledger */}
      <Modal
        open={Boolean(ledgerCustomer)}
        onClose={() => setLedgerCustomer(null)}
        title={ledgerCustomer ? `${ledgerCustomer.name} · credit ledger` : 'Credit ledger'}
        description={ledger.data ? `Closing balance ${formatINR(ledger.data.closingBalance)} · available credit ${formatINR(ledger.data.availableCredit)}` : undefined}
        size="xl"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {can('sales.write') && (
                <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSaleOpen(true)}>
                  Credit sale
                </Button>
              )}
              {can('payments.write') && (
                <Button size="sm" variant="primary" onClick={() => setReceiptOpen(true)}>Record receipt</Button>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setLedgerCustomer(null)}>Close</Button>
          </div>
        }
      >
        {ledger.isLoading ? (
          <LoadingBlock rows={4} />
        ) : ledger.isError ? (
          <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : ledger.data ? (
          <div className="space-y-3">
            {(ledger.data.overdueEntries.length ?? 0) > 0 && (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-danger">
                {ledger.data.overdueEntries.length} overdue credit sale(s) beyond the agreed credit period.
              </div>
            )}
            <TableScrollHint className="rounded-t-lg border border-b-0 border-navy-700/60" />
            <div className="table-wrap rounded-b-lg border border-t-0 border-navy-700/60">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Reference</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Running</th></tr>
                </thead>
                <tbody>
                  {ledger.data.entries.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-xs text-ink-500">No ledger entries yet.</td></tr>
                  ) : (
                    ledger.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="text-xs text-ink-400">{formatDateTime(entry.occurredAt)}</td>
                        <td>
                          <Badge tone={entry.type === 'CREDIT_SALE' ? 'warning' : entry.type === 'PAYMENT' ? 'success' : 'neutral'}>
                            {entry.type.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="text-xs text-ink-400">{entry.reference ?? '—'}</td>
                        <td className="text-xs text-ink-500">{entry.dueDate ? formatDate(entry.dueDate) : '—'}</td>
                        <td className={`num text-right ${Number(entry.amount) >= 0 ? 'text-warn' : 'text-ok'}`}>{formatINR(entry.amount)}</td>
                        <td className="num text-right text-ink-200">{formatINR(entry.runningBalance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-500">Credit sales increase the balance; receipts reduce it. A credit sale is never treated as cash received.</p>
          </div>
        ) : null}
      </Modal>

      {ledgerCustomer && (
        <>
          <CreditSaleModal
            open={saleOpen}
            onClose={() => setSaleOpen(false)}
            customer={ledgerCustomer}
            stationId={stationId}
            products={products.data ?? []}
            onDone={() => { setSaleOpen(false); invalidate(); }}
          />
          <ReceiptModal
            open={receiptOpen}
            onClose={() => setReceiptOpen(false)}
            customer={ledgerCustomer}
            stationId={stationId}
            onDone={() => { setReceiptOpen(false); invalidate(); }}
          />
        </>
      )}
    </>
  );
}

function CreditSaleModal({
  open,
  onClose,
  customer,
  stationId,
  products,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  stationId: string;
  products: Product[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (customer.creditDays || 15));
    return d.toISOString().slice(0, 10);
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiPost(
        '/finance/credit-sales',
        {
          stationId,
          customerId: customer.id,
          productId: productId || undefined,
          quantityLitres: quantity || undefined,
          amount: quantity ? undefined : amount,
          reference: reference || undefined,
          dueDate,
          paymentMode: 'CREDIT',
        },
        idempotencyKey('credit-sale'),
      ),
    onSuccess: () => {
      toast('Credit sale recorded', { description: 'Customer balance updated with a ledger entry.' });
      onDone();
    },
    onError: (error) => toast('Credit sale rejected', { tone: 'danger', description: (error as Error).message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Credit sale · ${customer.name}`}
      description={`Outstanding ${formatINR(customer.balance)} of limit ${formatINR(customer.creditLimit)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={!quantity && !amount} onClick={() => mutation.mutate()}>
            Post credit sale
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select product…</option>
            {products.filter((p) => Number(p.isActive) !== 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Quantity (litres)" hint="Rate is resolved from the effective price">
          <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 120.5" />
        </Field>
        <Field label="Or amount (INR)" hint="Use when quantity is unknown">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" disabled={Boolean(quantity)} />
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice/slip reference" />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} min={todayIst()} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ReceiptModal({
  open,
  onClose,
  customer,
  stationId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  stationId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiPost(
        '/finance/payments',
        {
          stationId,
          direction: 'RECEIPT',
          partyType: 'CUSTOMER',
          customerId: customer.id,
          amount,
          mode,
          reference: reference || undefined,
        },
        idempotencyKey('receipt'),
      ),
    onSuccess: () => {
      toast('Receipt recorded', { description: 'Balance reduced and payment stored separately from sales.' });
      onDone();
    },
    onError: (error) => toast('Receipt failed', { tone: 'danger', description: (error as Error).message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record receipt · ${customer.name}`}
      description={`Outstanding balance ${formatINR(customer.balance)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={!amount} onClick={() => mutation.mutate()}>
            Record receipt
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (INR)" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {['CASH', 'UPI', 'CARD', 'BANK'].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Reference" className="sm:col-span-2">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI/cheque/transaction reference" />
        </Field>
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Recording a receipt does not imply bank settlement. Digital payments can be marked settled later with a
        settlement reference.
      </p>
    </Modal>
  );
}
