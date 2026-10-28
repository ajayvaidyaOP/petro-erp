import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Banknote, CheckCircle2, ChevronRight,
  Clock3, Droplets, Fuel, Gauge, IndianRupee, ListChecks, Plus, Store, Truck, Users, Wallet,
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { unclosedShiftMessage, type ShiftAlertsResponse } from '../lib/shifts';
import { useChartPalette } from '../lib/theme';
import { formatDate, formatDateTime, formatINR, formatLitres, formatNumber, todayIst } from '../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, LoadingBlock, StatusBadge } from '../components/ui';

interface DashboardData {
  station: { id: string; name: string; code: string };
  date: string;
  sales: { shiftLitres: string; shiftValue: string; transactionLitres: string; transactionValue: string; byMode: Record<string, string>; transactions: number; shiftCount: number };
  openShifts: Record<string, unknown>[];
  flaggedShifts: number;
  stock: { id: string; code: string; productName: string; productColor: string; bookStockLitres: string; capacityLitres: string; fillPct: string; lastVarianceLitres: string | null }[];
  receivables: string;
  payables: string;
  trend: { date: string; litres: string; value: string; transactionsValue: string }[];
  alerts: { level: 'info' | 'warning' | 'error'; message: string }[];
  disclaimer: string;
}
interface PriceRow { id: string; productId: string; productName: string; stationId: string | null; ratePerLitre: string; effectiveTo: string | null }

