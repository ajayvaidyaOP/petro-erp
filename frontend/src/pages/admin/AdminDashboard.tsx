import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  Building2,
  CreditCard,
  HardDrive,
  IndianRupee,
  ShieldAlert,
  Store,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { apiGet } from '../../lib/api';
import { formatDateTime, formatINR } from '../../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
} from '../../components/ui';

interface Metrics {
  tenants: { total: number; active: number; suspended: number; pending: number; demo: number };
  stations: number;
  users: number;
  subscriptions: {
    trialing: number;
    active: number;
    pastDue: number;
    suspended: number;
    cancelled: number;
    mrr: string;
    arr: string;
    byPlan: { plan: string; code: string; active: number; mrr: string }[];
    trialsEndingSoon: { id: string; tenantId: string; tenantName: string; trialEndsAt: string; planName: string }[];
    expiringSoon: { id: string; tenantId: string; tenantName: string; endsAt: string }[];
  };
  devices: { total: number; online: number; offline: number; simulated: number; disabled: number; realHardwareVerified: boolean; events: Record<string, number> };
  invoices: { outstanding: string; overdue: number; issued: number };
  errors: { open: number; recent: { id: string; message: string; path: string; createdAt: string }[] };
  recentTenants: { id: string; name: string; slug: string; status: string; stationCount: number; userCount: number; createdAt: string }[];
  note: string;
  generatedAt: string;
}

