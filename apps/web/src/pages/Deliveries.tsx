import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, PackageCheck, Plus, Scale, Truck } from 'lucide-react';
import { apiGet, apiList, apiPost, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDate, formatDateTime, formatINR, formatNumber } from '../lib/format';
import { downloadCsv } from '../lib/utils';
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
  Pagination,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
} from '../components/ui';

interface Delivery {
  id: string;
  stationId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  tankId: string;
  tankCode: string;
  productId: string;
  productName: string;
  quantityLitres: string;
  receivedLitres: string | null;
  ratePerLitre: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  receivedAt: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  notes: string | null;
  supplierPaidTotal: string;
  stationName: string;
}

interface Tank { id: string; code: string; name: string; productId: string; productName: string; stationId: string }
interface Supplier { id: string; name: string }
interface Product { id: string; name: string; code: string }

export default function Deliveries() {
  const { can } = useAuth();
  const { stationId, station } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveDelivery, setReceiveDelivery] = useState<Delivery | null>(null);
  const [disputeDelivery, setDisputeDelivery] = useState<Delivery | null>(null);

  const list = useQuery({
    queryKey: ['deliveries', stationId, status, search, page],
    queryFn: () =>
      apiList<Delivery>(
        `/inventory/deliveries?stationId=${stationId}&page=${page}&pageSize=15${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled: Boolean(stationId),
  });

  const tanks = useQuery({
    queryKey: ['tanks-lite', stationId],
    queryFn: () => apiGet<Tank[]>(`/catalog/tanks?stationId=${stationId}&pageSize=100`),
    enabled: Boolean(stationId) && can('tanks.read'),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers-lite'],
    queryFn: () => apiGet<Supplier[]>('/catalog/suppliers?pageSize=100'),
    enabled: can('suppliers.read'),
  });
  const products = useQuery({
    queryKey: ['products-lite'],
    queryFn: () => apiGet<Product[]>('/catalog/products?pageSize=50'),
    enabled: can('products.read'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost('/inventory/deliveries', payload),
    onSuccess: () => { toast('Delivery recorded'); setCreateOpen(false); invalidate(); },
    onError: (e) => toast('Could not record delivery', { tone: 'danger', description: (e as Error).message }),
  });

  const receive = useMutation({
    mutationFn: ({ id, receivedLitres, notes }: { id: string; receivedLitres: string; notes?: string }) =>
      apiPost<Delivery & { discrepancyLitres?: string }>(`/inventory/deliveries/${id}/receive`, { receivedLitres, notes }),
    onSuccess: (row: Delivery & { discrepancyLitres?: string }) => {
      const discrepancy = Number(row.discrepancyLitres ?? 0);
      toast('Delivery received into tank', {
        tone: Math.abs(discrepancy) > 0.5 ? 'warning' : 'success',
        description: `${formatNumber(row.receivedLitres ?? '0', 3)} L accepted${Math.abs(discrepancy) > 0.001 ? ` · ${formatNumber(row.discrepancyLitres!, 3)} L variance vs invoice` : ''}`,
      });
      setReceiveDelivery(null);
      invalidate();
    },
    onError: (e) => toast('Could not receive delivery', { tone: 'danger', description: (e as Error).message }),
  });

  const dispute = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiPost(`/inventory/deliveries/${id}/dispute`, { reason }),
    onSuccess: () => { toast('Delivery marked disputed', { tone: 'warning' }); setDisputeDelivery(null); invalidate(); },
    onError: (e) => toast('Could not dispute delivery', { tone: 'danger', description: (e as Error).message }),
  });

  if (!stationId) return <EmptyState title="No station assigned" />;

  const rows = list.data?.data ?? [];
  const meta: ListMeta = list.data?.meta ?? { page: 1, pageSize: 15, total: 0, totalPages: 1 };
  const receivedValue = rows.filter((r) => r.status === 'RECEIVED').reduce((a, r) => a + Number(r.totalAmount), 0);
  const pending = rows.filter((r) => r.status === 'DRAFT').length;

  return (
    <>
      <PageHeader
        title="Supplier deliveries"
        description={`${station?.name ?? ''} · purchase invoices and tank receipts`}
        actions={
          can('deliveries.write') ? (
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Record delivery</Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Deliveries listed" value={meta.total} hint="Filtered purchase invoices" icon={<Truck className="h-4 w-4" />} />
        <StatCard label="Awaiting receipt" value={pending} hint="Draft invoices not yet in the tank" tone={pending > 0 ? 'warning' : 'default'} icon={<PackageCheck className="h-4 w-4" />} />
        <StatCard label="Received value (page)" value={formatINR(receivedValue, true)} hint="Includes invoice tax" icon={<Scale className="h-4 w-4" />} />
        <StatCard label="Stock impact" value="On receipt" hint="Draft invoices do not move stock" icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Purchase & delivery register"
          subtitle="Received quantity updates the tank ledger; invoiced quantity is retained for reconciliation"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Invoice or supplier…" className="w-48" />
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-8 w-32 py-1 text-xs">
                <option value="">All statuses</option>
                {['DRAFT', 'RECEIVED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() =>
                  downloadCsv(
                    `deliveries-${stationId}.csv`,
                    rows.map((r) => ({
                      invoice: r.invoiceNumber,
                      date: r.invoiceDate,
                      supplier: r.supplierName,
                      product: r.productName,
                      orderedLitres: r.quantityLitres,
                      receivedLitres: r.receivedLitres,
                      rate: r.ratePerLitre,
                      tax: r.taxAmount,
                      total: r.totalAmount,
                      status: r.status,
                    })),
                  )
                }
              >
                CSV
              </Button>
            </div>
          }
        />
        {list.isLoading ? (
          <LoadingBlock rows={5} />
        ) : list.isError ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No deliveries recorded" description="Record a supplier purchase invoice to track incoming fuel." icon={<Truck className="h-4 w-4" />} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th><th>Supplier</th><th>Product / tank</th>
                    <th className="text-right">Ordered</th><th className="text-right">Received</th>
                    <th className="text-right">Rate</th><th className="text-right">Total</th>
                    <th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((delivery) => {
                    const short = delivery.quantityLitres && delivery.receivedLitres
                      ? Number(delivery.receivedLitres) - Number(delivery.quantityLitres)
                      : null;
                    return (
                      <tr key={delivery.id}>
                        <td>
                          <p className="font-mono text-xs text-ink-200">{delivery.invoiceNumber}</p>
                          <p className="text-[10px] text-ink-500">{formatDate(delivery.invoiceDate)}</p>
                        </td>
                        <td className="text-sm text-ink-200">{delivery.supplierName}
                          <span className="block text-[10px] text-ink-500">{delivery.vehicleNumber ?? '—'}</span>
                        </td>
                        <td className="text-xs text-ink-300">{delivery.productName}
                          <span className="block text-[10px] text-ink-500">{delivery.tankCode} · {delivery.stationName}</span>
                        </td>
                        <td className="num text-right">{formatNumber(delivery.quantityLitres, 3)} L</td>
                        <td className={`num text-right ${short !== null && Math.abs(short) > 0.5 ? 'text-amber-300' : ''}`}>
                          {delivery.receivedLitres ? `${formatNumber(delivery.receivedLitres, 3)} L` : '—'}
                          {short !== null && Math.abs(short) > 0.001 && <span className="block text-[10px]">{formatNumber(String(short), 3)} L</span>}
                        </td>
                        <td className="num text-right">{formatINR(delivery.ratePerLitre)}</td>
                        <td className="num text-right font-medium">{formatINR(delivery.totalAmount)}</td>
                        <td><StatusBadge status={delivery.status} /></td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            {can('deliveries.write') && delivery.status === 'DRAFT' && (
                              <Button size="sm" variant="secondary" onClick={() => setReceiveDelivery(delivery)}>Receive</Button>
                            )}
                            {can('deliveries.write') && delivery.status !== 'DISPUTED' && delivery.status !== 'RECEIVED' && (
                              <Button size="sm" variant="ghost" onClick={() => setDisputeDelivery(delivery)}>Dispute</Button>
                            )}
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

      <DeliveryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        stationId={stationId}
        tanks={tanks.data ?? []}
        suppliers={suppliers.data ?? []}
        products={products.data ?? []}
        loading={create.isPending}
        onSubmit={(payload) => create.mutate(payload)}
      />

      {receiveDelivery && (
        <ReceiveModal
          delivery={receiveDelivery}
          loading={receive.isPending}
          onClose={() => setReceiveDelivery(null)}
          onSubmit={(receivedLitres, notes) => receive.mutate({ id: receiveDelivery.id, receivedLitres, notes })}
        />
      )}

      {disputeDelivery && (
        <DisputeModal
          delivery={disputeDelivery}
          loading={dispute.isPending}
          onClose={() => setDisputeDelivery(null)}
          onSubmit={(reason) => dispute.mutate({ id: disputeDelivery.id, reason })}
        />
      )}
    </>
  );
}

function DeliveryModal({
  open,
  onClose,
  stationId,
  tanks,
  suppliers,
  products,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  stationId: string;
  tanks: Tank[];
  suppliers: Supplier[];
  products: Product[];
  loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    supplierId: suppliers[0]?.id ?? '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    tankId: tanks[0]?.id ?? '',
    quantityLitres: '',
    ratePerLitre: '',
    taxAmount: '',
    vehicleNumber: '',
    driverName: '',
    notes: '',
    receiveNow: true,
    receivedLitres: '',
  });

  const tank = tanks.find((t) => t.id === form.tankId);
  const total = Number(form.quantityLitres || 0) * Number(form.ratePerLitre || 0) + Number(form.taxAmount || 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record supplier delivery"
      description="The invoice is stored first; stock moves only when the delivery is received."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={!form.supplierId || !form.invoiceNumber || !form.tankId || !form.quantityLitres || !form.ratePerLitre}
            onClick={() =>
              onSubmit({
                stationId,
                supplierId: form.supplierId,
                invoiceNumber: form.invoiceNumber,
                invoiceDate: form.invoiceDate,
                productId: tank?.productId ?? products[0]?.id,
                tankId: form.tankId,
                quantityLitres: form.quantityLitres,
                ratePerLitre: form.ratePerLitre,
                taxAmount: form.taxAmount || '0',
                vehicleNumber: form.vehicleNumber || undefined,
                driverName: form.driverName || undefined,
                notes: form.notes || undefined,
                receiveNow: form.receiveNow,
                receivedLitres: form.receiveNow ? form.receivedLitres || form.quantityLitres : undefined,
              })
            }
          >
            Save delivery
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" required>
          <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Invoice number" required><Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></Field>
        <Field label="Invoice date" required><Input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} /></Field>
        <Field label="Tank" required hint={tank ? `Product: ${tank.productName}` : undefined}>
          <Select value={form.tankId} onChange={(e) => setForm({ ...form, tankId: e.target.value })}>
            <option value="">Select tank…</option>
            {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.productName}</option>)}
          </Select>
        </Field>
        <Field label="Quantity (litres)" required><Input inputMode="decimal" value={form.quantityLitres} onChange={(e) => setForm({ ...form, quantityLitres: e.target.value })} /></Field>
        <Field label="Rate per litre (INR)" required><Input inputMode="decimal" value={form.ratePerLitre} onChange={(e) => setForm({ ...form, ratePerLitre: e.target.value })} /></Field>
        <Field label="Tax amount (INR)"><Input inputMode="decimal" value={form.taxAmount} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })} /></Field>
        <Field label="Vehicle number"><Input value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} placeholder="MH12AB1234" /></Field>
        <Field label="Driver name"><Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></Field>
        <Field label="Receive now">
          <Select value={form.receiveNow ? '1' : '0'} onChange={(e) => setForm({ ...form, receiveNow: e.target.value === '1' })}>
            <option value="1">Yes — add to tank stock</option>
            <option value="0">No — keep as draft</option>
          </Select>
        </Field>
        {form.receiveNow && (
          <Field label="Received quantity (litres)" hint="Leave blank to receive the full invoiced quantity">
            <Input inputMode="decimal" value={form.receivedLitres} onChange={(e) => setForm({ ...form, receivedLitres: e.target.value })} />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2 rounded-lg border border-navy-700/60 bg-navy-900/40 px-3 py-2 text-xs text-ink-400">
          Invoice value: <span className="num font-semibold text-ink-100">{formatINR(total)}</span>
          <span className="ml-2 text-ink-600">(quantity × rate + tax)</span>
        </div>
      </div>
    </Modal>
  );
}

function ReceiveModal({
  delivery,
  loading,
  onClose,
  onSubmit,
}: {
  delivery: Delivery;
  loading: boolean;
  onClose: () => void;
  onSubmit: (receivedLitres: string, notes?: string) => void;
}) {
  const [litres, setLitres] = useState(delivery.quantityLitres);
  const [notes, setNotes] = useState('');
  const variance = Number(litres || 0) - Number(delivery.quantityLitres);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive delivery · ${delivery.invoiceNumber}`}
      description={`${delivery.productName} into ${delivery.tankCode} · invoice ${formatNumber(delivery.quantityLitres, 3)} L`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} disabled={!litres || Number(litres) <= 0} onClick={() => onSubmit(litres, notes || undefined)}>Receive into tank</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Received quantity (litres)" required>
          <Input inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} />
        </Field>
        {Math.abs(variance) > 0.001 && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
            Variance vs invoice: <span className="num font-semibold">{formatNumber(String(variance), 3)} L</span>. Short deliveries are recorded on the audit trail.
          </div>
        )}
        <Field label="Receipt notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dip before/after, seal number, driver signature…" /></Field>
      </div>
    </Modal>
  );
}

function DisputeModal({
  delivery,
  loading,
  onClose,
  onSubmit,
}: {
  delivery: Delivery;
  loading: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispute delivery · ${delivery.invoiceNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} disabled={reason.trim().length < 5} onClick={() => onSubmit(reason.trim())}>Mark disputed</Button>
        </>
      }
    >
      <Field label="Reason" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Quantity short, quality issue, rate mismatch…" />
      </Field>
      <p className="mt-2 text-[11px] text-ink-500">
        Disputed deliveries cannot be received until resolved. They never create stock movements or payable entries.
      </p>
    </Modal>
  );
}
