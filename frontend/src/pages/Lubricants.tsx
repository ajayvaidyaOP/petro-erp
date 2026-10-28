import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets, PackagePlus, Pencil, Plus, ShoppingCart, Truck } from 'lucide-react';
import { PAYMENT_MODES } from '@petroflow/shared';
import { apiGet, apiList, apiPatch, apiPost, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDateTime, formatINR, formatNumber } from '../lib/format';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, PageHeader, Pagination, Select, TableScrollHint, useToast,
} from '../components/ui';

interface LubeProduct {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  packSize: string;
  gstRatePct: string;
  purchaseRate: string;
  saleRate: string;
  isActive: number;
  stockQty: string;
}

interface LubeMovement {
  id: string;
  productName: string;
  packSize: string;
  type: string;
  quantity: string;
  rate: string;
  amount: string;
  paymentMode: string | null;
  customerName: string | null;
  vehicleNumber: string | null;
  occurredAt: string;
  note: string | null;
}

interface CustomerOption { id: string; name: string; code: string }

type MovementType = 'PURCHASE' | 'SALE' | 'OPENING' | 'ADJUSTMENT';

const emptyProduct = { code: '', name: '', brand: '', packSize: '1 L', gstRatePct: '18', purchaseRate: '', saleRate: '' };

