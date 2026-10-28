import { useMemo, useState } from 'react';
import { CASH_DENOMINATIONS } from '@petroflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock, Download, Plus, RefreshCw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { apiGet, apiList, apiPatch, apiPost, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { unclosedShiftMessage, type ShiftAlertsResponse } from '../lib/shifts';
import { formatDateTime, formatINR, formatLitres, formatNumber, todayIst } from '../lib/format';
import { downloadCsv } from '../lib/utils';
import {
  Badge,
  TableScrollHint,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
} from '../components/ui';

interface ShiftRow {
  id: string;
  shiftNumber: number;
  businessDate: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  operatorName: string | null;
  totalLitres: string;
  totalValue: string;
  openingCash: string;
  closingCash: string;
  nozzleCount: number;
}

interface ShiftNozzle {
  id: string;
  nozzleId: string;
  nozzleLabel: string;
  nozzleNumber: number;
  dispenserCode: string;
  productName: string;
  productColor: string;
  openingReading: string | null;
  closingReading: string | null;
  openingSource: string | null;
  closingSource: string | null;
  litresSold: string | null;
  testingLitres: string;
  operatorId: string | null;
  rate: string | null;
  salesValue: string | null;
  varianceLitres: string | null;
  adjustmentLitres: string;
  adjustmentReason: string | null;
  status: string;
  note: string | null;
}

interface ShiftDetail extends Omit<ShiftRow, 'nozzleCount'> {
  stationName: string;
  stationCode: string;
  openedByName: string | null;
  closedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  closeNotes: string | null;
  notes: string | null;
  cashCounted: string | null;
  shortExcess: string | null;
  nozzles: ShiftNozzle[];
  settlements?: { mode: string; expectedAmount: string; receivedAmount: string | null; differenceAmount: string | null }[];
  denominations?: { denomination: number; count: number; amount: string }[];
  warnings?: string[];
  totals: { litres: string; value: string; testingLitres: string; nozzleCount: number; flaggedNozzles: number };
}

interface DayClosing {
  id: string;
  businessDate: string;
  status: string;
  closedByName: string | null;
  closedAt: string;
  reopenReason: string | null;
}

interface CapturePreview {
  shiftId: string;
  preview: { nozzleId: string; nozzle: string; closing: string | null; litres: string | null; status: string; note: string | null }[];
  note: string;
}

interface Employee {
  id: string;
  name: string;
  roleKey: string;
}

const statuses = ['OPEN', 'CLOSED', 'FLAGGED', 'REVERSED'];

