import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Legend,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Clock,
  Database,
  Fuel,
  Gauge,
  RadioTower,
  Ruler,
  Tags,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { unclosedShiftMessage, type ShiftAlertsResponse } from '../lib/shifts';
import { useChartPalette } from '../lib/theme';
import { formatDateTime, formatINR, formatLitres, formatNumber, timeAgo, todayIst } from '../lib/format';
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
  PageHeader,
  StatCard,
  StatusBadge,
  TableScrollHint,
} from '../components/ui';

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
  shifts: Record<string, unknown>[];
  openShifts: Record<string, unknown>[];
  flaggedShifts: number;
  stock: {
    id: string; code: string; productName: string; productColor: string; bookStockLitres: string;
    capacityLitres: string; fillPct: string; lastVarianceLitres: string | null;
  }[];
  productSplit: { id: string; name: string; code: string; color: string; shiftLitres: number; shiftValue: number }[];
  devices: { total: number; online: number };
  receivables: string;
  payables: string;
  trend: { date: string; litres: string; value: string; transactionsValue: string }[];
  alerts: { level: 'info' | 'warning' | 'error'; message: string }[];
  recentActivity: { action: string; summary: string; createdAt: string; actorEmail: string | null }[];
  disclaimer: string;
}

interface PriceRow {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  stationId: string | null;
  ratePerLitre: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface StationSummaryRow {
  id: string;
  code: string;
  name: string;
  status: string;
  shiftLitres: string;
  shiftValue: string;
  closedShifts: number;
  openShifts: number;
  flaggedShifts: number;
  transactionLitres: string;
  transactionValue: string;
  transactions: number;
  lowStockTanks: number;
  devicesTotal: number;
  devicesOnline: number;
}

export default function Dashboard() {
  const { can, me } = useAuth();
  const [combined, setCombined] = useState(true);
  const { stations, station, stationId, selectStation } = useStations();
  const [date, setDate] = useState(todayIst());
  const chart = useChartPalette();

  const dashboard = useQuery({
    queryKey: ['dashboard', stationId, date],
    queryFn: () => apiGet<DashboardData>(`/reports/owner-dashboard?stationId=${stationId}&date=${date}`),
    enabled: Boolean(stationId),
    refetchInterval: 60_000,
  });

  // Owners running more than one outlet get a side-by-side view for the same date.
  const summaryQuery = useQuery<{ date: string; stations: StationSummaryRow[] }>({
    queryKey: ['station-summary', date],
    queryFn: () => apiGet(`/reports/station-summary?date=${date}`),
    enabled: stations.length > 1 && can('reports.read'),
    refetchInterval: 60_000,
  });

  const alertsQuery = useQuery({
    queryKey: ['shift-alerts', stationId],
    queryFn: () => apiGet<ShiftAlertsResponse>(`/shifts/alerts?stationId=${stationId}`),
    enabled: Boolean(stationId) && can('shifts.read'),
    refetchInterval: 60_000,
  });

  // Aaj ke rates — wahi rate jo subah price-change ke baad totem par lagta hai.
  const pricesQuery = useQuery<PriceRow[]>({
    queryKey: ['prices', stationId],
    queryFn: () => apiGet<PriceRow[]>(`/catalog/prices?stationId=${stationId}`),
    enabled: Boolean(stationId) && can('products.read'),
    refetchInterval: 60_000,
  });

  const todayRates = useMemo(() => {
    const byProduct = new Map<string, PriceRow>();
    for (const p of pricesQuery.data ?? []) {
      if (p.stationId && p.stationId !== stationId) continue;
      if (!p.effectiveTo && !byProduct.has(p.productId)) byProduct.set(p.productId, p);
    }
    return [...byProduct.values()];
  }, [pricesQuery.data, stationId]);

  const productColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of dashboard.data?.productSplit ?? []) map.set(p.name, p.color);
    for (const t of dashboard.data?.stock ?? []) if (!map.has(t.productName)) map.set(t.productName, t.productColor);
    return map;
  }, [dashboard.data]);

  const chartData = useMemo(
    () =>
      (dashboard.data?.trend ?? []).map((row) => ({
        date: row.date.length > 5 ? row.date.slice(5) : row.date,
        shiftValue: Number(row.value),
        transactionValue: Number(row.transactionsValue),
      })),
    [dashboard.data],
  );

  const pieData = useMemo(
    () =>
      (dashboard.data?.productSplit ?? [])
        .filter((p) => Number(p.shiftLitres) > 0)
        .map((p) => ({ name: p.name, value: Number(p.shiftLitres), color: p.color })),
    [dashboard.data],
  );

  if (me?.user.roleKey === 'OWNER' && stations.length > 1 && combined) {
    return <CombinedDashboard date={date} setDate={setDate} onStation={(id) => { selectStation(id); setCombined(false); }} />;
  }

  if (!stationId) {
    return (
      <>
        <PageHeader title="Station dashboard" />
        <Card>
          <EmptyState
            title="No station assigned"
            description="Your account has no station access yet. Ask your organization owner to assign you to a station."
          />
        </Card>
      </>
    );
  }

  if (dashboard.isLoading) {
    return (
      <>
        <PageHeader title="Station dashboard" description="Loading operational summary…" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><LoadingBlock rows={2} /></Card>
          ))}
        </div>
      </>
    );
  }

  if (dashboard.isError) {
    return (
      <>
        <PageHeader title="Station dashboard" />
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      </>
    );
  }

  const data = dashboard.data!;
  const d = data.sales;
  const openShift = data.openShifts[0] as Record<string, unknown> | undefined;
  const alerts = [
    ...data.alerts,
    ...(alertsQuery.data?.alerts ?? []).map((alert) => ({ level: 'warning' as const, message: unclosedShiftMessage(alert) })),
  ];

  return (
    <>
      <PageHeader
        title="Station dashboard"
        description={`${station?.name ?? data.station.name} · operational snapshot for ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00+05:30`))}`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Business date" />
            <Link to="/tanks">
              <Button variant="outline" size="sm" icon={<Ruler className="h-4 w-4" />}>Record dip</Button>
            </Link>
            <Link to="/reports">
              <Button variant="primary" size="sm" icon={<ArrowUpRight className="h-4 w-4" />}>Open DSR</Button>
            </Link>
          </>
        }
      />

      {me?.user.roleKey === 'OWNER' && stations.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Dashboard pump view">
          <Button size="sm" variant="outline" onClick={() => setCombined(true)}>Dono Pump</Button>
          {stations.map((item, index) => <Button key={item.id} size="sm" variant={item.id === stationId ? 'primary' : 'outline'} onClick={() => selectStation(item.id)}>Pump {index + 1}</Button>)}
        </div>
      )}

      {todayRates.length > 0 && (
        <div className="card mb-3 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
              <span className="brand-gradient grid h-7 w-7 place-items-center rounded-lg text-onaccent">
                <Tags className="h-3.5 w-3.5" />
              </span>
              Aaj ke rates
            </span>
            {todayRates.map((rate) => (
              <span key={rate.id} className="flex items-baseline gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: productColors.get(rate.productName) ?? '#f97316' }}
                  aria-hidden
                />
                <span className="text-xs font-medium text-ink-400">{rate.productName}</span>
                <span className="num font-display text-base font-bold text-ink-100">{formatINR(rate.ratePerLitre)}<span className="text-[10px] font-medium text-ink-500">/L</span></span>
              </span>
            ))}
            <Link to="/products" className="link ml-auto hidden text-xs font-medium sm:inline">
              Price change →
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aggregate estimated sales"
          value={formatINR(d.shiftValue, true)}
          hint={`${formatLitres(d.shiftLitres)} from ${d.shiftCount} closed shift${d.shiftCount === 1 ? '' : 's'} · totalizer estimate`}
          icon={<Fuel className="h-4 w-4" />}
          tone="accent"
        />
        <StatCard
          label="Recorded transactions"
          value={formatINR(d.transactionValue, true)}
          hint={`${d.transactions} transaction${d.transactions === 1 ? '' : 's'} · ${formatLitres(d.transactionLitres)}`}
          icon={<Banknote className="h-4 w-4" />}
        />
        <StatCard
          label="Receivables"
          value={formatINR(data.receivables, true)}
          hint="Outstanding customer credit across the organization"
          icon={<Users className="h-4 w-4" />}
          tone={Number(data.receivables) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Supplier payables"
          value={formatINR(data.payables, true)}
          hint="Organization-wide received purchases less recorded payouts"
          icon={<Truck className="h-4 w-4" />}
        />
      </div>

      {stations.length > 1 && summaryQuery.data && (
        <Card className="mt-3">
          <CardHeader
            title="Your pumps today"
            subtitle={`Side-by-side totals for all ${stations.length} outlets on this business date`}
            action={<Badge tone="accent">{summaryQuery.data.stations.length} outlets</Badge>}
          />
          <TableScrollHint />
          <div className="table-wrap">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th className="text-right">Shift litres</th>
                  <th className="text-right">Est. value</th>
                  <th className="text-right">Recorded sales</th>
                  <th className="text-right">Shifts</th>
                  <th>Attention</th>
                  <th>Gateway</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summaryQuery.data.stations.map((row) => {
                  const active = row.id === stationId;
                  return (
                    <tr key={row.id} className={active ? 'bg-accent/[0.06]' : undefined}>
                      <td>
                        <p className="font-medium text-ink-100">{row.name}</p>
                        <p className="text-[10px] text-ink-500">{row.code}</p>
                      </td>
                      <td className="num whitespace-nowrap text-right">{formatNumber(row.shiftLitres, 3)} L</td>
                      <td className="num whitespace-nowrap text-right">{formatINR(row.shiftValue, true)}</td>
                      <td className="num whitespace-nowrap text-right">
                        {formatINR(row.transactionValue, true)}
                        <span className="block text-[10px] text-ink-500">{row.transactions} txn</span>
                      </td>
                      <td className="text-right text-xs text-ink-300">
                        {row.closedShifts} closed
                        {row.openShifts > 0 && <span className="block text-ok">{row.openShifts} open</span>}
                      </td>
                      <td>
                        {row.flaggedShifts > 0 || row.lowStockTanks > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {row.flaggedShifts > 0 && <Badge tone="warning">{row.flaggedShifts} flagged</Badge>}
                            {row.lowStockTanks > 0 && <Badge tone="danger">{row.lowStockTanks} low stock</Badge>}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-500">—</span>
                        )}
                      </td>
                      <td className="text-xs text-ink-300">
                        {row.devicesTotal === 0 ? <span className="text-ink-500">none</span> : `${row.devicesOnline}/${row.devicesTotal} online`}
                      </td>
                      <td className="text-right">
                        {active ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => selectStation(row.id)}
                          >
                            Open
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="14-day sales trend"
            subtitle="Totalizer aggregate value vs transaction-level recorded value"
            action={<Badge tone="accent">INR</Badge>}
          />
          <CardBody className="h-[260px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="shiftFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.accent} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.teal} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={chart.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: chart.axis }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis tick={{ fontSize: 10, fill: chart.axis }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{
                    background: chart.tooltipBg,
                    border: `1px solid ${chart.tooltipBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: chart.tooltipLabel }}
                  formatter={(value: number, name: string) => [formatINR(value), name === 'shiftValue' ? 'Totalizer estimate' : 'Recorded sales']}
                />
                <Area type="monotone" dataKey="shiftValue" stroke={chart.accent} fill="url(#shiftFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="transactionValue" stroke={chart.teal} fill="url(#txFill)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Product mix" subtitle="Litres by fuel grade (closed shifts)" />
          <CardBody className="h-[260px]">
            {pieData.length === 0 ? (
              <EmptyState title="No closed-shift volume" description="Close a shift to see the fuel grade mix." icon={<Fuel className="h-4 w-4" />} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={3} stroke="none">
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: chart.tooltipBg,
                      border: `1px solid ${chart.tooltipBorder}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string) => [formatLitres(value), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {pieData.map((p) => (
                <span key={p.name} className="flex items-center gap-1.5 text-[11px] text-ink-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.name}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Live shift"
            subtitle="Current open shift and nozzle activity"
            action={
              <Link to="/shifts">
                <Button size="sm" variant="ghost" icon={<Clock className="h-3.5 w-3.5" />}>Manage shifts</Button>
              </Link>
            }
          />
          {openShift ? (
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink-100">Shift #{String(openShift.shiftNumber)} · {String(openShift.businessDate)}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Opened {formatDateTime(String(openShift.openedAt))} by {String(openShift.operatorName ?? openShift.openedByName ?? '—')}
                  </p>
                </div>
                <StatusBadge status="OPEN" />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">Opening cash</p>
                  <p className="num mt-0.5 text-sm text-ink-100">{formatINR(String(openShift.openingCash))}</p>
                </div>
                <div className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">Devices online</p>
                  <p className="num mt-0.5 text-sm text-ink-100">{data.devices.online} / {data.devices.total}</p>
                </div>
                <div className="rounded-lg border border-navy-700/60 bg-navy-800/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">Flagged shifts</p>
                  <p className="num mt-0.5 text-sm text-ink-100">{data.flaggedShifts}</p>
                </div>
              </div>
              <p className="text-[11px] text-ink-500">
                Shift litres become an aggregate estimated sale only when the shift is closed with comparable opening and
                closing totalizers.
              </p>
            </CardBody>
          ) : (
            <EmptyState
              title="No shift is open"
              description="Open a shift to start capturing nozzle totalizers for this station."
              action={<Link to="/shifts"><Button size="sm" variant="primary">Open a shift</Button></Link>}
              icon={<Clock className="h-4 w-4" />}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Alerts & warnings" subtitle="Operational items needing attention" />
          <CardBody className="max-h-[320px] space-y-2 overflow-y-auto scroll-thin">
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-500">No active alerts.</p>
            ) : (
              alerts.map((alert, index) => (
                <div
                  key={`${alert.message}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-navy-700/60 bg-navy-800/30 px-2.5 py-2"
                >
                  <AlertTriangle
                    className={
                      alert.level === 'error'
                        ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-danger'
                        : alert.level === 'warning'
                          ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-warn'
                          : 'mt-0.5 h-3.5 w-3.5 shrink-0 text-info'
                    }
                  />
                  <p className="text-[11px] leading-relaxed text-ink-300">{alert.message}</p>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Tank stock"
            subtitle="Book stock derived from the movement ledger (not totalizer readings)"
            action={<Link to="/tanks"><Button size="sm" variant="ghost">Manage</Button></Link>}
          />
          <CardBody>
            {data.stock.length === 0 ? (
              <EmptyState title="No tanks configured" description="Add tanks to start tracking stock." icon={<Database className="h-4 w-4" />} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.stock.map((tank) => {
                  const pct = Math.min(100, Math.max(0, Number(tank.fillPct)));
                  const low = pct < 20;
                  const variance = tank.lastVarianceLitres ? Number(tank.lastVarianceLitres) : null;
                  return (
                    <div key={tank.id} className="flex gap-3.5 rounded-2xl border border-navy-700/50 bg-navy-800/30 p-3.5">
                      {/* Underground tank gauge — jitna bhara, utna rang */}
                      <div
                        className="relative h-[104px] w-14 shrink-0 overflow-hidden rounded-b-[22px] rounded-t-lg border border-navy-600/70 bg-navy-900/70"
                        role="img"
                        aria-label={`${tank.code} ${formatNumber(tank.fillPct, 0)} percent full`}
                      >
                        <div
                          className="absolute inset-x-0 bottom-0 transition-[height] duration-500"
                          style={{
                            height: `${pct}%`,
                            background: `linear-gradient(180deg, ${tank.productColor}cc, ${tank.productColor}88)`,
                          }}
                        />
                        <span className="num absolute inset-0 grid place-items-center text-[11px] font-bold text-ink-100 [text-shadow:0_1px_6px_rgb(0_0_0/0.7)]">
                          {formatNumber(tank.fillPct, 0)}%
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display text-sm font-bold text-ink-100">{tank.code}</p>
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
                            <span className="h-2 w-2 rounded-full" style={{ background: tank.productColor }} />
                            {tank.productName}
                          </span>
                          {low && <Badge tone="danger" dot>Low stock</Badge>}
                        </div>
                        <p className="num mt-1.5 font-display text-xl font-bold leading-none text-ink-100">
                          {formatLitres(tank.bookStockLitres)}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-500">
                          Capacity {formatLitres(tank.capacityLitres)} · ullage {formatLitres(Math.max(0, Number(tank.capacityLitres) - Number(tank.bookStockLitres)))}
                        </p>
                        <p className="mt-1.5 text-[11px]">
                          {variance !== null ? (
                            <span className={variance < -50 ? 'font-medium text-danger' : 'text-ink-400'}>
                              Last dip variance {variance > 0 ? '+' : ''}{formatNumber(variance, 1)} L
                            </span>
                          ) : (
                            <span className="text-ink-600">No dip recorded yet</span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Audit trail (latest entries)" action={<Link to="/audit" className="link text-xs">View all</Link>} />
          <CardBody className="space-y-3">
            {data.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-500">No recorded activity.</p>
            ) : (
              data.recentActivity.slice(0, 7).map((entry, index) => (
                <div key={index} className="flex gap-2.5">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink-300">{entry.summary}</p>
                    <p className="mt-0.5 text-[10px] text-ink-600">
                      {entry.actorEmail ?? 'system'} · {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Recorded payment mix', value: Object.entries(d.byMode).map(([mode, amount]) => `${mode} ${formatINR(amount, true)}`).join(' · ') || 'No recorded transactions', icon: <Wallet className="h-4 w-4" /> },
          { label: 'Hardware gateways', value: `${data.devices.online} online of ${data.devices.total} registered`, icon: <RadioTower className="h-4 w-4" /> },
          { label: 'Stock ledger', value: `${data.stock.length} tanks tracked`, icon: <Database className="h-4 w-4" /> },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3">
            <div className="rounded-md bg-navy-800 p-2 text-accent">{item.icon}</div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-ink-500">{item.label}</p>
              <p className="truncate text-xs text-ink-300">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
        <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {data.disclaimer}
      </p>
    </>
  );
}

interface CombinedStation {
  id: string; name: string; code: string; litres: string; value: string; monthValue: string;
  shortExcess: string | null;
  tanks: DashboardData['stock'];
  alerts: DashboardData['alerts'];
  trend: { date: string; value: string }[];
  products: { name: string; color: string; litres: string }[];
}
interface CombinedData { date: string; stations: CombinedStation[]; totalValue: string; totalLitres: string; monthValue: string }

function CombinedDashboard({ date, setDate, onStation }: { date: string; setDate: (date: string) => void; onStation: (id: string) => void }) {
  const chart = useChartPalette();
  const result = useQuery<CombinedData>({ queryKey: ['combined-dashboard', date], queryFn: () => apiGet(`/reports/combined-dashboard?date=${date}`), refetchInterval: 60_000 });
  if (result.isLoading) return <LoadingBlock rows={6} />;
  if (result.isError || !result.data) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  const data = result.data;
  const series = data.stations[0]?.trend.map((day, index) => ({ date: day.date.slice(5), ...Object.fromEntries(data.stations.map((station) => [station.id, Number(station.trend[index]?.value ?? 0)])) })) ?? [];
  const products = new Map<string, { name: string; value: number; color: string }>();
  for (const station of data.stations) for (const p of station.products) {
    const old = products.get(p.name); products.set(p.name, { name: p.name, color: p.color, value: (old?.value ?? 0) + Number(p.litres) });
  }
  const pie = [...products.values()].filter((p) => p.value > 0);
  const alerts = data.stations.flatMap((s) => s.alerts.map((a) => ({ ...a, station: s.name })));
  const colors = ['#f97316', '#38bdf8', '#a78bfa', '#34d399'];
  return <>
    <PageHeader title="Dono Pump · Owner overview" description="Dono stations ka ek saath hisaab — closed shifts ki estimated sales" actions={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Business date" />} />
    <div className="mb-5 flex flex-wrap gap-2" aria-label="Dashboard pump view">
      <Button size="sm" variant="primary">Dono Pump</Button>
      {data.stations.map((s, i) => <Button key={s.id} size="sm" variant="outline" onClick={() => onStation(s.id)}>Pump {i + 1}</Button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard label="Aaj ki kul bikri" value={formatINR(data.totalValue)} hint={`${formatLitres(data.totalLitres)} · closed shifts`} tone="accent" icon={<Fuel className="h-4 w-4" />} />
      <StatCard label="Is mahine ki bikri" value={formatINR(data.monthValue)} hint="Month start se selected date tak" icon={<Banknote className="h-4 w-4" />} />
      <StatCard label="Tank & licence alerts" value={String(alerts.length)} hint="Dono pumps · stock aur compliance" tone={alerts.length ? 'warning' : 'default'} icon={<AlertTriangle className="h-4 w-4" />} />
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {data.stations.map((s, i) => <Card key={s.id} className="overflow-hidden">
        <div className="border-b border-navy-700/60 p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Pump {i + 1} · {s.code}</p><h2 className="mt-1 font-display text-lg font-bold text-ink-100">{s.name}</h2></div><Badge tone={s.alerts.length ? 'warning' : 'success'}>{s.alerts.length} alerts</Badge></div>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3"><div><p className="text-xs text-ink-500">Aaj ki bikri</p><p className="num font-display text-2xl font-bold text-ink-100">{formatINR(s.value)}</p><p className="text-xs text-ink-400">{formatLitres(s.litres)}</p></div><div><p className="text-xs text-ink-500">Cash short / excess</p><p className={`num mt-1 text-lg font-semibold ${s.shortExcess === null ? 'text-ink-500' : Number(s.shortExcess) < 0 ? 'text-danger' : 'text-ok'}`}>{s.shortExcess === null ? 'Not settled' : formatINR(s.shortExcess)}</p></div></div>
        </div>
        <div className="space-y-3 p-5"><p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Tank levels · book stock</p>{s.tanks.length === 0 ? <p className="text-xs text-ink-500">Tank jodo aur stock entry karo.</p> : s.tanks.map((tank) => <div key={tank.id}><div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-ink-300">{tank.code} · {tank.productName}</span><span className="num text-ink-400">{formatLitres(tank.bookStockLitres)} / {formatLitres(tank.capacityLitres)}</span></div><div className="h-2 overflow-hidden rounded-full bg-navy-700"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, Number(tank.fillPct)))}%`, background: tank.productColor }} /></div></div>)}</div>
      </Card>)}
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]"><Card><CardHeader title="7-din sales trend" subtitle="Closed shift value · pump-wise" /><div className="h-64 px-2 pb-4"><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><CartesianGrid stroke={chart.grid} strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: chart.axis, fontSize: 11 }} /><YAxis tick={{ fill: chart.axis, fontSize: 11 }} width={65} /><Tooltip /><Legend />{data.stations.map((s, i) => <Line key={s.id} name={s.name} dataKey={s.id} stroke={colors[i % colors.length]} strokeWidth={2.5} dot={false} />)}</LineChart></ResponsiveContainer></div></Card>
      <Card><CardHeader title="Product-wise bikri" subtitle="Litres · selected date" />{pie.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80}>{pie.map((p) => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <EmptyState title="Abhi bikri nahi" description="Shift close hone par product-wise bikri yahan dikhegi." />}</Card></div>
    <Card className="mt-4"><CardHeader title="Dono pumps ke alerts" subtitle="Tank levels aur licence expiry" /><div className="space-y-2 p-4">{alerts.length ? alerts.map((alert, i) => <div key={i} className="rounded-xl border border-navy-700 bg-navy-850 p-3 text-sm text-ink-300"><span className="font-semibold text-ink-100">{alert.station}</span> · {alert.message}</div>) : <EmptyState title="Sab theek hai" description="Filhaal tank ya licence ka koi alert nahi." />}</div></Card>
    <p className="mt-4 text-xs text-ink-500">Sales estimated from closed and flagged shift totalizers; not audited revenue. Tank levels are current book stock.</p>
  </>;
}