export default function Lubricants() {
  const { can } = useAuth();
  const { stationId, station } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [productOpen, setProductOpen] = useState(false);
  const [editing, setEditing] = useState<LubeProduct | null>(null);
  const [productForm, setProductForm] = useState({ ...emptyProduct });
  const [moveType, setMoveType] = useState<MovementType | null>(null);
  const [moveForm, setMoveForm] = useState({ productId: '', quantity: '', rate: '', paymentMode: 'CASH', customerId: '', vehicleNumber: '', note: '' });

  const products = useQuery<LubeProduct[]>({
    queryKey: ['lube-products', stationId],
    queryFn: () => apiGet<LubeProduct[]>(`/lubricants/products?stationId=${stationId}`),
    enabled: Boolean(stationId),
  });
  const movements = useQuery<{ data: LubeMovement[]; meta: ListMeta }>({
    queryKey: ['lube-movements', stationId, page],
    queryFn: () => apiList<LubeMovement>(`/lubricants/movements?stationId=${stationId}&page=${page}&pageSize=15`),
    enabled: Boolean(stationId),
  });
  const customers = useQuery<CustomerOption[]>({
    queryKey: ['customers-min'],
    queryFn: () => apiGet<CustomerOption[]>('/catalog/customers?pageSize=100'),
    enabled: moveType === 'SALE',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['lube-products'] });
    void queryClient.invalidateQueries({ queryKey: ['lube-movements'] });
  };

  const saveProduct = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/lubricants/products/${editing.id}`, productForm)
      : apiPost('/lubricants/products', productForm),
    onSuccess: () => {
      toast(editing ? 'Lubricant updated' : 'Lubricant added to catalog');
      setProductOpen(false); setEditing(null); setProductForm({ ...emptyProduct });
      invalidate();
    },
    onError: (error: Error) => toast('Save nahi hua', { tone: 'danger', description: error.message }),
  });

  const saveMovement = useMutation({
    mutationFn: () => apiPost('/lubricants/movements', {
      stationId, type: moveType, productId: moveForm.productId, quantity: moveForm.quantity,
      rate: moveForm.rate || undefined,
      paymentMode: moveType === 'SALE' ? moveForm.paymentMode : undefined,
      customerId: moveType === 'SALE' && moveForm.paymentMode === 'CREDIT' ? moveForm.customerId || undefined : undefined,
      vehicleNumber: moveForm.vehicleNumber || undefined, note: moveForm.note || undefined,
    }),
    onSuccess: () => {
      toast(moveType === 'SALE' ? 'Sale recorded' : 'Stock updated');
      setMoveType(null);
      setMoveForm({ productId: '', quantity: '', rate: '', paymentMode: 'CASH', customerId: '', vehicleNumber: '', note: '' });
      invalidate();
    },
    onError: (error: Error) => toast('Save nahi hua', { tone: 'danger', description: error.message }),
  });

  const stockValue = useMemo(
    () => (products.data ?? []).reduce((acc, p) => acc + Number(p.stockQty) * Number(p.purchaseRate), 0),
    [products.data],
  );

  if (!can('lubricants.read')) {
    return (
      <>
        <PageHeader title="Lubricants & Oil" />
        <Card><EmptyState title="Lubricants access required" description="Is screen ke liye lubricants permission chahiye." icon={<Droplets className="h-4 w-4" />} /></Card>
      </>
    );
  }

  const openMove = (type: MovementType, product?: LubeProduct) => {
    setMoveType(type);
    setMoveForm({
      productId: product?.id ?? '', quantity: '', rate: product ? (type === 'SALE' ? product.saleRate : product.purchaseRate) : '',
      paymentMode: 'CASH', customerId: '', vehicleNumber: '', note: '',
    });
  };

  return (
    <>
      <PageHeader
        title="Lubricants & Oil"
        description={`${station?.name ?? ''} ka oil counter — pack-wise stock, kharid-bikri aur GST-ready hisaab. Stock value (kharid par): ${formatINR(stockValue, true)}`}
        actions={can('lubricants.write') ? (
          <>
            <Button variant="outline" size="sm" icon={<PackagePlus className="h-4 w-4" />} onClick={() => { setEditing(null); setProductForm({ ...emptyProduct }); setProductOpen(true); }}>
              New item
            </Button>
            <Button variant="primary" size="sm" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => openMove('SALE')}>
              Becho (Sale)
            </Button>
          </>
        ) : undefined}
      />

      <Card>
        <CardHeader title="Stock" subtitle="Har pack ka current stock. Lal = stock khatm honay wala hai." />
        <TableScrollHint />
        {products.isLoading ? (
          <LoadingBlock rows={4} />
        ) : products.isError ? (
          <div className="p-4"><ErrorState error={products.error} onRetry={() => void products.refetch()} /></div>
        ) : (products.data ?? []).length === 0 ? (
          <EmptyState
            title="Catalog khaali hai"
            description="Jo oil/lubricant rakhte ho wo yahan add karo — phir purchase se stock badhao aur counter se becho."
            icon={<Droplets className="h-4 w-4" />}
            action={can('lubricants.write') ? <Button size="sm" variant="primary" onClick={() => setProductOpen(true)}>Pehla item add karo</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Pack</th>
                  <th className="text-right">Stock (pack)</th>
                  <th className="text-right">Kharid ₹</th>
                  <th className="text-right">Bikri ₹ (GST incl.)</th>
                  <th>Margin ₹</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(products.data ?? []).map((product) => {
                  const qty = Number(product.stockQty);
                  return (
                    <tr key={product.id} className={Number(product.isActive) === 0 ? 'opacity-50' : undefined}>
                      <td>
                        <p className="font-medium text-ink-100">{product.name}</p>
                        <p className="text-[10px] text-ink-500">{product.code}{product.brand ? ` · ${product.brand}` : ''} · GST {product.gstRatePct}%</p>
                      </td>
                      <td className="text-xs">{product.packSize}</td>
                      <td className="num text-right">
                        <span className={qty <= 0 ? 'font-bold text-danger' : qty <= 5 ? 'font-semibold text-warn' : 'text-ink-100'}>{formatNumber(qty, 0)}</span>
                        {qty <= 0 && <Badge tone="danger" className="ml-2">Out</Badge>}
                        {qty > 0 && qty <= 5 && <Badge tone="warning" className="ml-2">Kam hai</Badge>}
                      </td>
                      <td className="num text-right">{formatINR(product.purchaseRate)}</td>
                      <td className="num text-right">{formatINR(product.saleRate)}</td>
                      <td className="num text-xs text-ok">{formatINR(Number(product.saleRate) - Number(product.purchaseRate))}</td>
                      <td className="text-right whitespace-nowrap">
                        {can('lubricants.write') && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openMove('PURCHASE', product)} icon={<Truck className="h-3.5 w-3.5" />}>Kharid</Button>
                            <Button size="sm" variant="ghost" onClick={() => openMove('SALE', product)} icon={<ShoppingCart className="h-3.5 w-3.5" />}>Becho</Button>
                            <Button size="sm" variant="ghost" aria-label="Edit item" onClick={() => {
                              setEditing(product);
                              setProductForm({
                                code: product.code, name: product.name, brand: product.brand ?? '', packSize: product.packSize,
                                gstRatePct: product.gstRatePct, purchaseRate: product.purchaseRate, saleRate: product.saleRate,
                              });
                              setProductOpen(true);
                            }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <CardHeader title="Recent kharid-bikri" subtitle="Lubricant counter ki saari entries." />
        <TableScrollHint />
        {movements.isLoading ? (
          <LoadingBlock rows={4} />
        ) : movements.isError ? (
          <div className="p-4"><ErrorState error={movements.error} onRetry={() => void movements.refetch()} /></div>
        ) : (movements.data?.data ?? []).length === 0 ? (
          <EmptyState title="Abhi koi entry nahi" description="Purchase ya sale karte hi yahan dikh jayegi." icon={<Droplets className="h-4 w-4" />} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr><th>Samay</th><th>Item</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Mode / Customer</th></tr>
                </thead>
                <tbody>
                  {(movements.data?.data ?? []).map((move) => (
                    <tr key={move.id}>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(move.occurredAt)}</td>
                      <td className="text-xs">{move.productName} <span className="text-ink-500">({move.packSize})</span></td>
                      <td><Badge tone={move.type === 'SALE' ? 'accent' : move.type === 'PURCHASE' ? 'success' : 'neutral'}>{move.type}</Badge></td>
                      <td className="num text-right">{formatNumber(move.quantity, 0)}</td>
                      <td className="num text-right">{formatINR(move.amount)}</td>
                      <td className="text-xs text-ink-400">{move.paymentMode ?? '—'}{move.customerName ? ` · ${move.customerName}` : ''}{move.vehicleNumber ? ` · ${move.vehicleNumber}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {movements.data && (
              <Pagination page={movements.data.meta.page} pageSize={movements.data.meta.pageSize} total={movements.data.meta.total} totalPages={movements.data.meta.totalPages} onPage={setPage} />
            )}
          </>
        )}
      </Card>

      <Modal
        open={productOpen}
        onClose={() => setProductOpen(false)}
        title={editing ? 'Edit lubricant' : 'New lubricant item'}
        description="Rate GST-samet (inclusive) rakho jaise MRP hota hai — GST report khud taxable value alag kar legi."
        footer={
          <>
            <Button variant="ghost" onClick={() => setProductOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saveProduct.isPending} disabled={!productForm.name || (!editing && !productForm.code)} onClick={() => saveProduct.mutate()}>
              {editing ? 'Save changes' : 'Add item'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && (
            <Field label="Code" required hint="e.g. SERVO-4T-900">
              <Input value={productForm.code} onChange={(e) => setProductForm({ ...productForm, code: e.target.value.toUpperCase() })} />
            </Field>
          )}
          <Field label="Naam" required>
            <Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
          </Field>
          <Field label="Brand">
            <Input value={productForm.brand} onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} />
          </Field>
          <Field label="Pack size" required>
            <Input value={productForm.packSize} onChange={(e) => setProductForm({ ...productForm, packSize: e.target.value })} />
          </Field>
          <Field label="GST %">
            <Input inputMode="decimal" value={productForm.gstRatePct} onChange={(e) => setProductForm({ ...productForm, gstRatePct: e.target.value })} />
          </Field>
          <Field label="Kharid rate ₹">
            <Input inputMode="decimal" value={productForm.purchaseRate} onChange={(e) => setProductForm({ ...productForm, purchaseRate: e.target.value })} />
          </Field>
          <Field label="Bikri rate ₹ (MRP)">
            <Input inputMode="decimal" value={productForm.saleRate} onChange={(e) => setProductForm({ ...productForm, saleRate: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={moveType !== null}
        onClose={() => setMoveType(null)}
        title={moveType === 'SALE' ? 'Lubricant becho' : moveType === 'PURCHASE' ? 'Lubricant kharid — stock andar' : 'Stock entry'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveType(null)}>Cancel</Button>
            <Button variant="primary" loading={saveMovement.isPending} disabled={!moveForm.productId || !moveForm.quantity} onClick={() => saveMovement.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Item" required>
            <Select value={moveForm.productId} onChange={(e) => {
              const product = (products.data ?? []).find((p) => p.id === e.target.value);
              setMoveForm({ ...moveForm, productId: e.target.value, rate: product ? (moveType === 'SALE' ? product.saleRate : product.purchaseRate) : moveForm.rate });
            }}>
              <option value="">Item chuno…</option>
              {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.packSize}) — stock {formatNumber(p.stockQty, 0)}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity (pack)" required>
              <Input inputMode="decimal" value={moveForm.quantity} onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })} />
            </Field>
            <Field label="Rate ₹ / pack">
              <Input inputMode="decimal" value={moveForm.rate} onChange={(e) => setMoveForm({ ...moveForm, rate: e.target.value })} />
            </Field>
          </div>
          {moveType === 'SALE' && (
            <>
              <Field label="Payment mode" required>
                <Select value={moveForm.paymentMode} onChange={(e) => setMoveForm({ ...moveForm, paymentMode: e.target.value })}>
                  {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </Select>
              </Field>
              {moveForm.paymentMode === 'CREDIT' && (
                <Field label="Credit customer" required>
                  <Select value={moveForm.customerId} onChange={(e) => setMoveForm({ ...moveForm, customerId: e.target.value })}>
                    <option value="">Customer chuno…</option>
                    {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Gaadi number">
                <Input placeholder="MH12AB1234" value={moveForm.vehicleNumber} onChange={(e) => setMoveForm({ ...moveForm, vehicleNumber: e.target.value.toUpperCase() })} />
              </Field>
            </>
          )}
          <Field label="Note">
            <Input value={moveForm.note} onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} />
          </Field>
          {moveForm.quantity && moveForm.rate && (
            <p className="rounded-xl bg-navy-800/50 px-3 py-2 text-sm text-ink-300">
              Total: <strong className="num text-ink-100">{formatINR(Number(moveForm.quantity) * Number(moveForm.rate))}</strong>
            </p>
          )}
        </div>
      </Modal>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-500">
        <Plus className="h-3 w-3" /> Tip: Mahine ki GST-ready list Reports → Exports se download hoti hai (CA ko dene ke liye).
      </div>
    </>
  );
}