export default function Shifts() {
  const { can } = useAuth();
  const { stationId, station } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [reverseModal, setReverseModal] = useState(false);
  const [editNozzle, setEditNozzle] = useState<ShiftNozzle | null>(null);
  const [capturePreview, setCapturePreview] = useState<CapturePreview | null>(null);

  const list = useQuery({
    queryKey: ['shifts', stationId, status, from, to, page],
    queryFn: () =>
      apiList<ShiftRow>(
        `/shifts?stationId=${stationId}&page=${page}&pageSize=15${status ? `&status=${status}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
      ),
    enabled: Boolean(stationId),
  });

  const detail = useQuery({
    queryKey: ['shift', selectedId],
    queryFn: () => apiGet<ShiftDetail>(`/shifts/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => apiGet<Employee[]>('/catalog/employees'),
    enabled: can('employees.read'),
  });

  const alertsQuery = useQuery({
    queryKey: ['shift-alerts', stationId],
    queryFn: () => apiGet<ShiftAlertsResponse>(`/shifts/alerts?stationId=${stationId}`),
    enabled: Boolean(stationId),
  });

  const invalidate = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
    void queryClient.invalidateQueries({ queryKey: ['shift-alerts'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['shift', id] });
  };

  const openMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost<ShiftDetail>('/shifts', payload),
    onSuccess: (shift) => {
      toast('Shift opened', { description: `Shift #${shift.shiftNumber} started at ${shift.stationName}.` });
      if (shift.warnings?.length) {
        toast('Opening warnings', { tone: 'warning', description: shift.warnings[0] });
      }
      setOpenModal(false);
      setSelectedId(shift.id);
      invalidate(shift.id);
    },
    onError: (error) => toast('Could not open shift', { tone: 'danger', description: (error as Error).message }),
  });

  const captureMutation = useMutation({
    mutationFn: (id: string) => apiPost<CapturePreview>(`/shifts/${id}/capture`),
    onSuccess: (preview) => {
      setCapturePreview(preview);
      toast('Closing preview ready', { description: preview.note });
    },
    onError: (error) => toast('Preview failed', { tone: 'danger', description: (error as Error).message }),
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiPost<ShiftDetail>(`/shifts/${id}/close`, payload),
    onSuccess: (shift) => {
      toast(shift.status === 'FLAGGED' ? 'Shift closed with variance flags' : 'Shift closed', {
        tone: shift.status === 'FLAGGED' ? 'warning' : 'success',
        description:
          shift.status === 'FLAGGED'
            ? 'Resolve the flagged nozzle readings and approve the shift.'
            : `${formatLitres(shift.totals.litres)} · ${formatINR(shift.totals.value)} aggregate estimated sales.`,
      });
      setCloseModal(false);
      invalidate(shift.id);
    },
    onError: (error) => toast('Close failed', { tone: 'danger', description: (error as Error).message }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiPost<ShiftDetail>(`/shifts/${id}/approve`, { note }),
    onSuccess: (shift) => {
      toast('Shift approved', { description: 'Variance flags were reviewed and the shift is closed.' });
      invalidate(shift.id);
    },
    onError: (error) => toast('Approval failed', { tone: 'danger', description: (error as Error).message }),
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<ShiftDetail>(`/shifts/${id}/reverse`, { reason }),
    onSuccess: (shift) => {
      toast('Shift reversed', { tone: 'warning', description: 'Stock movements were reversed with an audit record.' });
      setReverseModal(false);
      invalidate(shift.id);
    },
    onError: (error) => toast('Reversal failed', { tone: 'danger', description: (error as Error).message }),
  });

  const nozzleMutation = useMutation({
    mutationFn: ({ shiftId, nozzleId, payload }: { shiftId: string; nozzleId: string; payload: Record<string, unknown> }) =>
      apiPatch<ShiftDetail>(`/shifts/${shiftId}/nozzles/${nozzleId}`, payload),
    onSuccess: (shift) => {
      toast('Nozzle reading updated', { description: 'The change was written to the audit trail.' });
      setEditNozzle(null);
      setCapturePreview(null);
      invalidate(shift.id);
    },
    onError: (error) => toast('Update failed', { tone: 'danger', description: (error as Error).message }),
  });

  if (!stationId) {
    return <EmptyState title="No station assigned" description="Ask your owner to assign station access." />;
  }

  const rows = list.data?.data ?? [];
  const meta: ListMeta = list.data?.meta ?? { page: 1, pageSize: 15, total: 0, totalPages: 1 };
  const shift = detail.data;

  return (
    <>
      <PageHeader
        title="Shift management"
        description={`${station?.name ?? ''} · opening and closing totalizers, variance review and approvals`}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                downloadCsv(
                  `shifts-${todayIst()}.csv`,
                  rows.map((r) => ({
                    shift: r.shiftNumber,
                    date: r.businessDate,
                    status: r.status,
                    operator: r.operatorName ?? '',
                    litres: r.totalLitres,
                    value: r.totalValue,
                    opened: r.openedAt,
                    closed: r.closedAt ?? '',
                  })),
                )
              }
              disabled={rows.length === 0}
            >
              Export
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void list.refetch()}>
              Refresh
            </Button>
            {can('shifts.open') && (
              <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpenModal(true)}>
                Open shift
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open shifts" value={rows.filter((r) => r.status === 'OPEN').length} hint="On this page, currently accepting readings" icon={<Clock className="h-4 w-4" />} />
        <StatCard
          label="Flagged shifts"
          value={rows.filter((r) => r.status === 'FLAGGED').length}
          hint="On this page, awaiting variance approval"
          icon={<SlidersHorizontal className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Closed today"
          value={rows.filter((r) => r.status !== 'OPEN' && r.businessDate === todayIst()).length}
          hint={`${formatLitres(rows.reduce((acc, r) => acc + Number(r.totalLitres || 0), 0))} across listed shifts`}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {(alertsQuery.data?.alerts ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          {(alertsQuery.data?.alerts ?? []).slice(0, 3).map((alert) => (
            <div key={alert.id} className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-warn/90">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {unclosedShiftMessage(alert)}
            </div>
          ))}
        </div>
      )}

      <DayClosingCard stationId={stationId} canManage={can('dayclose.manage')} />

      <Card className="mt-3">
        <div className="flex flex-wrap items-end gap-2 border-b border-navy-700/60 p-3">
          <Field label="Status" className="w-full sm:w-40">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="From" className="w-[calc(50%-0.25rem)] sm:w-40">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </Field>
          <Field label="To" className="w-[calc(50%-0.25rem)] sm:w-40">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </Field>
          <Button
            size="sm"
            variant="ghost"
            className="mb-0.5"
            onClick={() => { setStatus(''); setFrom(''); setTo(''); setPage(1); }}
          >
            Clear filters
          </Button>
        </div>

        {list.isLoading ? (
          <LoadingBlock rows={4} />
        ) : list.isError ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No shifts yet" description="Open a shift to start capturing opening totalizers." icon={<Clock className="h-4 w-4" />} />
        ) : (
          <>
            <TableScrollHint />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Business date</th>
                    <th>Status</th>
                    <th>Operator</th>
                    <th className="text-right">Litres</th>
                    <th className="text-right">Est. value</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium text-ink-100">#{row.shiftNumber}</td>
                      <td className="num text-ink-300">{row.businessDate}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="text-ink-300">{row.operatorName ?? row.openedByName ?? '—'}</td>
                      <td className="num text-right">{formatNumber(row.totalLitres, 3)}</td>
                      <td className="num text-right">{formatINR(row.totalValue)}</td>
                      <td className="text-xs text-ink-500">{formatDateTime(row.openedAt)}</td>
                      <td className="text-xs text-ink-500">{row.closedAt ? formatDateTime(row.closedAt) : '—'}</td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => { setCapturePreview(null); setSelectedId(row.id); }}>View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...meta} onPage={setPage} />
          </>
        )}
      </Card>

      {/* detail */}
      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={shift ? `Shift #${shift.shiftNumber} · ${shift.businessDate}` : 'Shift detail'}
        description={shift ? `${shift.stationName} · ${shift.status}` : undefined}
        size="xl"
        footer={
          shift ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {shift.status === 'OPEN' && can('shifts.close') && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => captureMutation.mutate(shift.id)} loading={captureMutation.isPending}>
                      Preview closing readings
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setCloseModal(true)}>Close shift</Button>
                  </>
                )}
                {(shift.status === 'CLOSED' || shift.status === 'FLAGGED') && !shift.approvedAt && can('shifts.approve') && (
                  <Button size="sm" variant="success" onClick={() => approveMutation.mutate({ id: shift.id, note: 'Reviewed and approved' })} loading={approveMutation.isPending}>
                    Approve shift
                  </Button>
                )}
                {(shift.status === 'CLOSED' || shift.status === 'FLAGGED') && can('shifts.approve') && (
                  <Button size="sm" variant="outline" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setReverseModal(true)}>
                    Reverse
                  </Button>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          ) : null
        }
      >
        {detail.isLoading ? (
          <LoadingBlock rows={4} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : shift ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={shift.status} />
              {shift.approvedAt && <Badge tone="success">Approved by {shift.approvedByName ?? '—'}</Badge>}
              <Badge tone="muted">Operator: {shift.operatorName ?? shift.openedByName ?? '—'}</Badge>
              <Badge tone="muted">Opened {formatDateTime(shift.openedAt)}</Badge>
              {shift.closedAt && <Badge tone="muted">Closed {formatDateTime(shift.closedAt)}</Badge>}
            </div>

            {shift.nozzles.some((nozzle) => nozzle.note && (nozzle.status === 'FLAGGED' || !nozzle.openingReading)) && (
              <div className="space-y-1.5 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                {shift.nozzles.filter((nozzle) => nozzle.note && (nozzle.status === 'FLAGGED' || !nozzle.openingReading)).map((nozzle) => (
                  <p key={nozzle.id} className="text-xs text-warn/90">• {nozzle.nozzleLabel}: {nozzle.note}</p>
                ))}
              </div>
            )}

            {capturePreview?.shiftId === shift.id && (
              <div className="space-y-1.5 rounded-lg border border-navy-700/60 bg-navy-800/30 p-3">
                <p className="text-xs font-medium text-ink-200">Closing preview</p>
                <p className="text-[11px] text-ink-500">{capturePreview.note}</p>
                {capturePreview.preview.map((item) => (
                  <p key={item.nozzleId} className="text-xs text-ink-300">
                    {item.nozzle}: closing {item.closing ?? 'missing'} · {item.litres === null ? 'no volume' : `${item.litres} L net`}
                    {(item as { testingLitres?: string }).testingLitres && Number((item as { testingLitres?: string }).testingLitres) > 0
                      ? ` (testing ${(item as { testingLitres?: string }).testingLitres} L kata)` : ''} · {item.status}
                    {item.note ? ` — ${item.note}` : ''}
                  </p>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { label: 'Net litres (bikri)', value: `${formatNumber(shift.totals.litres, 3)} L` },
                { label: 'Testing litres (wapas tank me)', value: `${formatNumber(shift.totals.testingLitres ?? '0', 3)} L` },
                { label: 'Aggregate estimate', value: formatINR(shift.totals.value) },
                {
                  label: 'Cash short / excess',
                  value: shift.shortExcess === null ? '—' : `${Number(shift.shortExcess) >= 0 ? '+' : ''}${formatINR(shift.shortExcess)}`,
                },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">{item.label}</p>
                  <p className="num mt-0.5 text-sm text-ink-100">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="table-wrap rounded-lg border border-navy-700/60">
              <table className="data-table min-w-[880px]">
                <thead>
                  <tr>
                    <th>Nozzle</th>
                    <th className="text-right">Opening</th>
                    <th className="text-right">Closing</th>
                    <th className="text-right">Net litres</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Value</th>
                    <th className="text-right">Variance</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shift.nozzles.map((nozzle) => (
                    <tr key={nozzle.id}>
                      <td>
                        <p className="font-medium text-ink-100">{nozzle.nozzleLabel}</p>
                        <p className="text-[10px] text-ink-500">{nozzle.dispenserCode} · {nozzle.productName}</p>
                      </td>
                      <td className="num text-right text-ink-300">
                        {nozzle.openingReading ? formatNumber(nozzle.openingReading, 3) : <span className="text-danger">missing</span>}
                        {nozzle.openingSource && <span className="block text-[9px] uppercase text-ink-600">{nozzle.openingSource}</span>}
                      </td>
                      <td className="num text-right text-ink-300">
                        {nozzle.closingReading ? formatNumber(nozzle.closingReading, 3) : <span className="text-ink-600">—</span>}
                        {nozzle.closingSource && <span className="block text-[9px] uppercase text-ink-600">{nozzle.closingSource}</span>}
                      </td>
                      <td className="num text-right font-medium text-ink-100">
                        {nozzle.litresSold ? formatNumber(nozzle.litresSold, 3) : '—'}
                        {Number(nozzle.testingLitres) > 0 && (
                          <span className="block text-[9px] text-info">testing −{formatNumber(nozzle.testingLitres, 3)} L</span>
                        )}
                        {Number(nozzle.adjustmentLitres) !== 0 && (
                          <span className="block text-[9px] text-warn">adj {formatNumber(nozzle.adjustmentLitres, 3)}</span>
                        )}
                      </td>
                      <td className="num text-right text-ink-400">{nozzle.rate ? formatINR(nozzle.rate) : '—'}</td>
                      <td className="num text-right text-ink-200">{nozzle.salesValue ? formatINR(nozzle.salesValue) : '—'}</td>
                      <td className={`num text-right ${nozzle.varianceLitres && Math.abs(Number(nozzle.varianceLitres)) > 1 ? 'text-warn' : 'text-ink-500'}`}>
                        {nozzle.varianceLitres ? `${formatNumber(nozzle.varianceLitres, 3)} L` : '—'}
                      </td>
                      <td><StatusBadge status={nozzle.status} /></td>
                      <td className="text-right">
                        {can('shifts.close') && shift.status === 'OPEN' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditNozzle(nozzle)}>Edit</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(shift.settlements ?? []).length > 0 && (
              <div className="rounded-lg border border-navy-700/60">
                <p className="border-b border-navy-700/60 px-3 py-2 text-xs font-semibold text-ink-200">
                  Paise ka milaan — expected (system) vs received (galla)
                </p>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Mode</th><th className="text-right">Expected</th><th className="text-right">Received</th><th className="text-right">Short / Excess</th></tr>
                    </thead>
                    <tbody>
                      {(shift.settlements ?? []).map((row) => (
                        <tr key={row.mode}>
                          <td className="font-medium text-ink-100">{row.mode}</td>
                          <td className="num text-right">{formatINR(row.expectedAmount)}</td>
                          <td className="num text-right">{row.receivedAmount !== null ? formatINR(row.receivedAmount) : '—'}</td>
                          <td className={`num text-right ${row.differenceAmount !== null && Number(row.differenceAmount) < 0 ? 'font-semibold text-danger' : row.differenceAmount !== null && Number(row.differenceAmount) > 0 ? 'text-warn' : 'text-ink-400'}`}>
                            {row.differenceAmount !== null ? `${Number(row.differenceAmount) > 0 ? '+' : ''}${formatINR(row.differenceAmount)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(shift.denominations ?? []).length > 0 && (
                  <p className="border-t border-navy-700/60 px-3 py-2 text-[11px] text-ink-400">
                    Cash ginti: {(shift.denominations ?? []).map((d) => `₹${d.denomination}×${d.count}`).join(' · ')}
                    {' = '}<span className="num text-ink-100">{formatINR(shift.cashCounted ?? 0)}</span>
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-ink-500">
              Net litres = closing totalizer − opening totalizer + approved adjustment − testing (testing fuel tank me
              wapas jata hai, sale nahi hota). Totalizer-only shifts produce an
              <span className="text-ink-300"> aggregate estimated sales value</span>, not per-vehicle invoices.
            </p>
            {shift.closeNotes && <p className="text-xs text-ink-400">Close note: {shift.closeNotes}</p>}
          </div>
        ) : null}
      </Modal>

      <OpenShiftModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        stationId={stationId}
        employees={employees.data ?? []}
        canPickOperator={can('employees.read')}
        loading={openMutation.isPending}
        onSubmit={(payload) => openMutation.mutate(payload)}
      />

      {shift && closeModal && (
        <CloseShiftModal
          open={closeModal}
          onClose={() => setCloseModal(false)}
          shift={shift}
          loading={closeMutation.isPending}
          onSubmit={(payload) => closeMutation.mutate({ id: shift.id, payload })}
        />
      )}

      {shift && reverseModal && (
        <ReverseShiftModal
          open={reverseModal}
          onClose={() => setReverseModal(false)}
          loading={reverseMutation.isPending}
          onSubmit={(reason) => reverseMutation.mutate({ id: shift.id, reason })}
        />
      )}

      {shift && editNozzle && (
        <EditNozzleModal
          open={Boolean(editNozzle)}
          onClose={() => setEditNozzle(null)}
          shift={shift}
          nozzle={editNozzle}
          employees={employees.data ?? []}
          loading={nozzleMutation.isPending}
          onSubmit={(payload) =>
            nozzleMutation.mutate({ shiftId: shift.id, nozzleId: editNozzle.nozzleId, payload })
          }
        />
      )}
    </>
  );
}

function OpenShiftModal({
  open,
  onClose,
  stationId,
  employees,
  canPickOperator,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  stationId: string;
  employees: Employee[];
  canPickOperator: boolean;
  loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [businessDate, setBusinessDate] = useState(todayIst());
  const [operatorId, setOperatorId] = useState('');
  const [openingCash, setOpeningCash] = useState('5000');
  const [captureReadings, setCaptureReadings] = useState(true);
  const [notes, setNotes] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open shift"
      description="Opening totalizers are captured from the latest valid device reading when available."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() =>
              onSubmit({
                stationId,
                businessDate,
                operatorId: operatorId || undefined,
                openingCash,
                captureReadings,
                notes: notes || undefined,
              })
            }
          >
            Open shift
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business date" required>
          <Input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </Field>
        <Field label="Opening cash (INR)">
          <Input inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
        </Field>
        {canPickOperator && (
          <Field label="Operator" className="sm:col-span-2">
            <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
              <option value="">Me ({'signed-in user'})</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} · {employee.roleKey}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Checkbox
            checked={captureReadings}
            onChange={setCaptureReadings}
            label="Capture opening readings from the latest device snapshot"
          />
          <p className="mt-1 pl-6 text-[11px] text-ink-500">
            Uncheck to enter totalizers manually. Missing or invalid readings generate visible warnings and flagged
            nozzle rows rather than silent zero volumes.
          </p>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional shift handover note" />
        </Field>
      </div>
    </Modal>
  );
}

function CloseShiftModal({
  open,
  onClose,
  shift,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  shift: ShiftDetail;
  loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [closingCash, setClosingCash] = useState(shift.openingCash ?? '0');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [modes, setModes] = useState<Record<string, string>>({ UPI: '', CARD: '', BANK: '', CREDIT: '' });
  const [notes, setNotes] = useState('');

  const denomTotal = useMemo(
    () => CASH_DENOMINATIONS.reduce((acc, d) => acc + d * (Number(counts[d]) || 0), 0),
    [counts],
  );
  const denomUsed = Object.values(counts).some((v) => Number(v) > 0);
  const effectiveCash = denomUsed ? String(denomTotal) : closingCash;

  const submit = () => {
    const settlements = Object.entries(modes)
      .filter(([, v]) => v.trim() !== '')
      .map(([mode, received]) => ({ mode, received }));
    if (denomUsed) settlements.unshift({ mode: 'CASH', received: String(denomTotal) });
    onSubmit({
      closingCash: effectiveCash,
      denominations: denomUsed
        ? CASH_DENOMINATIONS.filter((d) => Number(counts[d]) > 0).map((d) => ({ denomination: d, count: Number(counts[d]) }))
        : undefined,
      settlements: settlements.length > 0 ? settlements : undefined,
      notes: notes || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close shift #${shift.shiftNumber}`}
      description="Pehle galla gino (note-wise), phir UPI/Card machine ke totals daalo — system khud short/excess nikal dega."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={submit}>
            Close & compute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="label">Cash ginti — note-wise (galla gin ke)</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {CASH_DENOMINATIONS.map((d) => (
              <label key={d} className="rounded-xl border border-navy-700/60 bg-navy-800/30 p-2">
                <span className="num block text-[11px] font-semibold text-ink-300">₹{d} ×</span>
                <input
                  inputMode="numeric"
                  aria-label={`₹${d} notes count`}
                  className="input mt-1 px-2 py-1.5 text-center"
                  placeholder="0"
                  value={counts[d] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/[^0-9]/g, '') })}
                />
                <span className="num mt-1 block text-right text-[10px] text-ink-500">
                  {formatINR(d * (Number(counts[d]) || 0))}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-300">
            Ginti total: <span className="num font-display text-base font-bold text-ink-100">{formatINR(denomTotal)}</span>
            {denomUsed && <span className="text-[11px] text-ink-500"> · yahi received cash mana jayega</span>}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Closing cash (INR)" hint={denomUsed ? 'Ginti se auto bhara gaya' : 'Ginti nahi ki to seedha cash daalo'}>
            <Input inputMode="decimal" value={effectiveCash} onChange={(e) => setClosingCash(e.target.value)} />
          </Field>
          <Field label="UPI mila (INR)" hint="UPI app/machine ka total">
            <Input inputMode="decimal" value={modes.UPI} onChange={(e) => setModes({ ...modes, UPI: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Card mila (INR)" hint="Swipe machine batch total">
            <Input inputMode="decimal" value={modes.CARD} onChange={(e) => setModes({ ...modes, CARD: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Bank / Fleet mila (INR)">
            <Input inputMode="decimal" value={modes.BANK} onChange={(e) => setModes({ ...modes, BANK: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Credit slips ka total (INR)" hint="Is shift ki udhaar p-slips ka jog">
            <Input inputMode="decimal" value={modes.CREDIT} onChange={(e) => setModes({ ...modes, CREDIT: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Close notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cash handover, short/excess ka karan…" />
          </Field>
        </div>

        <div className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-3 text-xs text-ink-400">
          <p className="mb-1 font-medium text-ink-200">Band karne se pehle</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>Har nozzle ki opening/closing reading aur testing litres check kar lo.</li>
            <li>Expected paisa shift ki record hui bikri se banta hai; bachi hui rakam cash mani jati hai.</li>
            <li>Band shift chup-chaap edit nahi hoti — adjustment ya reversal use karo.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function DayClosingCard({ stationId, canManage }: { stationId: string; canManage: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => {
    const d = new Date(`${todayIst()}T12:00:00+05:30`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [reopenFor, setReopenFor] = useState<DayClosing | null>(null);
  const [reason, setReason] = useState('');

  const closings = useQuery<DayClosing[]>({
    queryKey: ['day-closings', stationId],
    queryFn: () => apiGet<DayClosing[]>(`/shifts/day-closings?stationId=${stationId}`),
    enabled: Boolean(stationId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['day-closings'] });
  const closeDay = useMutation({
    mutationFn: () => apiPost('/shifts/day-close', { stationId, businessDate: date }),
    onSuccess: () => { toast('Din band ho gaya', { description: `${date} ki entries ab lock hain.` }); invalidate(); },
    onError: (error: Error) => toast('Din band nahi hua', { tone: 'danger', description: error.message }),
  });
  const reopenDay = useMutation({
    mutationFn: () => apiPost('/shifts/day-close/reopen', { stationId, businessDate: reopenFor?.businessDate, reason: reason.trim() }),
    onSuccess: () => { toast('Din dobara khul gaya'); setReopenFor(null); setReason(''); invalidate(); },
    onError: (error: Error) => toast('Reopen nahi hua', { tone: 'danger', description: error.message }),
  });

  const recent = (closings.data ?? []).slice(0, 5);

  return (
    <Card className="mt-3">
      <CardHeader
        title="Day closing — Roznamcha"
        subtitle="Din band karne ke baad us date ki shift, bikri, kharcha aur dip entries lock ho jati hain."
        action={canManage ? (
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Day closing date" />
            <Button size="sm" variant="primary" loading={closeDay.isPending} onClick={() => closeDay.mutate()}>
              Din band karo
            </Button>
          </div>
        ) : <Badge tone="muted">Sirf manager/owner din band kar sakte hain</Badge>}
      />
      <CardBody>
        {closings.isLoading ? (
          <LoadingBlock rows={2} />
        ) : recent.length === 0 ? (
          <p className="py-2 text-center text-xs text-ink-500">Abhi tak koi din band nahi hua. Kal ka hisaab pakka ho jaye to upar se din band kar do.</p>
        ) : (
          <div className="divide-y divide-navy-800/70">
            {recent.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="num text-sm font-medium text-ink-100">{row.businessDate}</p>
                  <p className="text-[11px] text-ink-500">
                    Band kiya: {row.closedByName ?? '—'} · {formatDateTime(row.closedAt)}
                    {row.status === 'REOPENED' && row.reopenReason ? ` · Reopen karan: ${row.reopenReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={row.status} label={row.status === 'CLOSED' ? 'DIN BAND' : 'REOPENED'} />
                  {canManage && row.status === 'CLOSED' && (
                    <Button size="sm" variant="outline" onClick={() => setReopenFor(row)}>Reopen</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
      <Modal
        open={reopenFor !== null}
        onClose={() => setReopenFor(null)}
        title={`Din dobara kholo — ${reopenFor?.businessDate ?? ''}`}
        description="Reopen ka karan audit me hamesha rahega. Sudhar karke din phir se band kar dena."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopenFor(null)}>Cancel</Button>
            <Button variant="primary" loading={reopenDay.isPending} disabled={reason.trim().length < 10} onClick={() => reopenDay.mutate()}>
              Reopen karo
            </Button>
          </>
        }
      >
        <Field label="Reopen ka karan (kam se kam 10 akshar)" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ek credit slip galat customer par chadh gayi thi" />
        </Field>
      </Modal>
    </Card>
  );
}

function ReverseShiftModal({
  open,
  onClose,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reverse shift"
      description="Reversal restores dispensed stock through an offsetting ledger entry and is permanently audited."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} disabled={reason.trim().length < 10} onClick={() => onSubmit(reason.trim())}>
            Reverse shift
          </Button>
        </>
      }
    >
      <Field label="Reason (minimum 10 characters)" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this shift must be reversed" />
      </Field>
    </Modal>
  );
}

function EditNozzleModal({
  open,
  onClose,
  shift,
  nozzle,
  employees,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  shift: ShiftDetail;
  nozzle: ShiftNozzle;
  employees: Employee[];
  loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [opening, setOpening] = useState(nozzle.openingReading ?? '');
  const [closing, setClosing] = useState(nozzle.closingReading ?? '');
  const [testing, setTesting] = useState(nozzle.testingLitres ?? '0');
  const [operatorId, setOperatorId] = useState(nozzle.operatorId ?? '');
  const [adjustment, setAdjustment] = useState(nozzle.adjustmentLitres ?? '0');
  const [reason, setReason] = useState(nozzle.adjustmentReason ?? '');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${nozzle.nozzleLabel}`}
      description="Manual changes are audited. Negative closing or net litres trigger a variance flag."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() =>
              onSubmit({
                openingReading: shift.status === 'OPEN' && opening.trim() && opening !== (nozzle.openingReading ?? '') ? opening : undefined,
                closingReading: closing.trim() && closing !== (nozzle.closingReading ?? '') ? closing : undefined,
                testingLitres: testing || '0',
                operatorId: operatorId || null,
                adjustmentLitres: adjustment || '0',
                adjustmentReason: reason || undefined,
              })
            }
          >
            Save readings
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Opening totalizer" hint={shift.status === 'OPEN' ? 'Editable while the shift is open' : 'Locked after closing'}>
          <Input value={opening} onChange={(e) => setOpening(e.target.value)} disabled={shift.status !== 'OPEN'} />
        </Field>
        <Field label="Closing totalizer">
          <Input value={closing} onChange={(e) => setClosing(e.target.value)} />
        </Field>
        <Field label="Testing litres" hint="5L calibration/sample jo tank me wapas gaya — bikri se katega">
          <Input inputMode="decimal" value={testing} onChange={(e) => setTesting(e.target.value)} />
        </Field>
        <Field label="Is nozzle ka filler" hint="Is nozzle ka cash isi ke hisaab me">
          <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
            <option value="">Shift operator hi</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name} · {employee.roleKey}</option>
            ))}
          </Select>
        </Field>
        <Field label="Adjustment (litres)" hint="Signed value, e.g. -2.5 for an evaporation correction">
          <Input value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
        </Field>
        <Field label="Adjustment reason" hint="Required when an adjustment is applied">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
