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
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Database,
  Droplets,
  Eye,
  Fuel,
  Gauge,
  Landmark,
  ListChecks,
  Plus,
  RefreshCw,
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

interface DeliveryPreview {
  id: string;
  supplierName: string;
  productName: string;
  invoiceNumber: string;
  invoiceDate: string;
  quantityLitres: string;
  totalAmount: string;
  status: string;
}

interface CustomerPreview {
  id: string;
  code: string;
  name: string;
  creditLimit: string;
  creditDays: number;
  balance: string;
  status: string;
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
  UPI: 'bg-ok',
  CARD: 'bg-info',
  BANK: 'bg-ink-400',
  CREDIT: 'bg-fuel',
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

  const deliveriesQuery = useQuery<DeliveryPreview[]>({
    queryKey: ['dashboard-deliveries', stationId],
    queryFn: () => apiGet<DeliveryPreview[]>(`/inventory/deliveries?stationId=${stationId}&pageSize=5`),
    enabled: Boolean(stationId) && !compare && can('deliveries.read'),
    refetchInterval: 60_000,
  });

  const customersQuery = useQuery<CustomerPreview[]>({
    queryKey: ['dashboard-customers'],
    queryFn: () => apiGet<CustomerPreview[]>('/catalog/customers?pageSize=25'),
    enabled: Boolean(stationId) && !compare && can('customers.read'),
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

  const duesOverview = useMemo(() => {
    const allCustomers = customersQuery.data ?? [];
    const totalLimit = allCustomers.reduce((sum, c) => sum + (Number(c.creditLimit) || 0), 0);
    const totalBalance = allCustomers.reduce((sum, c) => sum + Math.max(0, Number(c.balance) || 0), 0);
    const pending = [...allCustomers]
      .filter((c) => Number(c.balance) > 0)
      .sort((a, b) => Number(b.balance) - Number(a.balance));
    const settledRatio = totalLimit > 0 ? Math.max(0, Math.min(100, Math.round(((totalLimit - totalBalance) / totalLimit) * 100))) : 100;
    return {
      totalCount: allCustomers.length,
      totalLimit,
      pending,
      settledRatio,
    };
  }, [customersQuery.data]);

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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((n) => (
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
  const totalCapacity = data.stock.reduce((sum, tank) => sum + (Number(tank.capacityLitres) || 0), 0);
  const totalUllage = Math.max(0, totalCapacity - totalBookStock);
  const overallFillPct = totalCapacity > 0 ? Math.min(100, Math.round((totalBookStock / totalCapacity) * 100)) : 0;
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
  const receivablesNum = Number(data.receivables) || 0;
  const payablesNum = Number(data.payables) || 0;
  const recentDeliveries = deliveriesQuery.data ?? [];
  const showLedgerRow = can('deliveries.read') || can('customers.read');
  const refreshing =
    dashboard.isFetching ||
    alertsQuery.isFetching ||
    pricesQuery.isFetching ||
    deliveriesQuery.isFetching ||
    customersQuery.isFetching;

  const actions = [
    {
      to: openShift ? '/shifts' : '/shifts?new=shift',
      label: openShift ? 'Manage shift' : 'Open a shift',
      detail: 'Readings & settlement',
      icon: <ListChecks className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-accent/10 text-accent border border-accent/15',
    },
    {
      to: '/deliveries?new=delivery',
      label: 'Record delivery',
      detail: 'Receive fuel stock',
      icon: <Truck className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-ok/10 text-ok border border-ok/15',
    },
    {
      to: '/finance?new=expense',
      label: 'Add expense',
      detail: 'Keep cash in check',
      icon: <Wallet className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-fuel/15 text-energy border border-fuel/25',
    },
    {
      to: '/customers',
      label: 'Customer credit',
      detail: 'Fleet credit & receipts',
      icon: <Users className="h-[18px] w-[18px]" />,
      iconStyle: 'bg-info/10 text-info border border-info/15',
    },
  ];

  const activeStroke = chartMetric === 'value' ? chart.accent : chart.green;

  return (
    <>
      {/* Executive ERP Workspace Banner */}
      <div className="dashboard-hero relative isolate mb-5 overflow-hidden rounded-2.5xl p-4 text-white sm:p-6 lg:px-7 lg:py-6">
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/75">
              <span className="rounded-md border border-[#f2be58]/35 bg-[#f2be58]/14 px-2 py-0.5 text-[9.5px] font-extrabold tracking-[0.13em] text-[#f4c96b]">
                Company Workspace
              </span>
              <span className="truncate text-white/75">
                · {me?.tenant?.name ?? station?.name ?? data.station.name}
              </span>
              <span className="rounded border border-white/18 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-white">
                {station?.code ?? data.station.code}
              </span>
            </div>

            <h1 className="mt-2.5 font-display text-[24px] font-extrabold leading-tight tracking-[-0.035em] text-white sm:text-[30px]">
              {greeting}, {firstName}
              <span className="text-[#f2be58]">.</span>
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/75 sm:text-[13.5px]">
              Real-time procurement, shifts, payables, tank balance &amp; credit modules for{' '}
              <span className="font-semibold text-white">{station?.name ?? data.station.name}</span>.
            </p>

            <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/10 px-3 py-1 font-semibold text-white">
                <span className={cn('h-2 w-2 rounded-full', openShift ? 'bg-live' : 'bg-white/45')} aria-hidden />
                {openShift ? (
                  <>
                    Shift #{String(openShift.shiftNumber)} Live
                    {openShift.operatorName ? (
                      <span className="font-normal text-white/75">· {String(openShift.operatorName)}</span>
                    ) : null}
                  </>
                ) : (
                  'No shift open'
                )}
              </span>
              {data.flaggedShifts > 0 && (
                <Link
                  to="/shifts"
                  className="rounded-full border border-[#f2be58]/40 bg-[#f2be58]/16 px-3 py-1 font-semibold text-[#f7d486] transition hover:bg-[#f2be58]/25"
                >
                  {data.flaggedShifts} flagged {data.flaggedShifts === 1 ? 'shift' : 'shifts'}
                </Link>
              )}
              <span className="num text-[11px] font-medium text-white/55">
                Updated {formatClockTime(dashboard.dataUpdatedAt)} IST
              </span>
            </div>
          </div>

          {/* Executive Hero Action Bar */}
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Link
              to={openShift ? '/shifts' : '/shifts?new=shift'}
              className="gold-cta inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-extrabold transition active:scale-[.985]"
            >
              {openShift ? <ArrowUpRight className="h-4 w-4" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
              {openShift ? 'Manage Shift' : 'Open Shift'}
            </Link>

            {can('sales.read') && (
              <Link
                to="/sales"
                className="hero-glass-btn hidden min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition sm:inline-flex"
              >
                <Fuel className="h-3.5 w-3.5 text-[#f2be58]" aria-hidden />
                Fuel Sales
              </Link>
            )}

            {can('payments.read') && (
              <Link
                to="/finance"
                className="hero-glass-btn hidden min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition md:inline-flex"
              >
                <ArrowDownLeft className="h-3.5 w-3.5 text-live" aria-hidden />
                Receive Payment
              </Link>
            )}

            {me?.user.roleKey === 'OWNER' && stations.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCompare(true)}
                icon={<Store className="h-3.5 w-3.5" />}
                className="hero-glass-btn h-10 text-xs font-semibold text-white hover:text-white"
              >
                Compare both pumps
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
              className="hero-glass-btn h-10 w-auto min-w-0 max-w-full px-3 text-xs text-white [color-scheme:dark]"
            />

            <button
              type="button"
              onClick={() => {
                void dashboard.refetch();
                void alertsQuery.refetch();
                void pricesQuery.refetch();
                void deliveriesQuery.refetch();
                void customersQuery.refetch();
              }}
              title="Refresh dashboard telemetry"
              aria-label="Refresh dashboard"
              className="hero-glass-btn grid h-10 w-10 shrink-0 place-items-center rounded-xl transition"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* 5-Column Executive KPI Row */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5 xl:gap-4">
        <MetricCard
          label="Estimated sales"
          value={formatINR(data.sales.shiftValue)}
          hint={`${data.sales.shiftCount} shifts · ${data.sales.transactions} tx recorded`}
          icon={<Landmark className="h-4 w-4" />}
          tone="success"
        />
        <MetricCard
          label="To be collected"
          badge={
            receivablesNum > 0 ? (
              <span className="inline-flex items-center rounded-full border border-danger/25 bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                {duesOverview.pending.length ? `${duesOverview.pending.length} credit dues` : 'Credit dues'}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-ok/25 bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
                Settled
              </span>
            )
          }
          value={formatINR(data.receivables)}
          hint="Click to inspect customer dues →"
          icon={<Wallet className="h-4 w-4" />}
          tone={receivablesNum > 0 ? 'danger' : 'success'}
          to="/customers"
        />
        <MetricCard
          label="Today's dispensed"
          value={formatLitres(data.sales.shiftLitres)}
          hint="Net volume from nozzle totalizers"
          icon={<Fuel className="h-4 w-4" />}
          tone="warning"
        />
        <MetricCard
          label="Tank book stock"
          value={`${data.stock.length} active`}
          hint={`${formatLitres(totalBookStock)} in underground tanks →`}
          icon={<Database className="h-4 w-4" />}
          tone="accent"
          to="/tanks"
        />
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <MetricCard
            label="Credit accounts"
            value={duesOverview.totalCount ? `${duesOverview.totalCount} active` : formatINR(data.payables)}
            hint={`Supplier payables ${formatINR(data.payables, true)} →`}
            icon={<Users className="h-4 w-4" />}
            tone={payablesNum > 0 ? 'accent' : 'default'}
            to="/suppliers"
          />
        </div>
      </div>

      {/* Current Configured Fuel Rates Ticker */}
      {rates.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-carbon-700/80 bg-carbon-850 px-4 py-3.5 shadow-card sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-fuel/25 bg-fuel/12 text-energy">
                <Tags className="h-4 w-4" aria-hidden />
              </span>
              <span>
                <span className="block text-xs font-bold text-ink-100">Current fuel rates</span>
                <span className="block text-[10.5px] text-ink-500">Live pump board · per litre</span>
              </span>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              {rates.map((rate) => {
                const matchingTank = data.stock.find((t) => t.productName === rate.productName);
                const dotColor = matchingTank?.productColor ?? 'rgb(var(--accent))';
                return (
                  <div
                    key={rate.id}
                    className="rounded-xl border border-carbon-700/70 bg-carbon-800/80 px-3 py-2 sm:inline-flex sm:items-center sm:gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden />
                      <span className="truncate text-[11px] font-semibold text-ink-400">{rate.productName}</span>
                    </span>
                    <span className="num mt-0.5 block pl-4 font-display text-[13px] font-extrabold text-ink-100 sm:mt-0 sm:pl-0">
                      {formatINR(rate.ratePerLitre)}
                    </span>
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

      {/* Quick Operational Workflows */}
      <section className="mb-5" aria-labelledby="quick-actions-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Forecourt Shortcuts</p>
            <h2 id="quick-actions-title" className="font-display text-base font-extrabold tracking-tight text-ink-100">
              Quick actions
            </h2>
          </div>
          <span className="text-[11px] font-medium text-ink-500">Snapshot date: {formatDate(date)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 xl:grid-cols-4">
          {actions.map((action) => (
            <Link key={action.to} to={action.to} className="quick-action group">
              <span
                className={cn(
                  'grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105',
                  action.iconStyle,
                )}
              >
                {action.icon}
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[13.5px] font-bold tracking-tight text-ink-100">
                  {action.label}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">{action.detail}</span>
              </span>
              <ChevronRight
                className="ml-auto h-4 w-4 shrink-0 text-ink-500 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </section>

      {/* Primary Analytics & Tank Storage Telemetry */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.58fr)_minmax(330px,1fr)]">
        <Card className="flex flex-col">
          <CardHeader
            eyebrow="Revenue & Volume Ledger"
            title="Sales performance"
            subtitle="Estimated sales and fuel volume from shift totalizers"
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <div
                  className="flex rounded-xl border border-carbon-700/80 bg-carbon-800/85 p-0.5"
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
                  className="flex rounded-xl border border-carbon-700/80 bg-carbon-800/85 p-0.5"
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
            <div className="mb-4 grid grid-cols-3 gap-2.5 rounded-2xl border border-carbon-700/75 bg-carbon-800/60 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
                  {days}d Revenue
                </p>
                <p className="num mt-0.5 truncate font-display text-sm font-extrabold text-ink-100 sm:text-base">
                  {formatINR(periodStats.totalVal, true)}
                </p>
              </div>
              <div className="min-w-0 border-x border-carbon-700/65 px-2.5">
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">Daily Avg</p>
                <p className="num mt-0.5 truncate font-display text-sm font-extrabold text-ink-100 sm:text-base">
                  {formatINR(periodStats.avgVal, true)}
                </p>
              </div>
              <div className="min-w-0 pl-1">
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
                  {days}d Volume
                </p>
                <p className="num mt-0.5 truncate font-display text-sm font-extrabold text-accent sm:text-base">
                  {formatLitres(periodStats.totalLitres)}
                </p>
              </div>
            </div>

            <div
              className="h-[245px] min-h-[245px] w-full flex-1"
              role="img"
              aria-label={`${days}-day estimated ${chartMetric === 'value' ? 'sales' : 'fuel volume'} chart. ${trend.map((row) => `${row.date}: ${chartMetric === 'value' ? formatINR(row.value) : formatLitres(row.litres)}`).join('; ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={activeStroke} stopOpacity={0.25} />
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
                      boxShadow: '0 14px 34px rgb(0 0 0 / 0.16)',
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
                    strokeWidth={2.6}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2.5, stroke: chart.tooltipBg }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-carbon-700/70 pt-3.5">
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

        {/* Underground Tank Inventory & Capacity Overview */}
        <Card className="flex flex-col">
          <CardHeader
            eyebrow="Storage & Ullage"
            title="Fuel stock levels"
            subtitle="Underground tank ratio & live book stock"
            action={
              <Link
                to="/tanks"
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-carbon-600/80 bg-carbon-900 px-3 text-xs font-bold text-ink-100 shadow-sheen transition hover:border-accent/50 hover:text-accent"
              >
                All Tanks ({data.stock.length})
              </Link>
            }
          />
          <CardBody className="flex flex-1 flex-col gap-3">
            {data.stock.length > 0 && (
              <div className="rounded-2xl border border-carbon-700/80 bg-carbon-800/65 p-3.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-ink-200">Forecourt Capacity Utilization</span>
                  <span className="num rounded-md bg-ok/12 px-2 py-0.5 text-[11px] font-bold text-ok">
                    {overallFillPct}% filled
                  </span>
                </div>
                <MeterBar value={overallFillPct} tone="ok" height="md" className="mt-2.5" />
                <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                  <div>
                    <p className="text-[10.5px] font-medium text-ink-500">Total Book Stock</p>
                    <p className="num mt-0.5 font-display text-sm font-extrabold text-ink-100">
                      {formatLitres(totalBookStock)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10.5px] font-semibold text-accent">Available Ullage</p>
                    <p className="num mt-0.5 font-display text-sm font-extrabold text-accent">
                      {formatLitres(totalUllage)}
                    </p>
                  </div>
                </div>
              </div>
            )}

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
                    className="flex items-center gap-3.5 rounded-2xl border border-carbon-700/75 bg-carbon-900/75 p-3.5 transition hover:border-accent/40"
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
                          opacity: 0.88,
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
                          <span className="rounded border border-carbon-700 bg-carbon-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-400">
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
                        tone={isLow ? 'danger' : isWatch ? 'warn' : 'ok'}
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
          </CardBody>
        </Card>
      </div>

      {/* Executive Procurement Ledger & Customer Dues Overview */}
      {showLedgerRow && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.58fr)_minmax(330px,1fr)]">
          {can('deliveries.read') && (
            <Card className="flex flex-col overflow-hidden">
              <CardHeader
                eyebrow="Procurement Ledger"
                title="Recent fuel deliveries"
                subtitle="Latest inward OMC tanker bills recorded for this outlet"
                action={
                  <div className="flex items-center gap-2">
                    {can('deliveries.write') && (
                      <Link
                        to="/deliveries?new=delivery"
                        className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-carbon-600/80 bg-carbon-900 px-3 text-xs font-bold text-ink-100 shadow-sheen transition hover:border-accent/55 hover:text-accent"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Receive
                      </Link>
                    )}
                    <Link to="/deliveries" className="link text-xs">
                      View All <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                }
              />
              {deliveriesQuery.isLoading ? (
                <LoadingBlock rows={3} />
              ) : recentDeliveries.length === 0 ? (
                <EmptyState
                  title="No deliveries recorded yet"
                  description="Record an inward tanker receipt to track OMC procurement."
                  icon={<Truck className="h-5 w-5" />}
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Supplier / Fuel</th>
                        <th>Bill &amp; Date</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th className="text-right">Bill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDeliveries.slice(0, 5).map((row) => (
                        <tr key={row.id}>
                          <td>
                            <p className="font-display text-xs font-bold uppercase tracking-tight text-ink-100">
                              {row.supplierName}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium uppercase text-ink-500">
                              {row.productName} · {formatNumber(row.quantityLitres, 0)} L
                            </p>
                          </td>
                          <td>
                            <p className="font-mono text-xs font-semibold text-ink-100">{row.invoiceNumber}</p>
                            <p className="num mt-0.5 text-[11px] text-ink-500">{row.invoiceDate}</p>
                          </td>
                          <td>
                            <span className="num font-display text-xs font-extrabold text-ink-100 sm:text-[13px]">
                              {formatINR(row.totalAmount)}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="text-right">
                            <Link
                              to="/deliveries"
                              aria-label={`View delivery ${row.invoiceNumber}`}
                              className="inline-grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition hover:bg-carbon-800 hover:text-accent"
                            >
                              <Eye className="h-4 w-4" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {can('customers.read') && (
            <Card className="flex flex-col">
              <CardHeader
                eyebrow="Receivables & Settlement"
                title="To be collected overview"
                subtitle="Credit headroom ratio & top pending customer accounts"
                action={
                  <Link
                    to="/customers"
                    className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-carbon-600/80 bg-carbon-900 px-3 text-xs font-bold text-ink-100 shadow-sheen transition hover:border-accent/55 hover:text-accent"
                  >
                    All Dues ({duesOverview.pending.length})
                  </Link>
                }
              />
              <CardBody className="flex flex-1 flex-col gap-3.5">
                <div className="rounded-2xl border border-carbon-700/80 bg-carbon-800/65 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-ink-200">Credit Settlement Progress</span>
                    <span className="num rounded-md bg-ok/12 px-2 py-0.5 text-[11px] font-bold text-ok">
                      {duesOverview.settledRatio}% headroom
                    </span>
                  </div>
                  <MeterBar value={duesOverview.settledRatio} tone="ok" height="md" className="mt-2.5" />
                  <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                    <div>
                      <p className="text-[10.5px] font-medium text-ink-500">Sanctioned Credit Limit</p>
                      <p className="num mt-0.5 font-display text-sm font-extrabold text-ink-100">
                        {formatINR(duesOverview.totalLimit)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10.5px] font-semibold text-danger">Outstanding To Be Collected</p>
                      <p className="num mt-0.5 font-display text-sm font-extrabold text-danger">
                        {formatINR(data.receivables)}
                      </p>
                    </div>
                  </div>
                </div>

                {duesOverview.pending.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-5 text-center">
                    <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden />
                    <p className="mt-2 font-display text-xs font-bold text-ink-100">Zero pending credit dues</p>
                    <p className="mt-0.5 text-[11px] text-ink-500">All fleet customer accounts are settled.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-carbon-700/55">
                    {duesOverview.pending.slice(0, 4).map((cust) => (
                      <Link
                        key={cust.id}
                        to="/customers"
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0.5 last:pb-0.5 transition hover:opacity-85"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-display text-xs font-bold uppercase tracking-tight text-ink-100">
                            {cust.name}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-500">
                            {cust.code} · {cust.creditDays}d credit cycle
                          </p>
                        </div>
                        <span className="num shrink-0 font-display text-xs font-extrabold text-danger sm:text-[13px]">
                          {formatINR(cust.balance)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Bottom Executive Operations & Settlement Grid */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {/* Active Shift Console */}
        <Card className="flex flex-col">
          <CardHeader
            eyebrow="Crew & Totalizers"
            title="Forecourt shift status"
            subtitle="Active crew & totalizer capture"
            action={
              <Link to="/shifts" className="link text-xs">
                All shifts →
              </Link>
            }
          />
          <CardBody className="flex flex-1 flex-col justify-between">
            {openShift ? (
              <>
                <div>
                  <div className="hero-mesh flex items-center justify-between gap-2 rounded-2xl border border-carbon-700/75 bg-carbon-800/55 p-3.5">
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
                    Opened{' '}
                    <span className="num font-medium text-ink-200">{formatDateTime(String(openShift.openedAt))}</span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      to="/readings"
                      className="flex items-center gap-2 rounded-xl border border-carbon-700/80 bg-carbon-800/50 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:border-accent/45 hover:bg-carbon-800 hover:text-ink-100"
                    >
                      <Gauge className="h-3.5 w-3.5 text-accent" aria-hidden /> Meter readings
                    </Link>
                    <Link
                      to="/density"
                      className="flex items-center gap-2 rounded-xl border border-carbon-700/80 bg-carbon-800/50 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:border-accent/45 hover:bg-carbon-800 hover:text-ink-100"
                    >
                      <Thermometer className="h-3.5 w-3.5 text-accent" aria-hidden /> Density check
                    </Link>
                  </div>
                </div>
                <Link
                  to="/shifts"
                  className="mt-4 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 text-xs font-bold text-accent transition hover:bg-accent/16"
                >
                  Continue shift &amp; settle <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
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
                <Link to="/shifts?new=shift" className="mt-4">
                  <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>
                    Open shift
                  </Button>
                </Link>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Actionable Attention Center */}
        <Card className="flex flex-col">
          <CardHeader
            eyebrow="Compliance & Telemetry"
            title="Needs attention"
            subtitle="Live operational & licence checks"
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

        {/* Recorded Payment Mix & Dues Position */}
        <Card className="flex flex-col lg:col-span-2 xl:col-span-1">
          <CardHeader
            eyebrow="Payables & Settlement"
            title="Recorded payment mix"
            subtitle="Collections by mode & dues overview"
            action={
              <Link to="/finance" className="link text-xs">
                Finance →
              </Link>
            }
          />
          <CardBody className="flex flex-1 flex-col justify-between gap-4">
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-carbon-700/80 bg-carbon-800/65 p-3.5">
              <div>
                <p className="text-[10.5px] font-medium text-ink-500">Customer Receivables</p>
                <p className="num mt-0.5 font-display text-sm font-extrabold text-ink-100">
                  {formatINR(data.receivables)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10.5px] font-semibold text-danger">Supplier Payables</p>
                <p className="num mt-0.5 font-display text-sm font-extrabold text-danger">
                  {formatINR(data.payables)}
                </p>
              </div>
            </div>

            {paymentTotal > 0 ? (
              <div className="space-y-3.5">
                <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-carbon-800 p-0.5 ring-1 ring-inset ring-carbon-700/65">
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
                        className="flex items-center justify-between rounded-xl border border-carbon-700/60 bg-carbon-900/75 px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center gap-2 font-semibold text-ink-200">
                          <span
                            className={cn('h-2.5 w-2.5 rounded-full', MODE_COLORS[mode] ?? 'bg-accent')}
                            aria-hidden
                          />
                          {MODE_LABELS[mode] ?? mode}
                        </span>
                        <span className="num flex items-center gap-2">
                          <span className="rounded bg-carbon-800 px-1.5 py-0.5 text-[10px] font-bold text-ink-400">
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
              <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-carbon-700 bg-carbon-800/60 text-ink-500">
                  <Droplets className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-2.5 text-xs font-semibold text-ink-300">No transaction-level sales on this date</p>
                <p className="mt-0.5 max-w-xs text-[11px] leading-relaxed text-ink-500">
                  Totalizer shifts capture aggregate volume; mode splits come from settlements &amp; credit slips.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-carbon-700/65 pt-3 text-xs">
              <span className="font-medium text-ink-500">Recorded collections</span>
              <span className="num font-display text-sm font-extrabold text-ink-100">{formatINR(paymentTotal)}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-carbon-700/70 bg-carbon-850/80 px-4 py-3 text-[11px] text-ink-500 shadow-sheen">
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
  badge,
  tone = 'default',
  to,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  to?: string;
}) {
  const card = <StatCard label={label} value={value} hint={hint} icon={icon} badge={badge} tone={tone} />;
  return to ? (
    <Link
      to={to}
      className="block h-full min-w-0 rounded-2xl transition-all duration-200 ease-smooth hover:-translate-y-0.5 [&>.card]:hover:border-accent/45 [&>.card]:hover:shadow-card-hover"
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
      <div className="dashboard-hero relative mb-6 overflow-hidden rounded-2.5xl p-5 text-white sm:p-6">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#f2be58]">
              Multi-Outlet Executive Overview
            </p>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-white sm:text-[28px]">
              Both pumps. One clear picture.
            </h1>
            <p className="mt-1 text-xs text-white/75 sm:text-sm">
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
              className="hero-glass-btn h-9.5 w-auto text-xs text-white [color-scheme:dark]"
            />
            <Button size="sm" onClick={onBack} variant="gold" className="h-9.5">
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
          tone="success"
        />
        <StatCard
          label="Month-to-date sales"
          value={formatINR(data.monthValue)}
          hint="Aggregate closed & flagged shifts"
          icon={<Gauge className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Active outlets"
          value={String(data.stations.length)}
          hint="Independent ledgers, unified owner governance"
          icon={<Store className="h-4 w-4" />}
          tone="accent"
        />
      </div>

      {chartRows.length > 1 && (
        <Card className="mt-5">
          <CardHeader
            eyebrow="Cross-Outlet Benchmark"
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
                eyebrow={`Outlet · ${pump.code}`}
                title={pump.name}
                subtitle={`${formatNumber(share, 0)}% of organization day sales`}
                action={
                  <Badge tone={pump.alerts.length ? 'warning' : 'success'} dot>
                    {pump.alerts.length} alerts
                  </Badge>
                }
              />
              <CardBody className="flex flex-1 flex-col justify-between space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-carbon-700/75 bg-carbon-800/55 p-3.5 sm:grid-cols-3">
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
                          tone={fill < 15 ? 'danger' : fill < 25 ? 'warn' : 'ok'}
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
