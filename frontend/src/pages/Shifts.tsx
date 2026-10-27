import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock, Download, Plus, RefreshCw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { apiGet, apiList, apiPatch, apiPost, type ListMeta } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
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
  nozzles: ShiftNozzle[];
  alerts: { level: string; nozzleId?: string; message: string }[];
  totals: { litres: string; value: string; estimated: boolean };
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
    queryFn: () => apiGet<{ type: string; severity: string; message: string }[]>(`/shifts/alerts?stationId=${stationId}`),
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
      if (shift.alerts?.length) {
        toast('Opening warnings', { tone: 'warning', description: shift.alerts[0].message });
      }
      setOpenModal(false);
      setSelectedId(shift.id);
      invalidate(shift.id);
    },
    onError: (error) => toast('Could not open shift', { tone: 'danger', description: (error as Error).message }),
  });

  const captureMutation = useMutation({
    mutationFn: ({ id, phase }: { id: string; phase: 'OPENING' | 'CLOSING' }) =>
      apiPost<ShiftDetail & { updatedNozzles: string[] }>(`/shifts/${id}/capture`, { phase, fromDevice: true }),
    onSuccess: (shift) => {
      toast('Readings captured', { description: `${shift.updatedNozzles.length} nozzle reading(s) refreshed from the latest valid device snapshot.` });
      invalidate(shift.id);
    },
    onError: (error) => toast('Capture failed', { tone: 'danger', description: (error as Error).message }),
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
        <StatCard label="Open shifts" value={rows.filter((r) => r.status === 'OPEN').length} hint="Currently accepting readings" icon={<Clock className="h-4 w-4" />} />
        <StatCard
          label="Flagged shifts"
          value={(alertsQuery.data ?? []).filter((a) => a.type === 'SHIFT_FLAGGED').length}
          hint="Awaiting variance approval"
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

      {(alertsQuery.data ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          {(alertsQuery.data ?? []).slice(0, 3).map((alert, index) => (
            <div key={index} className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-warn/90">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {alert.message}
            </div>
          ))}
        </div>
      )}

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
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(row.id)}>View</Button>
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
                    <Button size="sm" variant="secondary" onClick={() => captureMutation.mutate({ id: shift.id, phase: 'CLOSING' })} loading={captureMutation.isPending}>
                      Capture closing readings
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setCloseModal(true)}>Close shift</Button>
                  </>
                )}
                {(shift.status === 'CLOSED' || shift.status === 'FLAGGED') && can('shifts.approve') && (
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

            {shift.alerts.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                {shift.alerts.map((alert, index) => (
                  <p key={index} className="text-xs text-warn/90">• {alert.message}</p>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { label: 'Total litres', value: `${formatNumber(shift.totals.litres, 3)} L` },
                { label: 'Aggregate estimate', value: formatINR(shift.totals.value) },
                { label: 'Opening cash', value: formatINR(shift.openingCash) },
                { label: 'Closing cash', value: formatINR(shift.closingCash) },
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
                        {can('shifts.close') && shift.status !== 'REVERSED' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditNozzle(nozzle)}>Edit</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-500">
              Net litres = closing totalizer − opening totalizer + approved adjustment. Totalizer-only shifts produce an
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
  const [notes, setNotes] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close shift #${shift.shiftNumber}`}
      description="Closing readings are taken from the latest countable device snapshots. You can edit nozzle readings first."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => onSubmit({ closingCash, notes: notes || undefined })}
          >
            Close & compute
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-3 text-xs text-ink-400">
          <p className="mb-1 font-medium text-ink-200">Before closing</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>Verify each nozzle has a comparable opening and closing totalizer.</li>
            <li>Large manual-vs-device differences are flagged for approval.</li>
            <li>Closed shifts cannot be silently edited — use adjustments or a reversal.</li>
          </ul>
        </div>
        <Field label="Closing cash (INR)">
          <Input inputMode="decimal" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} />
        </Field>
        <Field label="Close notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cash handover, variance explanation…" />
        </Field>
      </div>
    </Modal>
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
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  shift: ShiftDetail;
  nozzle: ShiftNozzle;
  loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [opening, setOpening] = useState(nozzle.openingReading ?? '');
  const [closing, setClosing] = useState(nozzle.closingReading ?? '');
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
                openingReading: shift.status === 'OPEN' ? opening : undefined,
                closingReading: closing,
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