export default function Dashboard() {
  const { me, can } = useAuth();
  const { stations, station, stationId } = useStations();
  const [date, setDate] = useState(todayIst());
  const [days, setDays] = useState(7);
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
    for (const price of pricesQuery.data ?? []) if (!price.effectiveTo && (!price.stationId || price.stationId === stationId) && !found.has(price.productId)) found.set(price.productId, price);
    return [...found.values()];
  }, [pricesQuery.data, stationId]);
  const trend = useMemo(() => (dashboard.data?.trend ?? []).slice(-days).map((row) => ({ date: row.date.slice(5), value: Number(row.value) })), [dashboard.data, days]);

  if (compare && me?.user.roleKey === 'OWNER') return <CombinedDashboard date={date} setDate={setDate} onBack={() => setCompare(false)} />;
  if (!stationId) return <Card><EmptyState title="No pump assigned" description="Ask the owner to assign your manager account to a pump." icon={<Store />} /></Card>;
  if (dashboard.isLoading) return <div className="space-y-5"><LoadingBlock rows={2} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((n) => <Card key={n}><LoadingBlock rows={2} /></Card>)}</div><Card><LoadingBlock rows={6} /></Card></div>;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data!;
  const openShift = data.openShifts[0];
  const lowStock = data.stock.filter((tank) => Number(tank.fillPct) < 15);
  const alerts = [...data.alerts, ...(alertsQuery.data?.alerts ?? []).map((alert) => ({ level: 'warning' as const, message: unclosedShiftMessage(alert) }))];
  const firstName = me?.user.name.split(' ')[0] ?? '';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const paymentTotal = Object.values(data.sales.byMode).reduce((sum, amount) => sum + Number(amount), 0);
  const actions = [
    { to: openShift ? '/shifts' : '/shifts?new=shift', label: openShift ? 'Manage shift' : 'Open a shift', detail: 'Readings & settlement', icon: <ListChecks className="h-5 w-5" /> },
    { to: '/deliveries?new=delivery', label: 'Record delivery', detail: 'Receive fuel stock', icon: <Truck className="h-5 w-5" /> },
    { to: '/finance?new=expense', label: 'Add expense', detail: 'Keep cash in check', icon: <Wallet className="h-5 w-5" /> },
    { to: '/customers', label: 'Customer credit', detail: 'Udhaar & receipts', icon: <Users className="h-5 w-5" /> },
  ];

  return <>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-xs font-medium text-ink-500">{formatDate(date)} <span className="mx-1.5 text-navy-600">/</span> {station?.name ?? data.station.name}</p><h1 className="font-display text-[27px] font-extrabold tracking-tight text-ink-100 sm:text-[32px]">{greeting}, {firstName}<span className="text-accent">.</span></h1><p className="mt-2 text-sm text-ink-400">Your pump’s day, without the paperwork.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Input type="date" aria-label="Business date" value={date} max={todayIst()} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} className="w-auto" /><Link to={openShift ? '/shifts' : '/shifts?new=shift'}><Button variant="primary" icon={openShift ? <ArrowUpRight className="h-4 w-4" /> : <Plus className="h-4 w-4" />}>{openShift ? 'Manage shift' : 'Open shift'}</Button></Link></div>
    </div>

    {me?.user.roleKey === 'OWNER' && stations.length > 1 && <div className="mb-5 flex justify-end"><Button size="sm" variant="outline" onClick={() => setCompare(true)} icon={<Store className="h-3.5 w-3.5" />}>Compare both pumps</Button></div>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="relative overflow-hidden rounded-2xl bg-[#123e30] p-5 text-white shadow-card">
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full border-[22px] border-white/[0.035]" aria-hidden />
        <div className="relative flex items-center justify-between"><p className="text-xs font-medium text-white/70">Estimated sales</p><span className="rounded-lg bg-white/10 p-2"><IndianRupee className="h-4 w-4" /></span></div>
        <p className="num relative mt-4 font-display text-[30px] font-bold tracking-tight">{formatINR(data.sales.shiftValue)}</p><p className="relative mt-2 text-[11px] text-white/65">{data.sales.shiftCount} closed shifts · selected date</p>
      </div>
      <Metric label="Fuel dispensed" value={formatLitres(data.sales.shiftLitres)} hint="From closed-shift totalizers" icon={<Fuel className="h-[18px] w-[18px]" />} />
      <Metric label="Customer receivables" value={formatINR(data.receivables)} hint="Outstanding across your organization" icon={<Users className="h-[18px] w-[18px]" />} to="/customers" />
      <Metric label="Open shifts" value={String(data.openShifts.length).padStart(2, '0')} hint={data.flaggedShifts ? `${data.flaggedShifts} flagged shifts need review` : openShift ? 'Ready for readings and settlement' : 'No shift currently running'} icon={<Clock3 className="h-[18px] w-[18px]" />} to="/shifts" />
    </div>

    <section className="mt-7" aria-labelledby="quick-actions-title"><div className="mb-3 flex items-center justify-between"><h2 id="quick-actions-title" className="text-sm font-bold text-ink-100">Quick actions</h2><span className="text-[11px] text-ink-500">Your everyday essentials</span></div><div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">{actions.map((action) => <Link key={action.to} to={action.to} className="quick-action group"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/[0.08] text-accent">{action.icon}</span><span className="min-w-0"><span className="block text-xs font-semibold text-ink-100">{action.label}</span><span className="mt-1 block text-[11px] text-ink-500">{action.detail}</span></span><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-accent" /></Link>)}</div></section>

    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
      <Card>
        <CardHeader title="Sales overview" subtitle="Estimated value from closed and flagged shifts" action={<div className="flex rounded-lg bg-navy-800 p-0.5" aria-label="Chart period">{[7, 14].map((value) => <button key={value} onClick={() => setDays(value)} aria-pressed={days === value} className={`min-h-8 rounded-md px-3 text-[11px] font-semibold ${days === value ? 'bg-navy-900 text-accent shadow-sm' : 'text-ink-500'}`}>{value} days</button>)}</div>} />
        <CardBody className="pt-5"><div className="mb-3 flex items-center gap-2 text-[11px] text-ink-500"><span className="h-2 w-2 rounded-full bg-accent" />Estimated sales <span className="ml-auto">INR</span></div><div className="h-[235px] w-full" role="img" aria-label={`${days}-day estimated sales chart. ${trend.map((row) => `${row.date}: ${formatINR(row.value)}`).join('; ')}`}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 10, right: 6, bottom: 0, left: -14 }}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chart.accent} stopOpacity={0.18} /><stop offset="100%" stopColor={chart.accent} stopOpacity={0.01} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" stroke={chart.grid} vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10, fill: chart.axis }} axisLine={false} tickLine={false} minTickGap={20} dy={8} /><YAxis tick={{ fontSize: 10, fill: chart.axis }} axisLine={false} tickLine={false} tickFormatter={(value) => `₹${Number(value) >= 100000 ? `${(value / 100000).toFixed(1)}L` : `${Math.round(value / 1000)}k`}`} /><Tooltip contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, boxShadow: '0 8px 24px #00000010' }} labelStyle={{ color: chart.tooltipLabel }} formatter={(value: number) => [formatINR(value), 'Estimated sales']} /><Area type="monotone" dataKey="value" stroke={chart.accent} fill="url(#salesFill)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 3, stroke: chart.tooltipBg }} /></AreaChart></ResponsiveContainer>
        </div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-navy-700/50 pt-4"><span className="text-xs text-ink-500">Recorded transactions <strong className="ml-1 font-semibold text-ink-200">{formatINR(data.sales.transactionValue)}</strong></span><Link to="/reports" className="flex min-h-8 items-center gap-1 text-xs font-semibold text-accent">View DSR <ArrowUpRight className="h-3.5 w-3.5" /></Link></div></CardBody>
      </Card>

      <Card><CardHeader title="Fuel at a glance" subtitle="Current book stock & today’s prices" action={<Link to="/tanks" className="link text-xs">Details</Link>} /><CardBody className="space-y-5">{data.stock.length === 0 ? <EmptyState title="No tanks yet" description="Add a tank in Settings to start tracking stock." /> : data.stock.map((tank) => {
        const fill = Math.max(0, Math.min(100, Number(tank.fillPct)));
        return <div key={tank.id}><div className="mb-2 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Droplets className="h-3.5 w-3.5" /></span><span className="truncate text-xs font-semibold text-ink-200">{tank.productName}</span><span className="text-[10px] text-ink-500">{tank.code}</span></div><span className={`text-[10px] font-semibold ${fill < 15 ? 'text-warn' : 'text-ok'}`}>{fill < 15 ? 'Low stock' : 'Healthy'}</span></div><div className="h-2 overflow-hidden rounded-full bg-navy-800" role="meter" aria-label={`${tank.productName} tank fill`} aria-valuenow={fill} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${fill < 15 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${fill}%` }} /></div><div className="mt-1.5 flex justify-between text-[10px] text-ink-500"><span><strong className="font-semibold text-ink-300">{formatLitres(tank.bookStockLitres)}</strong> of {formatLitres(tank.capacityLitres)}</span><span>{formatNumber(fill, 0)}%</span></div></div>;
      })}{rates.length > 0 && <div className="border-t border-navy-700/60 pt-4"><div className="mb-3 flex justify-between"><p className="eyebrow">Today’s rates</p><Link to="/products" className="text-[10px] font-semibold text-accent">{can('prices.write') ? 'Update prices' : 'View prices'}</Link></div><div className="flex flex-wrap gap-x-5 gap-y-2">{rates.map((rate) => <div key={rate.id}><p className="text-[10px] text-ink-500">{rate.productName}</p><p className="num mt-0.5 text-sm font-bold text-ink-100">{formatINR(rate.ratePerLitre)}<span className="text-[10px] font-normal text-ink-500"> /L</span></p></div>)}</div></div>}</CardBody></Card>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr]">
      <Card><CardHeader title="Shift status" action={<Link to="/shifts" className="link text-xs">View shifts</Link>} /><CardBody>{openShift ? <><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold text-ink-100"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent"><ListChecks className="h-4 w-4" /></span>Shift #{String(openShift.shiftNumber)}</span><StatusBadge status="OPEN" /></div><p className="mt-3 text-xs text-ink-500">Opened {formatDateTime(String(openShift.openedAt))}</p><p className="mt-1 text-xs text-ink-400">By {String(openShift.operatorName ?? openShift.openedByName ?? '—')}</p><Link to="/shifts" className="mt-4 flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent/10 text-xs font-semibold text-accent">Continue shift <ArrowRight className="h-3.5 w-3.5" /></Link></> : <div className="py-4 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-accent" /><p className="mt-3 text-sm font-semibold text-ink-100">No open shift</p><p className="mt-1 text-xs text-ink-500">Start a shift when the next crew is ready.</p></div>}</CardBody></Card>
      <Card><CardHeader title="Needs attention" action={<Badge tone={alerts.length ? 'warning' : 'success'}>{alerts.length ? `${alerts.length} alerts` : 'All clear'}</Badge>} /><CardBody className="max-h-64 space-y-3 overflow-y-auto scroll-thin">{alerts.length ? alerts.map((alert, index) => <div key={index} className="flex items-start gap-2.5 rounded-lg bg-warn/[0.055] p-2.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /><p className="text-xs leading-relaxed text-ink-300">{alert.message}</p></div>) : <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-accent" /><p className="mt-3 text-xs text-ink-400">Nothing needs your attention right now.</p></div>}</CardBody></Card>
      <Card className="lg:col-span-2 xl:col-span-1"><CardHeader title="Recorded payment mix" subtitle="Transactions, not totalizer estimates" /><CardBody className="space-y-3">{paymentTotal > 0 ? Object.entries(data.sales.byMode).filter(([, amount]) => Number(amount) > 0).map(([mode, amount]) => <div key={mode}><div className="mb-1.5 flex justify-between text-xs"><span className="text-ink-400">{mode === 'UPI' ? 'UPI' : mode.charAt(0) + mode.slice(1).toLowerCase()}</span><span className="num font-semibold text-ink-200">{formatINR(amount)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-navy-800"><div className="h-full rounded-full bg-accent/65" style={{ width: `${Number(amount) / paymentTotal * 100}%` }} /></div></div>) : <p className="py-6 text-center text-xs text-ink-500">No transactions recorded for this date.</p>}<Link to="/finance" className="link mt-2 inline-block text-xs">Open finance</Link></CardBody></Card>
    </div>
    <div className="mt-6 flex flex-wrap items-start justify-between gap-3 text-[10px] leading-relaxed text-ink-500"><p className="max-w-3xl">{data.disclaimer} Tank levels show current book stock.</p><span className="shrink-0">{lowStock.length ? `${lowStock.length} tanks low on stock` : `${data.stock.length} tanks tracked`}</span></div>
  </>;
}

function Metric({ label, value, hint, icon, to }: { label: string; value: string; hint: string; icon: React.ReactNode; to?: string }) {
  const content = <><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-ink-400">{label}</p><span className="rounded-lg bg-navy-800 p-2 text-ink-400">{icon}</span></div><p className="num mt-4 font-display text-[28px] font-bold tracking-tight text-ink-100">{value}</p><p className="mt-2 text-[11px] text-ink-500">{hint}</p></>;
  return to ? <Link to={to} className="card card-hover block p-5">{content}</Link> : <div className="card p-5">{content}</div>;
}

interface CombinedStation { id: string; name: string; code: string; litres: string; value: string; monthValue: string; shortExcess: string | null; tanks: DashboardData['stock']; alerts: DashboardData['alerts']; trend: { date: string; value: string }[] }
interface CombinedData { date: string; stations: CombinedStation[]; totalValue: string; totalLitres: string; monthValue: string }
function CombinedDashboard({ date, setDate, onBack }: { date: string; setDate: (date: string) => void; onBack: () => void }) {
  const { selectStation } = useStations();
  const result = useQuery<CombinedData>({ queryKey: ['combined-dashboard', date], queryFn: () => apiGet(`/reports/combined-dashboard?date=${date}`), refetchInterval: 60_000 });
  if (result.isLoading) return <LoadingBlock rows={8} />;
  if (result.isError || !result.data) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  const data = result.data;
  return <><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-2">Owner’s overview</p><h1 className="font-display text-3xl font-bold text-ink-100">Both pumps. One clear picture.</h1><p className="mt-2 text-sm text-ink-400">Compare your outlets for {formatDate(date)}.</p></div><div className="flex gap-2"><Input type="date" aria-label="Business date" value={date} max={todayIst()} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} className="w-auto" /><Button onClick={onBack} variant="outline">Single pump</Button></div></div><div className="grid gap-4 sm:grid-cols-3"><Metric label="Combined estimated sales" value={formatINR(data.totalValue)} hint={`${formatLitres(data.totalLitres)} dispensed`} icon={<Banknote className="h-4 w-4" />} /><Metric label="Month to date" value={formatINR(data.monthValue)} hint="Closed and flagged shifts" icon={<Gauge className="h-4 w-4" />} /><Metric label="Active outlets" value={String(data.stations.length)} hint="Separate operations, shared control" icon={<Store className="h-4 w-4" />} /></div><div className="mt-6 grid gap-5 lg:grid-cols-2">{data.stations.map((pump) => <Card key={pump.id}><CardHeader title={pump.name} subtitle={pump.code} action={<Badge tone={pump.alerts.length ? 'warning' : 'success'}>{pump.alerts.length} alerts</Badge>} /><CardBody><p className="text-xs text-ink-500">Estimated sales</p><p className="num mt-1 font-display text-3xl font-bold text-ink-100">{formatINR(pump.value)}</p><p className="mt-1 text-xs text-ink-500">{formatLitres(pump.litres)} · Cash short/excess: {pump.shortExcess === null ? 'Not settled' : formatINR(pump.shortExcess)}</p><div className="mt-5 space-y-4">{pump.tanks.map((tank) => <div key={tank.id}><div className="mb-1.5 flex justify-between text-xs"><span className="text-ink-300">{tank.code} · {tank.productName}</span><span className="num text-ink-500">{formatLitres(tank.bookStockLitres)}</span></div><div className="h-2 overflow-hidden rounded-full bg-navy-800"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, Number(tank.fillPct)))}%` }} /></div></div>)}</div>{pump.alerts.length > 0 && <div className="mt-5 space-y-2 border-t border-navy-700/60 pt-4">{pump.alerts.map((alert, index) => <p key={index} className="flex gap-2 text-xs text-ink-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />{alert.message}</p>)}</div>}<Button className="mt-5 w-full" variant="outline" onClick={() => { selectStation(pump.id); onBack(); }}>Open this pump <ArrowRight className="h-4 w-4" /></Button></CardBody></Card>)}</div><p className="mt-5 text-xs text-ink-500">Sales are totalizer estimates, not audited revenue. Tank levels are current book stock.</p></>;
}