export default function AdminDashboard() {
  const query = useQuery<Metrics>({
    queryKey: ['admin-metrics'],
    queryFn: () => apiGet<Metrics>('/admin/metrics'),
    refetchInterval: 60_000,
  });

  if (query.isLoading) return <LoadingBlock label="Loading platform metrics…" rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!;

  return (
    <div>
      <PageHeader
        title="Platform overview"
        description="Aggregate subscription, station and hardware health. Tenant fuel sales, customer ledgers and tank data are intentionally not exposed to the platform administrator."
        breadcrumb="SaaS administration"
        actions={<Badge tone="neutral">Updated {formatDateTime(data.generatedAt)}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organizations"
          value={data.tenants.total}
          hint={`${data.tenants.active} active · ${data.tenants.suspended} suspended · ${data.tenants.demo} demo`}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard label="Stations" value={data.stations} hint={`${data.users} users across all tenants`} icon={<Store className="h-4 w-4" />} />
        <StatCard label="MRR" value={formatINR(data.subscriptions.mrr)} hint={`ARR ${formatINR(data.subscriptions.arr)} · ${data.subscriptions.active} active subscriptions`} tone="accent" icon={<IndianRupee className="h-4 w-4" />} />
        <StatCard
          label="Outstanding invoices"
          value={formatINR(data.invoices.outstanding)}
          hint={`${data.invoices.issued} issued · ${data.invoices.overdue} overdue`}
          tone={Number(data.invoices.outstanding) > 0 ? 'warning' : 'default'}
          icon={<CreditCard className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Trialing" value={data.subscriptions.trialing} hint={`${data.subscriptions.trialsEndingSoon.length} ending within 7 days`} />
        <StatCard label="Past due" value={data.subscriptions.pastDue} tone={data.subscriptions.pastDue ? 'warning' : 'default'} />
        <StatCard label="Gateways online" value={`${data.devices.online}/${data.devices.total}`} hint={`${data.devices.simulated} simulated · ${data.devices.disabled} disabled`} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard
          label="Unresolved errors"
          value={data.errors.open}
          tone={data.errors.open ? 'danger' : 'success'}
          hint="Captured server-side; no tenant financial data is shown."
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Revenue by plan"
            subtitle="Subscription revenue only — not fuel gross sales."
            action={<Link className="link text-xs" to="/admin/subscriptions">Manage subscriptions →</Link>}
          />
          {data.subscriptions.byPlan.length === 0 ? (
            <EmptyState title="No active plans" description="Create a subscription plan to start onboarding." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th className="text-right">Subscribers</th>
                    <th className="text-right">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.byPlan.map((plan) => (
                    <tr key={plan.code}>
                      <td><span className="text-ink-100">{plan.plan}</span> <span className="text-xs text-ink-500">{plan.code}</span></td>
                      <td className="text-right tabular-nums">{plan.active}</td>
                      <td className="num text-right text-ink-100">{formatINR(plan.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Renewals & trials" subtitle="Next 30 days" />
          <div className="space-y-3 p-4">
            {data.subscriptions.trialsEndingSoon.length === 0 && data.subscriptions.expiringSoon.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing due in the next 30 days.</p>
            ) : (
              <>
                {data.subscriptions.trialsEndingSoon.map((trial) => (
                  <Link key={trial.id} to={`/admin/tenants/${trial.tenantId}`} className="block rounded-lg border border-navy-700/60 p-3 hover:border-accent/40">
                    <p className="text-sm text-ink-200">{trial.tenantName}</p>
                    <p className="text-xs text-warn">Trial of {trial.planName} ends {formatDateTime(trial.trialEndsAt)}</p>
                  </Link>
                ))}
                {data.subscriptions.expiringSoon.map((sub) => (
                  <Link key={sub.id} to={`/admin/tenants/${sub.tenantId}`} className="block rounded-lg border border-navy-700/60 p-3 hover:border-accent/40">
                    <p className="text-sm text-ink-200">{sub.tenantName}</p>
                    <p className="text-xs text-ink-400">Subscription renews / ends {formatDateTime(sub.endsAt)}</p>
                  </Link>
                ))}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent organizations"
            action={<Link className="link text-xs" to="/admin/tenants">View all →</Link>}
          />
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th className="text-right">Stations</th>
                  <th className="text-right">Users</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>
                      <Link to={`/admin/tenants/${tenant.id}`} className="link text-sm">{tenant.name}</Link>
                      <span className="ml-2 text-xs text-ink-500">{tenant.slug}</span>
                    </td>
                    <td className="text-right tabular-nums">{tenant.stationCount}</td>
                    <td className="text-right tabular-nums">{tenant.userCount}</td>
                    <td><StatusBadge status={tenant.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Platform errors"
            subtitle="Recent unhandled or rejected requests"
            action={<Link className="link text-xs" to="/admin/errors">Open log →</Link>}
          />
          {data.errors.recent.length === 0 ? (
            <EmptyState title="No open errors" description="The API has not recorded any unresolved 5xx errors." />
          ) : (
            <div className="space-y-2 p-4">
              {data.errors.recent.map((error) => (
                <div key={error.id} className="callout-danger flex items-start gap-2.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-100">{error.message}</p>
                    <p className="text-xs text-ink-500">{error.path} · {formatDateTime(error.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Device event pipeline" subtitle="Events across all tenants, by processing status." />
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
            {Object.entries(data.devices.events).length === 0 ? (
              <p className="col-span-full text-sm text-ink-500">No gateway events recorded yet.</p>
            ) : (
              Object.entries(data.devices.events).map(([status, count]) => (
                <div key={status} className="rounded-lg border border-navy-700/60 bg-navy-900/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-ink-500">{status}</p>
                  <p className="num mt-1 text-lg text-ink-100">{count}</p>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-navy-700/60 p-3 text-xs text-ink-500">
            <Activity className="mr-1 inline h-3.5 w-3.5" />
            Real hardware verification: {data.devices.realHardwareVerified ? 'verified' : 'unverified — no real dispenser connected'}
          </div>
        </Card>

        <Card>
          <CardHeader title="Governance notes" />
          <div className="space-y-2 p-4 text-sm text-ink-400">
            <p className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 text-ink-500" /> {data.note}</p>
            <p>Organization suspension revokes every active session for that tenant and pauses subscription billing status.</p>
            <p>Every platform action is written to the audit log with the acting administrator and reason where supplied.</p>
            <Link to="/admin/audit" className="link text-xs">Open platform audit log →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
