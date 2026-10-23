import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
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
  productSplit: { id: string; name: string; code: string; color: string; shift_litres: number; shift_value: number }[];
  devices: { total: number; online: number };
  receivables: string;
  payables: string;
  trend: { date: string; litres: string; value: string; transactionsValue: string }[];
  alerts: { level: 'info' | 'warning' | 'error'; message: string }[];
  recentActivity: { action: string; summary: string; created_at: string; actor_email: string }[];
  disclaimer: string;
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

interface ShiftAlert {
  type: string;
  severity: string;
  message: string;
  shiftId?: string;
  stationId?: string;
}

export default function Dashboard() {
  const { can } = useAuth();
  const { stations, station, stationId, selectStation } = useStations();
  const [date, setDate] = useState(todayIst());

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
    queryFn: () => apiGet<ShiftAlert[]>(`/shifts/alerts?stationId=${stationId}`),
    enabled: Boolean(stationId) && can('shifts.read'),
    refetchInterval: 60_000,
  });

  const chartData = useMemo(
    () =>
      (dashboard.data?.trend ?? []).map((row) => ({
        date: row.date.slice(5),
        shiftValue: Number(row.value),
        transactionValue: Number(row.transactionsValue),
      })),
    [dashboard.data],
  );

  const pieData = useMemo(
    () =>
      (dashboard.data?.productSplit ?? [])
        .filter((p) => Number(p.shift_litres) > 0)
        .map((p) => ({ name: p.name, value: Number(p.shift_litres), color: p.color })),
    [dashboard.data],
  );

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
  const alerts = [...data.alerts, ...(alertsQuery.data ?? []).map((a) => ({ level: (a.severity as 'warning') ?? 'warning', message: a.message }))];

  return (
    <>
      <PageHeader
        title="Station dashboard"
        description={`${station?.name ?? data.station.name} · operational snapshot for ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00+05:30`))}`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Business date" />
            <Link to="/reports">
              <Button variant="primary" size="sm" icon={<ArrowUpRight className="h-4 w-4" />}>Open DSR</Button>
            </Link>
          </>
        }
      />

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
            action={
              <Badge tone="accent">
                {summaryQuery.data.stations.filter((row) => row.id === stationId).length > 0 ? 'Multi-outlet' : 'Consolidated'}
              </Badge>
            }
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
                        {row.openShifts > 0 && <span className="block text-emerald-300">{row.openShifts} open</span>}
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
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1b2d4d" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#6b81a3' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis tick={{ fontSize: 10, fill: '#6b81a3' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#0d1628', border: '1px solid #27405f', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#b3c5df' }}
                  formatter={(value: number, name: string) => [formatINR(value), name === 'shiftValue' ? 'Totalizer estimate' : 'Recorded sales']}
                />
                <Area type="monotone" dataKey="shiftValue" stroke="#38bdf8" fill="url(#shiftFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="transactionValue" stroke="#2dd4bf" fill="url(#txFill)" strokeWidth={1.5} />
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
                    contentStyle={{ background: '#0d1628', border: '1px solid #27405f', borderRadius: 8, fontSize: 12 }}
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
                        ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400'
                        : alert.level === 'warning'
                          ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400'
                          : 'mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400'
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
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tank</th>
                  <th>Product</th>
                  <th className="text-right">Book stock</th>
                  <th className="text-right">Capacity</th>
                  <th>Fill</th>
                  <th>Dip variance</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.map((tank) => (
                  <tr key={tank.id}>
                    <td className="font-medium text-ink-100">{tank.code}</td>
                    <td>
                      <span className="flex items-center gap-1.5 text-xs text-ink-300">
                        <span className="h-2 w-2 rounded-full" style={{ background: tank.productColor }} />
                        {tank.productName}
                      </span>
                    </td>
                    <td className="num text-right">{formatLitres(tank.bookStockLitres)}</td>
                    <td className="num text-right text-ink-500">{formatLitres(tank.capacityLitres)}</td>
                    <td className="w-32">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-navy-700">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${Math.min(100, Math.max(0, Number(tank.fillPct)))}%` }}
                          />
                        </div>
                        <span className="num text-[10px] text-ink-500">{formatNumber(tank.fillPct, 0)}%</span>
                      </div>
                    </td>
                    <td>
                      {tank.lastVarianceLitres ? (
                        <span className={Number(tank.lastVarianceLitres) < -50 ? 'text-rose-300' : 'text-ink-300'}>
                          {formatNumber(tank.lastVarianceLitres, 1)} L
                        </span>
                      ) : (
                        <span className="text-ink-600">no dip</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                      {entry.actor_email ?? 'system'} · {timeAgo(entry.created_at)}
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
