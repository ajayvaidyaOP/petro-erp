import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Droplets,
  Fuel,
  Gauge,
  IndianRupee,
  ListChecks,
  Plus,
  Store,
  Tags,
  Thermometer,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import type { ShiftAlertsResponse } from '../lib/shifts';
import { buildAttentionItems, type OperationalAlert } from '../lib/alerts';
import { useChartPalette } from '../lib/theme';
import {
  formatClockTime,
  formatDate,
  formatDateTime,
  formatINR,
  formatLitres,
  formatNumber,
  todayIst,
} from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  MeterBar,
  StatCard,
  StatusBadge,
} from '../components/ui';
import { cn } from '../lib/utils';

interface DashboardData {
  station: { id: string; name: string; code: string };
  date: string;
  sales: {
    shiftLitres: string;
    shiftValue: string;
    transactionLitres: string;
    transactionValue: string;
    byMode: Record<string, string>;
    transactions: number;
    shiftCount: number;
  };
  openShifts: Record<string, unknown>[];
  flaggedShifts: number;
  stock: {
    id: string;
    code: string;
    productName: string;
    productColor: string;
    bookStockLitres: string;
    capacityLitres: string;
    fillPct: string;
    lastVarianceLitres: string | null;
  }[];
  receivables: string;
  payables: string;
  trend: { date: string; litres: string; value: string; transactionsValue: string }[];
  alerts: OperationalAlert[];
  disclaimer: string;
}

interface PriceRow {
  id: string;
  productId: string;
  productName: string;
  stationId: string | null;
  ratePerLitre: string;
  effectiveTo: string | null;
}

const MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI / QR',
  CARD: 'Card POS',
  BANK: 'Bank / NEFT',
  CREDIT: 'Fleet Credit',
};

const MODE_COLORS: Record<string, string> = {
  CASH: 'bg-accent',
  UPI: 'bg-accent-green',
  CARD: 'bg-info',
  BANK: 'bg-ink-400',
  CREDIT: 'bg-warn',
};

