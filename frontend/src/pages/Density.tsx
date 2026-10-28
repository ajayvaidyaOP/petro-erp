import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Printer, Thermometer, Trash2 } from 'lucide-react';
import { apiDelete, apiList, apiPost, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDate, formatNumber, shiftDate, todayIst } from '../lib/format';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input,
  LoadingBlock, Modal, PageHeader, Pagination, Select, TableScrollHint, useToast,
} from '../components/ui';

interface DensityCheck {
  id: string;
  businessDate: string;
  checkedAt: string;
  tankCode: string;
  tankName: string;
  productName: string;
  productCategory: string;
  productColor: string;
  observedDensity: string;
  observedTempC: string;
  densityAt15c: string;
  specMin: string | null;
  specMax: string | null;
  withinSpec: number;
  source: string;
  checkedByName: string | null;
  note: string | null;
}

interface TankOption {
  id: string;
  code: string;
  name: string;
  productId: string;
}

interface ProductOption {
  id: string;
  name: string;
  category: string;
}

const CORRECTION: Record<string, number> = { PETROL: 0.7, DIESEL: 0.64 };
const SPEC: Record<string, [number, number]> = { PETROL: [720, 775], DIESEL: [810, 860] };

export default function Density() {
  const { can } = useAuth();
  const { stationId, station } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(shiftDate(todayIst(), -6));
  const [to, setTo] = useState(todayIst());
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const checks = useQuery<{ data: DensityCheck[]; meta: ListMeta }>({
    queryKey: ['density', stationId, from, to, page],
    queryFn: () => apiList<DensityCheck>(`/density?stationId=${stationId}&from=${from}&to=${to}&page=${page}&pageSize=20`),
    enabled: Boolean(stationId),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/density/${deleteId}`),
    onSuccess: () => {
      toast('Density entry deleted');
      setDeleteId(null);
      void queryClient.invalidateQueries({ queryKey: ['density'] });
    },
    onError: (error: Error) => toast('Delete failed', { tone: 'danger', description: error.message }),
  });

  if (!can('density.read')) {
    return (
      <>
        <PageHeader title="Density Register" />
        <Card><EmptyState title="Density access required" description="Is screen ke liye density permission chahiye. Apne manager se bolo." icon={<FlaskConical className="h-4 w-4" />} /></Card>
      </>
    );
  }

  const rows = checks.data?.data ?? [];
  const outOfSpec = rows.filter((r) => Number(r.withinSpec) === 0).length;

  return (
    <>
      <PageHeader
        title="Density Register"
        description={`Subah ki density check — ${station?.name ?? ''}. Observed density ko 15°C par correct karke spec se milaya jata hai, OMC inspection isi register se hoti hai.`}
        actions={
          <>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-auto" aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-auto" aria-label="To date" />
            <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
            {can('density.write') && (
              <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                New check
              </Button>
            )}
          </>
        }
      />

      {outOfSpec > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-danger">
          <FlaskConical className="h-4 w-4 shrink-0" />
          <span>
            <strong>{outOfSpec} entry spec se bahar hai</strong> is period me — turant manager ko batao, sample retain karo, OMC officer ko inform karo.
          </span>
        </div>
      )}

      <Card>
        <CardHeader
          title="Density entries"
          subtitle="Density @15°C = observed + correction × (temperature − 15). Petrol spec 720–775, Diesel 810–860 kg/m³."
          action={<Badge tone="accent">{checks.data?.meta.total ?? rows.length} entries</Badge>}
        />
        <TableScrollHint />
        {checks.isLoading ? (
          <LoadingBlock rows={5} />
        ) : checks.isError ? (
          <div className="p-4"><ErrorState error={checks.error} onRetry={() => void checks.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Is period me koi density check nahi"
            description="Roz subah har tank ki density check karke yahan entry karo — yehi register inspection me dikhta hai."
            icon={<Thermometer className="h-4 w-4" />}
            action={can('density.write') ? <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>Pehli entry karo</Button> : undefined}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Tank · Product</th>
                    <th className="text-right">Observed (kg/m³)</th>
                    <th className="text-right">Temp °C</th>
                    <th className="text-right">Density @15°C</th>
                    <th>Spec range</th>
                    <th>Result</th>
                    <th>Checked by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-xs">{formatDate(row.businessDate)}</td>
                      <td>
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="h-2 w-2 rounded-full" style={{ background: row.productColor }} />
                          <span className="font-medium text-ink-100">{row.tankCode}</span> · {row.productName}
                        </span>
                      </td>
                      <td className="num text-right">{formatNumber(row.observedDensity, 1)}</td>
                      <td className="num text-right">{formatNumber(row.observedTempC, 1)}</td>
                      <td className="num text-right font-semibold text-ink-100">{formatNumber(row.densityAt15c, 1)}</td>
                      <td className="num text-xs text-ink-500">{row.specMin && row.specMax ? `${row.specMin}–${row.specMax}` : '—'}</td>
                      <td>
                        {Number(row.withinSpec) === 1
                          ? <Badge tone="success" dot>Spec me hai</Badge>
                          : <Badge tone="danger" dot>Spec se bahar!</Badge>}
                      </td>
                      <td className="text-xs text-ink-400">{row.checkedByName ?? '—'}</td>
                      <td className="text-right">
                        {can('dayclose.manage') && (
                          <Button size="sm" variant="ghost" aria-label="Delete density entry" onClick={() => setDeleteId(row.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {checks.data && (
              <Pagination
                page={checks.data.meta.page}
                pageSize={checks.data.meta.pageSize}
                total={checks.data.meta.total}
                totalPages={checks.data.meta.totalPages}
                onPage={setPage}
              />
            )}
          </>
        )}
      </Card>

      <CreateDensityModal open={createOpen} onClose={() => setCreateOpen(false)} stationId={stationId} />
      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => remove.mutate()}
        title="Density entry delete karu?"
        message="Register ki entry mit jayegi (audit log me record rahega). Galat entry ho tabhi delete karo, warna nayi sahi entry kar do."
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
      />
    </>
  );
}

function CreateDensityModal({ open, onClose, stationId }: { open: boolean; onClose: () => void; stationId: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tankId, setTankId] = useState('');
  const [date, setDate] = useState(todayIst());
  const [observed, setObserved] = useState('');
  const [temp, setTemp] = useState('');
  const [source, setSource] = useState('NOZZLE');
  const [note, setNote] = useState('');

  const tanks = useQuery<{ data: TankOption[]; meta: ListMeta }>({
    queryKey: ['catalog-tanks', stationId],
    queryFn: () => apiList<TankOption>(`/catalog/tanks?stationId=${stationId}&pageSize=100`),
    enabled: open && Boolean(stationId),
  });
  const products = useQuery<{ data: ProductOption[]; meta: ListMeta }>({
    queryKey: ['catalog-products-min'],
    queryFn: () => apiList<ProductOption>('/catalog/products?pageSize=100'),
    enabled: open,
  });

  const selectedTank = tanks.data?.data.find((t) => t.id === tankId);
  const category = products.data?.data.find((p) => p.id === selectedTank?.productId)?.category ?? 'PETROL';
  const preview = useMemo(() => {
    const o = Number(observed);
    const t = Number(temp);
    if (!o || Number.isNaN(t) || observed === '' || temp === '') return null;
    const k = CORRECTION[category] ?? 0.7;
    const at15 = o + k * (t - 15);
    const spec = SPEC[category];
    return { at15: at15.toFixed(1), within: spec ? at15 >= spec[0] && at15 <= spec[1] : true, spec };
  }, [observed, temp, category]);

  const create = useMutation({
    mutationFn: () => apiPost('/density', {
      stationId, tankId, businessDate: date, observedDensity: observed, observedTempC: temp, source, note: note || undefined,
    }),
    onSuccess: () => {
      toast('Density check saved', { description: preview ? `@15°C: ${preview.at15} kg/m³` : undefined });
      setObserved(''); setTemp(''); setNote('');
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['density'] });
    },
    onError: (error: Error) => toast('Save nahi hua', { tone: 'danger', description: error.message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New density check"
      description="Hydrometer + thermometer se padhi gayi values daalo. Density hamesha kg/m³ me (742.5), 0.742 nahi."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!tankId || !observed || !temp} onClick={() => create.mutate()}>
            Save check
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Tank" required>
          <Select value={tankId} onChange={(e) => setTankId(e.target.value)}>
            <option value="">Tank chuno…</option>
            {(tanks.data?.data ?? []).map((tank) => (
              <option key={tank.id} value={tank.id}>{tank.code} · {tank.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Business date" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Observed density (kg/m³)" required>
            <Input inputMode="decimal" placeholder="742.5" value={observed} onChange={(e) => setObserved(e.target.value)} />
          </Field>
          <Field label="Temperature (°C)" required>
            <Input inputMode="decimal" placeholder="31.0" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </Field>
        </div>
        <Field label="Sample kahan se liya">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="NOZZLE">Nozzle se</option>
            <option value="TANK">Tank se</option>
            <option value="TT_SAMPLE">TT sample se</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input placeholder="e.g. Subah 7 baje ki check" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {preview && (
          <div className={`rounded-xl border px-3 py-2.5 text-sm ${preview.within ? 'border-emerald-500/30 bg-emerald-500/[0.07] text-ok' : 'border-rose-500/30 bg-rose-500/[0.07] text-danger'}`}>
            Density @15°C ≈ <strong className="num">{preview.at15} kg/m³</strong>
            {preview.spec && <span className="text-xs"> · spec {preview.spec[0]}–{preview.spec[1]} · {preview.within ? 'spec me hai ✓' : 'SPEC SE BAHAR!'}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
