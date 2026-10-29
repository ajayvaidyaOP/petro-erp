import { useQuery } from '@tanstack/react-query';
import { CreditCard, IndianRupee, Layers, Users } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatINR } from '../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
} from '../components/ui';

interface BillingData {
  subscription: {
    id: string;
    status: string;
    planName: string;
    planCode: string;
    monthlyPrice: string;
    annualPrice: string;
    startsAt: string;
    endsAt: string | null;
    trialEndsAt: string | null;
    seats: number;
    autoRenew: number;
    maxStations: number;
    maxUsers: number;
    maxDispensers: number;
    features: string[];
    trialDays: number;
  };
  invoices: {
    id: string;
    invoiceNumber: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    status: string;
    issuedAt: string;
    dueAt: string;
    paidAt: string | null;
    paymentReference: string | null;
  }[];
  usage: { stations: number; users: number; dispensers: number };
  outstanding: string;
  note: string;
}

export default function Billing() {
  const { me } = useAuth();
  const query = useQuery<BillingData>({
    queryKey: ['subscription'],
    queryFn: () => apiGet<BillingData>('/settings/subscription'),
  });

  if (query.isLoading) return <LoadingBlock label="Loading subscription…" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  const sub = data.subscription;

  const usagePct = (used: number, max: number) => (max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0);

  return (
    <div>
      <PageHeader
        title="Subscription"
        description="Your organization's plan, usage limits and platform invoices. Plan changes are made by the platform administrator."
        actions={<StatusBadge status={sub.status} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Plan" value={sub.planName} hint={sub.planCode} icon={<Layers className="h-4 w-4" />} />
        <StatCard label="Monthly price" value={formatINR(sub.monthlyPrice)} hint={`Annual ${formatINR(sub.annualPrice)}`} tone="accent" icon={<IndianRupee className="h-4 w-4" />} />
        <StatCard
          label="Outstanding"
          value={formatINR(data.outstanding)}
          tone={Number(data.outstanding) > 0 ? 'warning' : 'success'}
          hint="Platform invoices, not station cash."
          icon={<CreditCard className="h-4 w-4" />}
        />
        <StatCard
          label="Renewal"
          value={sub.endsAt ? formatDate(sub.endsAt) : sub.trialEndsAt ? 'Trial' : '—'}
          hint={sub.trialEndsAt ? `Trial ends ${formatDate(sub.trialEndsAt)}` : sub.autoRenew ? 'Auto-renew enabled' : 'Auto-renew off'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Plan details" subtitle="One owner, plus staff logins up to the plan limit. Station and device limits follow the plan." />
          <div className="p-4">
            <KeyValue
              items={[
                { label: 'Plan', value: `${sub.planName} (${sub.planCode})` },
                { label: 'Status', value: <StatusBadge status={sub.status} /> },
                { label: 'Started', value: formatDate(sub.startsAt) },
                { label: 'Renews / ends', value: sub.endsAt ? formatDate(sub.endsAt) : '—' },
                { label: 'Trial ends', value: sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '—' },
                { label: 'Team access', value: 'Owner + staff logins' },
              ]}
            />
            <div className="mt-4 space-y-3">
              <UsageBar label="Stations" used={data.usage.stations} max={sub.maxStations} pct={usagePct(data.usage.stations, sub.maxStations)} />
              <UsageBar label="Team accounts" used={data.usage.users} max={sub.maxUsers} pct={usagePct(data.usage.users, sub.maxUsers)} icon={<Users className="h-3.5 w-3.5" />} />
              <UsageBar label="Dispensers" used={data.usage.dispensers} max={sub.maxDispensers} pct={usagePct(data.usage.dispensers, sub.maxDispensers)} />
            </div>
            {(sub.features ?? []).length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1">
                {sub.features.map((feature) => <Badge key={feature} tone="info">{feature}</Badge>)}
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Organization" />
          <div className="p-4 text-sm text-ink-400">
            <p className="text-ink-100">{me?.tenant?.name}</p>
            <p className="text-xs text-ink-500">{me?.tenant?.slug}</p>
            <div className="mt-3"><StatusBadge status={me?.tenant?.status ?? 'ACTIVE'} /></div>
            {me?.tenant?.isDemo ? <div className="mt-3"><Badge tone="warning">DEMO ORGANIZATION</Badge></div> : null}
            <p className="mt-4 text-xs text-ink-500">{data.note}</p>
            <p className="mt-3 text-xs text-ink-500">
              Need a plan change? Contact your PetroFlow platform administrator. Self-service upgrades are not enabled in this build.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Invoices" subtitle="Issued by the platform. Settlement is recorded by the platform administrator." />
        {data.invoices.length === 0 ? (
          <EmptyState title="No invoices" description="Subscription invoices will appear here once issued." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Period</th>
                  <th className="text-right">Total</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-mono text-xs text-ink-200">{invoice.invoiceNumber}</td>
                    <td className="text-xs text-ink-400">{formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}</td>
                    <td className="num text-right text-ink-100">{formatINR(invoice.totalAmount)}</td>
                    <td className="text-xs text-ink-400">{formatDate(invoice.issuedAt)}</td>
                    <td className="text-xs text-ink-400">{formatDate(invoice.dueAt)}</td>
                    <td><StatusBadge status={invoice.status} /></td>
                    <td className="text-xs text-ink-500">{invoice.paymentReference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function UsageBar({ label, used, max, pct, icon }: { label: string; used: number; max: number; pct: number; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-400">
        <span className="inline-flex items-center gap-1">{icon}{label}</span>
        <span className="num">{used} / {max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-carbon-800 ring-1 ring-inset ring-carbon-700/60">
        <div className={pct >= 90 ? 'h-full rounded-full bg-danger' : pct >= 70 ? 'h-full rounded-full bg-warn' : 'h-full rounded-full bg-accent'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
