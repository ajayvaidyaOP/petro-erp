import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, ReceiptText } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useStations } from '../lib/auth';
import { formatDate, formatDateTime, formatINR, formatNumber, todayIst } from '../lib/format';
import { downloadCsv } from '../lib/utils';
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
  PageHeader,
  StatCard,
  StatusBadge,
} from '../components/ui';

interface Dsr {
  station: { name: string; code: string; address: string | null; city: string | null; state: string | null };
  date: string;
  generatedAt: string;
  nozzleSales: Record<string, unknown>[];
  productTotals: { product: string; code: string; litres: string; value: string }[];
  shifts: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  paymentMix: Record<string, string>;
  totals: {
    aggregateLitres: string;
    aggregateEstimatedValue: string;
    transactionLitres: string;
    transactionValue: string;
    expenses: string;
    receipts: string;
    purchases: string;
  };
  expenses: Record<string, unknown>[];
  deliveries: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  stock: Record<string, unknown>[];
  reconciliation: Record<string, unknown> | null;
  notes: string[];
}

export default function Reports() {
  const { stationId, station } = useStations();
  const [date, setDate] = useState(todayIst());

  const dsr = useQuery({
    queryKey: ['dsr', stationId, date],
    queryFn: () => apiGet<Dsr>(`/reports/dsr?stationId=${stationId}&date=${date}`),
    enabled: Boolean(stationId),
  });

  if (!stationId) return <EmptyState title="No station assigned" />;

  return (
    <>
      <PageHeader
        title="Daily Sales Report (DSR)"
        description={`${station?.name ?? ''} · consolidated operational report for the business date`}
        actions={
          <>
            <Field label="Business date" className="mb-0">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
            </Field>
            <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()} className="mt-4">
              Print
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              className="mt-4"
              disabled={!dsr.data}
              onClick={() =>
                downloadCsv(
                  `dsr-${date}.csv`,
                  (dsr.data?.nozzleSales ?? []).map((row) => ({
                    shift: row.shiftNumber,
                    nozzle: row.nozzleLabel,
                    dispenser: row.dispenserCode,
                    product: row.productName,
                    opening: row.openingReading,
                    closing: row.closingReading,
                    litres: row.litresSold,
                    rate: row.rate,
                    value: row.salesValue,
                    status: row.status,
                  })),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      {dsr.isLoading ? (
        <LoadingBlock rows={6} />
      ) : dsr.isError ? (
        <ErrorState error={dsr.error} onRetry={() => void dsr.refetch()} />
      ) : dsr.data ? (
        <div className="space-y-3">
          <Card className="print:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-navy-700/60 p-4">
              <div>
                <p className="text-lg font-semibold text-ink-100">{dsr.data.station.name}</p>
                <p className="text-xs text-ink-500">
                  {dsr.data.station.code}
                  {dsr.data.station.address ? ` · ${dsr.data.station.address}` : ''}
                  {dsr.data.station.city ? `, ${dsr.data.station.city}` : ''}
                </p>
                <p className="mt-1 text-xs text-ink-400">Business date: {formatDate(dsr.data.date)} (Asia/Kolkata)</p>
              </div>
              <div className="text-right text-[11px] text-ink-500">
                <p>Generated {formatDateTime(dsr.data.generatedAt)}</p>
                <p>PetroFlow ERP · INR</p>
                <div className="mt-1 flex justify-end gap-1">
                  <Badge tone="muted">{dsr.data.shifts.length} shifts</Badge>
                  <Badge tone="muted">{dsr.data.transactions.length} transactions</Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Aggregate litres" value={formatNumber(dsr.data.totals.aggregateLitres, 3)} hint="Closed shift totalizers" />
              <StatCard label="Estimated sales value" value={formatINR(dsr.data.totals.aggregateEstimatedValue, true)} hint="Aggregate estimate" tone="accent" />
              <StatCard label="Recorded transactions" value={formatINR(dsr.data.totals.transactionValue, true)} hint={`${formatNumber(dsr.data.totals.transactionLitres, 3)} L`} />
              <StatCard label="Expenses" value={formatINR(dsr.data.totals.expenses, true)} hint={`Purchases ${formatINR(dsr.data.totals.purchases, true)}`} />
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Payment mix (recorded)" subtitle="Only transaction-level sales carry a payment mode" />
              <div className="divide-y divide-navy-800/80">
                {Object.keys(dsr.data.paymentMix).length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-500">No transaction-level payments recorded.</p>
                ) : (
                  Object.entries(dsr.data.paymentMix).map(([mode, amount]) => (
                    <div key={mode} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-ink-300">{mode}</span>
                      <span className="num text-sm text-ink-100">{formatINR(amount)}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-navy-700/60 px-4 py-2 text-[11px] text-ink-500">
                Customer receipts: {formatINR(dsr.data.totals.receipts)}
              </div>
            </Card>

            <Card>
              <CardHeader title="Product totals" subtitle="Aggregate litres and estimated value by grade" />
              <div className="table-wrap">
                <table className="data-table min-w-0">
                  <thead><tr><th>Product</th><th className="text-right">Litres</th><th className="text-right">Value</th></tr></thead>
                  <tbody>
                    {dsr.data.productTotals.length === 0 ? (
                      <tr><td colSpan={3} className="py-6 text-center text-xs text-ink-500">No closed shift volume.</td></tr>
                    ) : (
                      dsr.data.productTotals.map((row) => (
                        <tr key={row.code}>
                          <td className="text-ink-200">{row.product}</td>
                          <td className="num text-right">{formatNumber(row.litres, 3)}</td>
                          <td className="num text-right">{formatINR(row.value)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Nozzle-wise sales" subtitle="Opening and closing totalizer comparison" />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Shift</th><th>Nozzle</th><th>Product</th><th className="text-right">Opening</th><th className="text-right">Closing</th><th className="text-right">Litres</th><th className="text-right">Rate</th><th className="text-right">Value</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {dsr.data.nozzleSales.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-xs text-ink-500">No nozzle readings for this date.</td></tr>
                  ) : (
                    dsr.data.nozzleSales.map((row, index) => (
                      <tr key={String(row.id ?? index)}>
                        <td className="text-xs text-ink-400">#{String(row.shiftNumber)} <StatusBadge status={String(row.shiftStatus)} /></td>
                        <td className="font-medium text-ink-100">{String(row.nozzleLabel)}<span className="block text-[10px] text-ink-500">{String(row.dispenserCode)}</span></td>
                        <td className="text-xs text-ink-300">{String(row.productName)}</td>
                        <td className="num text-right">{row.openingReading ? formatNumber(String(row.openingReading), 3) : '—'}</td>
                        <td className="num text-right">{row.closingReading ? formatNumber(String(row.closingReading), 3) : '—'}</td>
                        <td className="num text-right font-medium">{row.litresSold ? formatNumber(String(row.litresSold), 3) : '—'}</td>
                        <td className="num text-right">{row.rate ? formatINR(String(row.rate)) : '—'}</td>
                        <td className="num text-right">{row.salesValue ? formatINR(String(row.salesValue)) : '—'}</td>
                        <td><StatusBadge status={String(row.status)} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Stock position" subtitle="Book stock is ledger-derived; physical dips are separate" />
              <TableScrollHint />
              <div className="table-wrap">
                <table className="data-table min-w-[560px]">
                  <thead><tr><th>Tank</th><th className="text-right">Opening</th><th className="text-right">Delivered</th><th className="text-right">Dispensed</th><th className="text-right">Book closing</th><th className="text-right">Measured</th></tr></thead>
                  <tbody>
                    {dsr.data.stock.map((tank) => (
                      <tr key={String(tank.id)}>
                        <td className="text-ink-100">{String(tank.code)}<span className="block text-[10px] text-ink-500">{String(tank.productName)}</span></td>
                        <td className="num text-right">{formatNumber(String(tank.openingBook), 3)}</td>
                        <td className="num text-right">{formatNumber(String(tank.deliveredToday), 3)}</td>
                        <td className="num text-right">{formatNumber(String(tank.dispensedBook), 3)}</td>
                        <td className="num text-right font-medium">{formatNumber(String(tank.bookClosing), 3)}</td>
                        <td className={`num text-right ${tank.varianceFlag ? 'text-amber-300' : 'text-ink-400'}`}>
                          {tank.measured ? formatNumber(String(tank.measured), 3) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Deliveries & expenses" subtitle="Purchases received and operating costs on the date" />
              <div className="max-h-[280px] overflow-y-auto scroll-thin">
                {dsr.data.deliveries.length === 0 && dsr.data.expenses.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-500">No deliveries or expenses recorded.</p>
                ) : (
                  <div className="divide-y divide-navy-800/80">
                    {dsr.data.deliveries.map((d) => (
                      <div key={String(d.id)} className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <div>
                          <p className="text-xs text-ink-200">Delivery · {String(d.supplierName)}</p>
                          <p className="text-[10px] text-ink-500">{String(d.invoiceNumber)} · {formatNumber(String(d.quantityLitres), 3)} L {String(d.productName)}</p>
                        </div>
                        <span className="num text-xs text-ink-300">{formatINR(String(d.totalAmount))}</span>
                      </div>
                    ))}
                    {dsr.data.expenses.map((e) => (
                      <div key={String(e.id)} className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <div>
                          <p className="text-xs text-ink-200">{String(e.categoryName)}</p>
                          <p className="text-[10px] text-ink-500">{String(e.description)}</p>
                        </div>
                        <span className="num text-xs text-rose-300">{formatINR(String(e.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Reconciliation status" subtitle="Latest cash reconciliation recorded for the date" />
            <div className="p-4">
              {dsr.data.reconciliation ? (
                <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['Cash expected', formatINR(String(dsr.data.reconciliation.cashExpected))],
                    ['Cash counted', formatINR(String(dsr.data.reconciliation.cashCounted))],
                    ['Digital expected', formatINR(String(dsr.data.reconciliation.digitalExpected))],
                    ['Digital settled', formatINR(String(dsr.data.reconciliation.digitalSettled))],
                    ['Variance', formatINR(String(dsr.data.reconciliation.variance))],
                    ['Status', <StatusBadge key="s" status={String(dsr.data.reconciliation.status)} />],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
                      <p className="mt-0.5 text-sm text-ink-200">{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-500">No reconciliation recorded for this date.</p>
              )}
            </div>
          </Card>

          <div className="card p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <ReceiptText className="h-3.5 w-3.5" /> Report notes & disclaimer
            </p>
            <ul className="space-y-1 text-[11px] leading-relaxed text-ink-500">
              {dsr.data.notes.map((note, index) => <li key={index}>• {note}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