export default function Dashboard() {
  const { me, can } = useAuth();
  const { stations, station, stationId } = useStations();
  const [date, setDate] = useState(todayIst());
  const [days, setDays] = useState(7);
  const [chartMetric, setChartMetric] = useState<'value' | 'litres'>('value');
  const [compare, setCompare] = useState(false);
  const chart = useChartPalette();

  const dashboard = useQuery({
    queryKey: ['dashboard', stationId, date],
    queryFn: () => apiGet<DashboardData>(`/reports/owner-dashboard?stationId=${stationId}&date=${date}`),
    enabled: Boolean(stationId) && !compare,
    refetchInterval: 60_000,
  });

  const alertsQuery = useQuery({
    queryKey: ['shift-alerts', stationId],
    queryFn: () => apiGet<ShiftAlertsResponse>(`/shifts/alerts?stationId=${stationId}`),
    enabled: Boolean(stationId) && !compare,
    refetchInterval: 60_000,
  });

  const pricesQuery = useQuery<PriceRow[]>({
    queryKey: ['prices', stationId],
    queryFn: () => apiGet<PriceRow[]>(`/catalog/prices?stationId=${stationId}`),
    enabled: Boolean(stationId) && !compare,
    refetchInterval: 60_000,
  });

  const rates = useMemo(() => {
    const found = new Map<string, PriceRow>();
    for (const price of pricesQuery.data ?? []) {
      if (
        !price.effectiveTo &&
        (!price.stationId || price.stationId === stationId) &&
        !found.has(price.productId)
      ) {
        found.set(price.productId, price);
      }
    }
    return [...found.values()];
  }, [pricesQuery.data, stationId]);

  const trend = useMemo(
    () =>
      (dashboard.data?.trend ?? []).slice(-days).map((row) => ({
        // The dashboard API currently returns MM-DD; tolerate full ISO dates too.
        date: row.date.length > 5 ? row.date.slice(5) : row.date,
        value: Number(row.value),
        litres: Number(row.litres),
      })),
    [dashboard.data, days],
  );

  const periodStats = useMemo(() => {
    const totalVal = trend.reduce((sum, r) => sum + r.value, 0);
    const totalLitres = trend.reduce((sum, r) => sum + r.litres, 0);
    const avgVal = trend.length > 0 ? totalVal / trend.length : 0;
    return { totalVal, totalLitres, avgVal };
  }, [trend]);

  if (compare && me?.user.roleKey === 'OWNER') {
    return <CombinedDashboard date={date} setDate={setDate} onBack={() => setCompare(false)} />;
  }
  if (!stationId) {
    return (
      <Card>
        <EmptyState
          title="No pump assigned"
          description="Ask the owner to assign your manager account to a pump."
          icon={<Store />}
        />
      </Card>
    );
  }
  if (dashboard.isLoading) {
    return (
      <div className="space-y-5">
        <LoadingBlock rows={2} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <Card key={n}>
              <LoadingBlock rows={2} />
            </Card>
          ))}
        </div>
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      </div>
    );
  }
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;

  const data = dashboard.data!;
  const openShift = data.openShifts[0];
  const lowStock = data.stock.filter((tank) => Number(tank.fillPct) < 15);
  const totalBookStock = data.stock.reduce((sum, tank) => sum + (Number(tank.bookStockLitres) || 0), 0);
  const alerts = buildAttentionItems(data, alertsQuery.data);
  const firstName = me?.user.name.split(' ')[0] ?? '';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(
      new Date(),
    ),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const paymentEntries = Object.entries(data.sales.byMode).filter(([, amount]) => Number(amount) > 0);
  const paymentTotal = paymentEntries.reduce((sum, [, amount]) => sum + Number(amount), 0);

  // Shortcuts only promise actions the current login can actually open.
  const canViewShifts = can('shifts.read');
  const shiftLink = openShift || !can('shifts.open') ? '/shifts' : '/shifts?new=shift';
  const shiftLabel = openShift ? 'Manage shift' : can('shifts.open') ? 'Open a shift' : 'View shifts';
  const actions = [
    {
      to: shiftLink,
      label: shiftLabel,
      detail: 'Readings & settlement',
      icon: <ListChecks className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-accent/10 text-accent',
      visible: canViewShifts,
    },
    {
      to: '/deliveries?new=delivery',
      label: 'Record delivery',
      detail: 'Receive fuel stock',
      icon: <Truck className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-accent-green/10 text-accent-green',
      visible: can('deliveries.read') && can('deliveries.write'),
    },
    {
      to: '/finance?new=expense',
      label: 'Add expense',
      detail: 'Keep cash in check',
      icon: <Wallet className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-warn/10 text-warn',
      visible: can('payments.read') && can('expenses.write'),
    },
    {
      to: '/customers',
      label: 'Customer credit',
      detail: 'Fleet credit & receipts',
      icon: <Users className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-graphite/10 text-graphite',
      visible: can('customers.read'),
    },
  ].filter((action) => action.visible);

  const activeStroke = chartMetric === 'value' ? chart.accent : chart.green;

  return (
    <>
      {/* A station-specific starting point; the forecourt image is decorative. */}
      <div className="dashboard-hero relative isolate mb-5 overflow-hidden rounded-2.5xl p-5 text-white sm:p-6 lg:p-7">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-[620px]">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-2 rounded-full border border-panel-energy/25 bg-panel-energy/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-panel-energy">
                <span className="h-1.5 w-1.5 rounded-full bg-panel-energy" aria-hidden />
                Station overview
              </span>
              <span className="font-mono text-[10px] font-semibold tracking-wider text-white/55">
                {station?.code ?? data.station.code}
              </span>
            </div>
            <h1 className="mt-4 font-display text-[27px] font-extrabold leading-tight tracking-[-0.035em] text-white sm:text-[32px]">
              {greeting}, {firstName}<span className="text-panel-energy">.</span>
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-white/70">
              Here’s what’s happening at <span className="font-semibold text-white">{station?.name ?? data.station.name}</span>.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold',
                openShift ? 'border-live/25 bg-live/10 text-live' : 'border-white/15 bg-white/5 text-white/75',
              )}>
                <span className={cn('h-2 w-2 rounded-full', openShift ? 'bg-live' : 'bg-white/50')} aria-hidden />
                {openShift ? (
                  <>
                    Shift #{String(openShift.shiftNumber)} open
                    {openShift.operatorName ? <span className="font-normal text-white/70">· {String(openShift.operatorName)}</span> : null}
                  </>
                ) : 'No shift open'}
              </span>
              {data.flaggedShifts > 0 && canViewShifts && (
                <Link to="/shifts" className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 font-semibold text-white hover:bg-white/20">
                  {data.flaggedShifts} flagged {data.flaggedShifts === 1 ? 'shift' : 'shifts'}
                </Link>
              )}
              <span className="num text-[11px] font-medium text-white/55">Updated {formatClockTime(dashboard.dataUpdatedAt)} IST</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-sm:w-full lg:justify-end">
            {me?.user.roleKey === 'OWNER' && stations.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCompare(true)}
                aria-label="Compare both pumps"
                icon={<Store className="h-3.5 w-3.5" />}
                className="h-10 border-white/20 bg-black/30 text-white hover:bg-white/15 hover:text-white"
              >
                <span className="sm:hidden">Compare</span>
                <span className="hidden sm:inline">Compare both pumps</span>
              </Button>
            )}
            <Input
              type="date"
              aria-label="Business date"
              value={date}
              max={todayIst()}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
              className="h-10 w-auto border-white/20 bg-black/30 text-xs text-white [color-scheme:dark] hover:border-white/40"
            />
            {canViewShifts && (
              <Link
                to={shiftLink}
                className="brand-gradient inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold text-onbrand shadow-glow transition hover:brightness-110"
              >
                {openShift || !can('shifts.open') ? <ArrowUpRight className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {openShift ? 'Manage shift' : can('shifts.open') ? 'Open shift' : 'View shifts'}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Current configured prices are always independent of the selected business date. */}
      {rates.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-carbon-700/80 bg-carbon-850 px-4 py-3.5 shadow-card sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                <Tags className="h-4 w-4" aria-hidden />
              </span>
              <span>
                <span className="block text-xs font-bold text-ink-100">Current fuel rates</span>
                <span className="block text-[10.5px] text-ink-500">At this pump · per litre</span>
              </span>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              {rates.map((rate) => {
                const matchingTank = data.stock.find((t) => t.productName === rate.productName);
                const dotColor = matchingTank?.productColor ?? 'rgb(var(--accent))';
                return (
                  <div key={rate.id} className="rounded-xl border border-carbon-700/60 bg-carbon-800/60 px-3 py-2 sm:inline-flex sm:items-center sm:gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden />
                      <span className="text-[11px] font-semibold text-ink-400">{rate.productName}</span>
                    </span>
                    <span className="num mt-0.5 block pl-4 font-display text-[13px] font-extrabold text-ink-100 sm:mt-0 sm:pl-0">{formatINR(rate.ratePerLitre)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {can('products.read') && (
            <Link to="/products" className="link text-xs">
              {can('prices.write') ? 'Update prices' : 'Price history'} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-extrabold tracking-tight text-ink-100">Station snapshot</h2>
          <p className="mt-0.5 text-xs text-ink-500">Your key numbers for {formatDate(date)}</p>
        </div>
        <span className="text-[11px] font-medium text-ink-500">Sales based on closed & flagged shifts</span>
      </div>
      {/* Executive KPI Strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <MetricCard
          label="Estimated sales"
          value={formatINR(data.sales.shiftValue)}
          hint={`${data.sales.shiftCount} closed or flagged shifts · ${data.sales.transactions} recorded tx`}
          icon={<IndianRupee className="h-4 w-4" />}
          tone="accent"
        />
        <MetricCard
          label="Fuel dispensed"
          value={formatLitres(data.sales.shiftLitres)}
          hint="Net volume from shift totalizers"
          icon={<Fuel className="h-4 w-4" />}
        />
        <MetricCard
          label="Customer receivables"
          value={formatINR(data.receivables)}
          hint={`Credit ledger · Payables ${formatINR(data.payables, true)}`}
          icon={<Users className="h-4 w-4" />}
          tone={Number(data.receivables) > 0 ? 'warning' : 'default'}
          to={can('customers.read') ? '/customers' : undefined}
        />
        <MetricCard
          label="Open shifts"
          value={String(data.openShifts.length).padStart(2, '0')}
          hint={
            data.flaggedShifts
              ? `${data.flaggedShifts} flagged shifts require approval`
              : openShift
                ? 'Active forecourt shift accepting readings'
                : 'Ready to open next crew shift'
          }
          icon={<Clock3 className="h-4 w-4" />}
          tone={data.flaggedShifts ? 'warning' : openShift ? 'success' : 'default'}
          to={canViewShifts ? '/shifts' : undefined}
        />
      </div>

      {/* Quick Operational Workflows */}
      {actions.length > 0 && (
        <section className="mt-6" aria-labelledby="quick-actions-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="quick-actions-title" className="font-display text-base font-extrabold tracking-tight text-ink-100">
              Quick actions
            </h2>
            <span className="hidden text-[11px] font-medium text-ink-500 sm:block">Everything you need, a tap away</span>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {actions.map((action) => (
              <Link key={action.to} to={action.to} className="quick-action group">
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105 sm:h-11 sm:w-11', action.iconStyle)}>
                  {action.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-xs font-bold leading-snug tracking-tight text-ink-100 sm:text-[13.5px]">
                    {action.label}
                  </span>
                  <span className="sr-only text-xs text-ink-500 min-[440px]:not-sr-only min-[440px]:mt-0.5 min-[440px]:block">{action.detail}</span>
                </span>
                <ChevronRight
                  className="ml-auto hidden h-4 w-4 shrink-0 text-ink-500 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent sm:block"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Primary Analytics & Underground Tank Silo Telemetry */}
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(330px,1fr)]">
        <Card className="flex flex-col">
          <CardHeader
            title="Sales performance"
            subtitle="Estimated sales and volume from shift totalizers"
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <div
                  className="flex rounded-xl border border-carbon-700/80 bg-carbon-800/75 p-0.5"
                  aria-label="Chart metric"
                >
                  {[
                    { key: 'value' as const, label: 'Revenue' },
                    { key: 'litres' as const, label: 'Litres' },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setChartMetric(m.key)}
                      aria-pressed={chartMetric === m.key}
                      className={cn(
                        'min-h-7 rounded-lg px-2.5 text-[11px] font-semibold transition',
                        chartMetric === m.key
                          ? 'bg-carbon-900 text-ink-100 shadow-sm'
                          : 'text-ink-500 hover:text-ink-200',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div
                  className="flex rounded-xl border border-carbon-700/80 bg-carbon-800/75 p-0.5"
                  aria-label="Chart period"
                >
                  {[7, 14].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDays(value)}
                      aria-pressed={days === value}
                      className={cn(
                        'min-h-7 rounded-lg px-2.5 text-[11px] font-semibold transition',
                        days === value
                          ? 'bg-carbon-900 text-accent shadow-sm'
                          : 'text-ink-500 hover:text-ink-200',
                      )}
                    >
                      {value}d
                    </button>
                  ))}
                </div>
              </div>
            }
          />
          <CardBody className="flex flex-1 flex-col">
            <div className="mb-4 grid grid-cols-3 gap-2.5 rounded-2xl border border-carbon-700/70 bg-carbon-800/45 p-3.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                  {days}d Revenue
                </p>
                <p className="num mt-0.5 font-display text-sm font-extrabold text-ink-100 sm:text-base">
                  {formatINR(periodStats.totalVal, true)}
                </p>
              </div>
              <div className="border-x border-carbon-700/60 px-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Daily Avg</p>
                <p className="num mt-0.5 font-display text-sm font-extrabold text-ink-100 sm:text-base">
                  {formatINR(periodStats.avgVal, true)}
                </p>
              </div>
              <div className="pl-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                  {days}d Volume
                </p>
                <p className="num mt-0.5 font-display text-sm font-extrabold text-accent sm:text-base">
                  {formatLitres(periodStats.totalLitres)}
                </p>
              </div>
            </div>

            <div
              className="h-[240px] min-h-[240px] w-full flex-1"
              role="img"
              aria-label={`${days}-day estimated ${chartMetric === 'value' ? 'sales' : 'fuel volume'} chart. ${trend.map((row) => `${row.date}: ${chartMetric === 'value' ? formatINR(row.value) : formatLitres(row.litres)}`).join('; ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={activeStroke} stopOpacity={0.26} />
                      <stop offset="100%" stopColor={activeStroke} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: chart.axis }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                    dy={6}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: chart.axis }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) =>
                      chartMetric === 'value'
                        ? `₹${Number(value) >= 100000 ? `${(value / 100000).toFixed(1)}L` : `${Math.round(value / 1000)}k`}`
                        : `${Number(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}L`
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: chart.tooltipBg,
                      border: `1px solid ${chart.tooltipBorder}`,
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow: '0 14px 34px rgb(0 0 0 / 0.18)',
                    }}
                    labelStyle={{ color: chart.tooltipLabel, fontWeight: 700, marginBottom: 4 }}
                    formatter={(value: number, _name, item) => {
                      const payload = item?.payload as { litres?: number; value?: number } | undefined;
                      if (chartMetric === 'litres') {
                        return [
                          `${formatLitres(value)} (${formatINR(payload?.value ?? 0)})`,
                          'Dispensed',
                        ];
                      }
                      return [
                        `${formatINR(value)} (${formatLitres(payload?.litres ?? 0)})`,
                        'Est. sales',
                      ];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey={chartMetric}
                    stroke={activeStroke}
                    fill="url(#salesFill)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2.5, stroke: chart.tooltipBg }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-carbon-700/65 pt-3.5">
              <span className="text-xs text-ink-500">
                Selected date recorded tx:{' '}
                <strong className="num ml-1 font-semibold text-ink-100">
                  {formatINR(data.sales.transactionValue)}
                </strong>
              </span>
              <Link to="/reports" className="link text-xs">
                Open Daily Sales Report <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </CardBody>
        </Card>

        {/* Underground Tank Silo Telemetry */}
        <Card className="flex flex-col">
          <CardHeader
            title="Fuel stock levels"
            subtitle="Book stock, capacity & available ullage"
            action={can('stock.read') ? (
              <Link to="/tanks" className="link text-xs">
                Tank ledger →
              </Link>
            ) : undefined}
          />
          <CardBody className="flex flex-1 flex-col gap-3">
            {data.stock.length === 0 ? (
              <EmptyState title="No tanks yet" description="Add a tank in Settings to start tracking stock." />
            ) : (
              data.stock.map((tank) => {
                const fill = Math.max(0, Math.min(100, Number(tank.fillPct)));
                const ullage = Math.max(0, Number(tank.capacityLitres) - Number(tank.bookStockLitres));
                const isLow = fill < 15;
                const isWatch = !isLow && fill < 25;
                const liquidColor = isLow
                  ? 'rgb(var(--danger))'
                  : isWatch
                    ? 'rgb(var(--warn))'
                    : tank.productColor || 'rgb(var(--accent))';
                return (
                  <div
                    key={tank.id}
                    className="flex items-center gap-3.5 rounded-2xl border border-carbon-700/75 bg-carbon-800/40 p-3.5 transition hover:border-carbon-600"
                  >
                    {/* Visual Vertical Tank Silo */}
                    <div
                      aria-hidden
                      className="relative h-14 w-9 shrink-0 overflow-hidden rounded-xl border border-carbon-600/80 bg-inset shadow-inner"
                    >
                      <div
                        className="absolute inset-x-0 bottom-0 transition-all duration-500"
                        style={{
                          height: `${fill}%`,
                          backgroundColor: liquidColor,
                          opacity: 0.85,
                        }}
                      >
                        <div className="h-[2px] w-full bg-white/45" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-display text-xs font-bold text-ink-100">
                            {tank.productName}
                          </span>
                          <span className="rounded border border-carbon-700 bg-carbon-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-400">
                            {tank.code}
                          </span>
                          <span className="num text-[11px] font-bold text-ink-300">{formatNumber(fill, 0)}%</span>
                        </div>
                        <Badge tone={isLow ? 'danger' : isWatch ? 'warning' : 'success'} dot>
                          {isLow ? 'Low' : isWatch ? 'Reorder' : 'Optimal'}
                        </Badge>
                      </div>

                      <MeterBar
                        value={fill}
                        tone={isLow ? 'danger' : isWatch ? 'warn' : 'accent'}
                        color={!isLow && !isWatch ? tank.productColor : undefined}
                        height="sm"
                        label={`${tank.productName} tank fill`}
                      />

                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500">
                        <span className="num">
                          <strong className="font-semibold text-ink-100">
                            {formatLitres(tank.bookStockLitres)}
                          </strong>{' '}
                          / {formatLitres(tank.capacityLitres)}
                        </span>
                        <span className="num font-medium">Ullage {formatNumber(ullage, 0)} L</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {data.stock.length > 0 && (
              <div className="mt-auto flex items-center justify-between gap-3 rounded-xl bg-accent/6 px-3.5 py-3">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-300">
                  <Droplets className="h-4 w-4 text-accent" aria-hidden />
                  Current book stock
                </span>
                <span className="num font-display text-sm font-extrabold text-ink-100">{formatLitres(totalBookStock)}</span>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Bottom Forecourt Operations Grid */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {/* Active Shift Console */}
        <Card className="flex flex-col">
          <CardHeader
            title="Forecourt shift status"
            subtitle="Active crew & totalizer capture"
            action={canViewShifts ? (
              <Link to="/shifts" className="link text-xs">
                All shifts →
              </Link>
            ) : undefined}
          />
          <CardBody className="flex flex-1 flex-col justify-between">
            {openShift ? (
              <>
                <div>
                  <div className="hero-mesh flex items-center justify-between gap-2 rounded-2xl border border-carbon-700/75 bg-carbon-800/45 p-3.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent shadow-sheen">
                        <ListChecks className="h-4.5 w-4.5" />
                      </span>
                      <div>
                        <p className="font-display text-sm font-bold text-ink-100">
                          Shift #{String(openShift.shiftNumber)}
                        </p>
                        <p className="text-[11px] text-ink-500">
                          Operator: {String(openShift.operatorName ?? openShift.openedByName ?? '—')}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status="OPEN" />
                  </div>
                  <p className="mt-3 text-xs text-ink-400">
                    Opened <span className="num font-medium text-ink-200">{formatDateTime(String(openShift.openedAt))}</span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {can('readings.read') && (
                      <Link
                        to="/readings"
                        className="flex items-center gap-2 rounded-xl border border-carbon-700/80 bg-carbon-800/40 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:border-accent/45 hover:bg-carbon-800 hover:text-ink-100"
                      >
                        <Gauge className="h-3.5 w-3.5 text-accent" aria-hidden /> Meter readings
                      </Link>
                    )}
                    {can('density.read') && (
                      <Link
                        to="/density"
                        className="flex items-center gap-2 rounded-xl border border-carbon-700/80 bg-carbon-800/40 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:border-accent/45 hover:bg-carbon-800 hover:text-ink-100"
                      >
                        <Thermometer className="h-3.5 w-3.5 text-accent" aria-hidden /> Density check
                      </Link>
                    )}
                  </div>
                </div>
                {canViewShifts && (
                  <Link
                    to="/shifts"
                    className="mt-4 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 text-xs font-bold text-accent transition hover:bg-accent/16"
                  >
                    Continue shift &amp; settle <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <p className="mt-3 font-display text-sm font-bold text-ink-100">No shift currently open</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-400">
                  Open a shift to capture nozzle opening totalizers for the incoming crew.
                </p>
                {canViewShifts && can('shifts.open') && (
                  <Link to="/shifts?new=shift" className="mt-4">
                    <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>
                      Open shift
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Actionable Attention Center */}
        <Card className="flex flex-col">
          <CardHeader
            title="Needs attention"
            subtitle="Live operational & compliance checks"
            action={
              <Badge tone={alerts.some((a) => a.level === 'error') ? 'danger' : alerts.length ? 'warning' : 'success'} dot>
                {alerts.length ? `${alerts.length} active` : 'All clear'}
              </Badge>
            }
          />
          <CardBody className="max-h-64 flex-1 space-y-2.5 overflow-y-auto scroll-thin">
            {alerts.length ? (
              alerts.map((alert) => {
                const isErr = alert.level === 'error';
                const Icon = isErr ? AlertCircle : AlertTriangle;
                const rowStyle = isErr
                  ? 'border-danger/25 bg-danger/8 hover:border-danger/45'
                  : 'border-warn/25 bg-warn/8 hover:border-warn/45';
                const body = (
                  <>
                    <Icon
                      className={cn('mt-0.5 h-4 w-4 shrink-0', isErr ? 'text-danger' : 'text-warn')}
                      aria-hidden
                    />
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-200">{alert.message}</p>
                    {alert.to && (
                      <ChevronRight
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-ink-100"
                        aria-hidden
                      />
                    )}
                  </>
                );
                return alert.to ? (
                  <Link
                    key={alert.id}
                    to={alert.to}
                    className={cn('group flex items-start gap-2.5 rounded-xl border p-3 transition', rowStyle)}
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={alert.id} className={cn('flex items-start gap-2.5 rounded-xl border p-3', rowStyle)}>
                    {body}
                  </div>
                );
              })
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-6 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-ok/25 bg-ok/10 text-ok">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <p className="mt-3 font-display text-xs font-bold text-ink-100">All checks passing</p>
                <p className="mt-0.5 text-[11px] text-ink-500">Nothing requires immediate intervention.</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recorded Payment Mix */}
        <Card className="flex flex-col lg:col-span-2 xl:col-span-1">
          <CardHeader
            title="Recorded payment mix"
            subtitle="Transaction-level collections by mode"
            action={can('payments.read') ? (
              <Link to="/finance" className="link text-xs">
                Finance →
              </Link>
            ) : undefined}
          />
          <CardBody className="flex flex-1 flex-col justify-between">
            {paymentTotal > 0 ? (
              <div className="space-y-4">
                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-carbon-800 p-0.5 ring-1 ring-inset ring-carbon-700/65">
                  {paymentEntries.map(([mode, amount]) => (
                    <div
                      key={mode}
                      className={cn('h-full rounded-full transition-all duration-300', MODE_COLORS[mode] ?? 'bg-accent')}
                      style={{ width: `${(Number(amount) / paymentTotal) * 100}%` }}
                      title={`${MODE_LABELS[mode] ?? mode}: ${formatINR(amount)}`}
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  {paymentEntries.map(([mode, amount]) => {
                    const share = (Number(amount) / paymentTotal) * 100;
                    return (
                      <div
                        key={mode}
                        className="flex items-center justify-between rounded-xl border border-carbon-700/55 bg-carbon-800/35 px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center gap-2 font-medium text-ink-200">
                          <span
                            className={cn('h-2.5 w-2.5 rounded-full', MODE_COLORS[mode] ?? 'bg-accent')}
                            aria-hidden
                          />
                          {MODE_LABELS[mode] ?? mode}
                        </span>
                        <span className="num flex items-center gap-2">
                          <span className="rounded bg-carbon-800 px-1.5 py-0.5 text-[10px] font-semibold text-ink-400">
                            {formatNumber(share, 0)}%
                          </span>
                          <strong className="font-bold text-ink-100">{formatINR(amount)}</strong>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-carbon-700 bg-carbon-800/60 text-ink-500">
                  <Droplets className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-2.5 text-xs font-semibold text-ink-300">No transaction-level sales on this date</p>
                <p className="mt-0.5 max-w-xs text-[11px] leading-relaxed text-ink-500">
                  Totalizer shifts capture aggregate volume; mode splits come from settlements &amp; credit slips.
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-carbon-700/65 pt-3 text-xs">
              <span className="font-medium text-ink-500">Recorded total</span>
              <span className="num font-display text-sm font-extrabold text-ink-100">{formatINR(paymentTotal)}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-carbon-700/65 bg-carbon-850/70 px-4 py-3 text-[11px] text-ink-500 shadow-sheen">
        <p>{data.disclaimer} Tank levels reflect ledger book stock.</p>
        <span className="num shrink-0 font-semibold text-ink-400">
          {lowStock.length ? `${lowStock.length} tanks below 15%` : `${data.stock.length} underground tanks monitored`}
        </span>
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  to,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning';
  to?: string;
}) {
  const card = (
    <StatCard
      label={label}
      value={value}
      hint={hint}
      icon={icon}
      tone={tone}
    />
  );
  return to ? (
    <Link
      to={to}
      className="block rounded-2xl transition-all duration-200 ease-smooth hover:-translate-y-0.5 [&>.card]:hover:border-accent/45 [&>.card]:hover:shadow-card-hover"
    >
      {card}
    </Link>
  ) : (
    card
  );
}

/* ----------------------------------------------------- Multi-Outlet Compare */

interface CombinedStation {
  id: string;
  name: string;
  code: string;
  litres: string;
  value: string;
  monthValue: string;
  shortExcess: string | null;
  tanks: DashboardData['stock'];
  alerts: DashboardData['alerts'];
  trend: { date: string; value: string }[];
}

interface CombinedData {
  date: string;
  stations: CombinedStation[];
  totalValue: string;
  totalLitres: string;
  monthValue: string;
}

function CombinedDashboard({
  date,
  setDate,
  onBack,
}: {
  date: string;
  setDate: (date: string) => void;
  onBack: () => void;
}) {
  const { selectStation } = useStations();
  const chart = useChartPalette();
  const result = useQuery<CombinedData>({
    queryKey: ['combined-dashboard', date],
    queryFn: () => apiGet(`/reports/combined-dashboard?date=${date}`),
    refetchInterval: 60_000,
  });

  if (result.isLoading) return <LoadingBlock rows={8} />;
  if (result.isError || !result.data) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;

  const data = result.data;
  const grandTotal = Number(data.totalValue) || 0;
  const chartRows = data.stations.map((s) => ({
    outlet: s.code,
    name: s.name,
    daySales: Number(s.value),
    monthSales: Number(s.monthValue),
  }));

  return (
    <>
      <div className="card hero-mesh relative mb-6 overflow-hidden p-5 sm:p-6">
        <span aria-hidden className="brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5 text-accent">Multi-Outlet Executive Overview</p>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink-100 sm:text-[28px]">
              Both pumps. One clear picture.
            </h1>
            <p className="mt-1 text-xs text-ink-400 sm:text-sm">
              Side-by-side forecourt sales, tank positions and cash settlement for {formatDate(date)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="Business date"
              value={date}
              max={todayIst()}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
              className="h-9.5 w-auto text-xs"
            />
            <Button size="sm" onClick={onBack} variant="outline" className="h-9.5">
              Single pump
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Combined estimated sales"
          value={formatINR(data.totalValue)}
          hint={`${formatLitres(data.totalLitres)} dispensed across outlets`}
          icon={<Banknote className="h-4 w-4" />}
          tone="accent"
        />
        <StatCard
          label="Month-to-date sales"
          value={formatINR(data.monthValue)}
          hint="Aggregate closed & flagged shifts"
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard
          label="Active outlets"
          value={String(data.stations.length)}
          hint="Independent ledgers, unified owner governance"
          icon={<Store className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {chartRows.length > 1 && (
        <Card className="mt-5">
          <CardHeader
            title="Outlet sales comparison"
            subtitle="Selected business date vs month-to-date performance (INR)"
            action={
              <div className="flex items-center gap-3 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chart.accent }} />
                  Selected date
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chart.secondary }} />
                  Month to date
                </span>
              </div>
            }
          />
          <CardBody>
            <div className="h-[195px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="outlet" tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: chart.axis }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      `₹${Number(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}k`}`
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: chart.tooltipBg,
                      border: `1px solid ${chart.tooltipBorder}`,
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value: number, key: string) => [
                      formatINR(value),
                      key === 'daySales' ? 'Selected date' : 'Month to date',
                    ]}
                  />
                  <Bar dataKey="daySales" fill={chart.accent} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  <Bar dataKey="monthSales" fill={chart.secondary} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {data.stations.map((pump) => {
          const share = grandTotal > 0 ? (Number(pump.value) / grandTotal) * 100 : 0;
          return (
            <Card key={pump.id} className="flex flex-col">
              <CardHeader
                title={pump.name}
                subtitle={`${pump.code} · ${formatNumber(share, 0)}% of organization day sales`}
                action={
                  <Badge tone={pump.alerts.length ? 'warning' : 'success'} dot>
                    {pump.alerts.length} alerts
                  </Badge>
                }
              />
              <CardBody className="flex flex-1 flex-col justify-between space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-carbon-700/75 bg-carbon-800/45 p-3.5 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Day sales</p>
                    <p className="num mt-0.5 font-display text-lg font-extrabold text-ink-100">
                      {formatINR(pump.value)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Dispensed</p>
                    <p className="num mt-0.5 font-display text-lg font-extrabold text-accent">
                      {formatLitres(pump.litres)}
                    </p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Cash variance</p>
                    <p
                      className={cn(
                        'num mt-0.5 text-sm font-bold',
                        pump.shortExcess === null
                          ? 'text-ink-400'
                          : Number(pump.shortExcess) < 0
                            ? 'text-danger'
                            : 'text-ok',
                      )}
                    >
                      {pump.shortExcess === null ? 'Not settled' : formatINR(pump.shortExcess)}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Tank inventory</p>
                  {pump.tanks.map((tank) => {
                    const fill = Math.max(0, Math.min(100, Number(tank.fillPct)));
                    return (
                      <div key={tank.id}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="font-semibold text-ink-200">
                            {tank.code} · {tank.productName}
                          </span>
                          <span className="num text-ink-400">
                            {formatLitres(tank.bookStockLitres)} ({formatNumber(fill, 0)}%)
                          </span>
                        </div>
                        <MeterBar
                          value={fill}
                          tone={fill < 15 ? 'danger' : fill < 25 ? 'warn' : 'accent'}
                          color={fill >= 25 ? tank.productColor : undefined}
                          height="sm"
                        />
                      </div>
                    );
                  })}
                </div>

                {pump.alerts.length > 0 && (
                  <div className="space-y-1.5 border-t border-carbon-700/70 pt-3">
                    {pump.alerts.slice(0, 3).map((alert, index) => (
                      <p key={index} className="flex items-start gap-2 text-xs text-ink-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                        <span>{alert.message}</span>
                      </p>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    selectStation(pump.id);
                    onBack();
                  }}
                >
                  Open this pump <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-ink-500">
        Sales figures represent shift totalizer estimates, not audited invoice revenue. Tank levels reflect book stock.
      </p>
    </>
  );
}
