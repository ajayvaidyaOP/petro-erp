import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Banknote, Calculator, CreditCard } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDate, formatDateTime, formatINR, todayIst } from '../lib/format';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
} from '../components/ui';

interface ReconFigures {
  expected: {
    cash: string;
    digital: string;
    cashSales: string;
    digitalSales: string;
    creditSales: string;
    cashReceipts: string;
    digitalReceipts: string;
    cashExpenses: string;
    digitalExpenses: string;
    cashPayouts: string;
    digitalPayouts: string;
    shiftAggregateLitres: string;
    shiftAggregateValue: string;
  };
  note: string;
  history: ReconRow[];
}

interface ReconRow {
  id: string;
  businessDate: string;
  cashExpected: string;
  cashCounted: string;
  digitalExpected: string;
  digitalSettled: string;
  variance: string;
  status: string;
  notes: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export default function Reconciliation() {
  const { can } = useAuth();
  const { stationId, station } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(todayIst());
  const [cashCounted, setCashCounted] = useState('');
  const [digitalSettled, setDigitalSettled] = useState('');
  const [notes, setNotes] = useState('');

  const figures = useQuery({
    queryKey: ['reconciliation', stationId, date],
    queryFn: () => apiGet<ReconFigures>(`/finance/reconciliation?stationId=${stationId}&businessDate=${date}`),
    enabled: Boolean(stationId),
  });

  const submit = useMutation({
    mutationFn: () =>
      apiPost<ReconRow>('/finance/reconciliation', {
        stationId,
        businessDate: date,
        cashCounted: cashCounted || '0',
        digitalSettled: digitalSettled || '0',
        notes: notes || undefined,
      }),
    onSuccess: (row: ReconRow) => {
      toast('Reconciliation saved', {
        tone: row.status === 'BALANCED' ? 'success' : 'warning',
        description:
          row.status === 'BALANCED'
            ? 'Cash and digital collections match the expected figures.'
            : `Variance of ${formatINR(row.variance)} recorded for approval.`,
      });
      setCashCounted('');
      setDigitalSettled('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
    },
    onError: (e) => toast('Could not save reconciliation', { tone: 'danger', description: (e as Error).message }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiPost(`/finance/reconciliation/${id}/approve`, { note: 'Variance reviewed' }),
    onSuccess: () => {
      toast('Reconciliation approved');
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
    },
    onError: (e) => toast('Approval failed', { tone: 'danger', description: (e as Error).message }),
  });

  if (!stationId) return <EmptyState title="No station assigned" />;

  const expected = figures.data?.expected;
  const countedValue = Number(cashCounted || 0);
  const expectedCash = Number(expected?.cash ?? 0);
  const variance = countedValue - expectedCash;

  return (
    <>
      <PageHeader
        title="Cash & collection reconciliation"
        description={`${station?.name ?? ''} · compare expected collections with physical cash and digital settlement`}
        actions={
          <Field label="Business date" className="mb-0">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          </Field>
        }
      />

      {figures.isLoading ? (
        <LoadingBlock rows={4} />
      ) : figures.isError ? (
        <ErrorState error={figures.error} onRetry={() => void figures.refetch()} />
      ) : expected ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Expected cash" value={formatINR(expected.cash)} hint="Cash sales + receipts − payouts − expenses" icon={<Banknote className="h-4 w-4" />} tone="accent" />
            <StatCard label="Expected digital" value={formatINR(expected.digital)} hint="UPI, card and bank collections" icon={<CreditCard className="h-4 w-4" />} />
            <StatCard label="Credit sales" value={formatINR(expected.creditSales)} hint="On account — not cash received" icon={<Calculator className="h-4 w-4" />} tone="warning" />
            <StatCard label="Shift estimates" value={formatINR(expected.shiftAggregateValue)} hint={`${expected.shiftAggregateLitres} L without payment split`} icon={<BadgeCheck className="h-4 w-4" />} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
            <Card>
              <CardHeader title="Record reconciliation" subtitle="Count the physical cash drawer and digital settlement report" />
              <div className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Cash counted (INR)" hint={`Expected ${formatINR(expected.cash)}`}>
                    <Input inputMode="decimal" value={cashCounted} onChange={(e) => setCashCounted(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Field label="Digital settled (INR)" hint={`Expected ${formatINR(expected.digital)}`}>
                    <Input inputMode="decimal" value={digitalSettled} onChange={(e) => setDigitalSettled(e.target.value)} placeholder="0.00" />
                  </Field>
                </div>
                <div className={Math.abs(variance) <= 1 ? 'callout-ok' : 'callout-warn'}>
                  Cash variance against expectation: <span className="num font-semibold">{formatINR(variance)}</span>
                  {Math.abs(variance) > 1 && ' · requires approval'}
                </div>
                <Field label="Notes">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Counted by, denominations, variance explanation…" />
                </Field>
                <div className="flex justify-end">
                  <Button variant="primary" loading={submit.isPending} disabled={!can('reconciliation.write')} onClick={() => submit.mutate()}>
                    Save reconciliation
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-500">{figures.data?.note}</p>
              </div>
            </Card>

            <Card>
              <CardHeader title="Expected collection build-up" subtitle="How the cash and digital expectations are derived" />
              <div className="divide-y divide-navy-800/80 text-sm">
                {[
                  ['Cash sales (transaction-level)', expected.cashSales],
                  ['Cash customer receipts', expected.cashReceipts],
                  ['Cash expenses', `− ${formatINR(expected.cashExpenses)}`],
                  ['Cash supplier payouts', `− ${formatINR(expected.cashPayouts)}`],
                  ['Digital sales (UPI/card/bank)', expected.digitalSales],
                  ['Digital receipts', expected.digitalReceipts],
                  ['Digital expenses', `− ${formatINR(expected.digitalExpenses)}`],
                  ['Digital payouts', `− ${formatINR(expected.digitalPayouts)}`],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-ink-400">{label}</span>
                    <span className="num text-sm text-ink-200">{String(value).startsWith('−') ? value : formatINR(String(value))}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-navy-700/60 px-4 py-3 text-[11px] text-ink-500">
                Credit sales are excluded. Totalizer-only aggregate shift totals lack a payment-mode split and therefore do
                not inflate the cash expectation.
              </div>
            </Card>
          </div>

          <Card className="mt-3">
            <CardHeader title="Reconciliation history" subtitle="Approved variances remain in the audit trail" />
            {figures.data!.history.length === 0 ? (
              <EmptyState title="No reconciliations recorded" description="Save the first reconciliation for this station." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Business date</th>
                      <th className="text-right">Cash expected</th>
                      <th className="text-right">Cash counted</th>
                      <th className="text-right">Digital expected</th>
                      <th className="text-right">Digital settled</th>
                      <th className="text-right">Variance</th>
                      <th>Status</th>
                      <th>Recorded</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {figures.data!.history.map((row) => (
                      <tr key={row.id}>
                        <td className="num text-ink-200">{formatDate(row.businessDate)}</td>
                        <td className="num text-right">{formatINR(row.cashExpected)}</td>
                        <td className="num text-right">{formatINR(row.cashCounted)}</td>
                        <td className="num text-right">{formatINR(row.digitalExpected)}</td>
                        <td className="num text-right">{formatINR(row.digitalSettled)}</td>
                        <td className={`num text-right ${Math.abs(Number(row.variance)) > 1 ? 'text-warn' : 'text-ok'}`}>{formatINR(row.variance)}</td>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="text-xs text-ink-500">{formatDateTime(row.createdAt)}</td>
                        <td className="text-right">
                          {row.status === 'VARIANCE' && can('reconciliation.write') && (
                            <Button size="sm" variant="ghost" loading={approve.isPending} onClick={() => approve.mutate(row.id)}>
                              Approve
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
