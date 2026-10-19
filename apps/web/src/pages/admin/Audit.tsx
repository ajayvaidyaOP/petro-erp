import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { apiList, type ListMeta } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchInput,
  StatCard,
} from '../../components/ui';

interface PlatformAuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  summary: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export default function AdminAudit() {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const query = useQuery<{ data: PlatformAuditRow[]; meta: ListMeta }>({
    queryKey: ['admin-audit', params.toString()],
    queryFn: () => apiList<PlatformAuditRow>(`/admin/audit?${params.toString()}`),
  });

  const rows = query.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Platform audit log"
        description="Cross-tenant audit trail for platform administrators: onboarding, suspension, plan changes and invoice settlement."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Records" value={query.data?.meta.total ?? 0} icon={<ScrollText className="h-4 w-4" />} />
        <StatCard label="Tenant actions" value={rows.filter((r) => r.tenantId).length} hint="Rows linked to an organization." />
        <StatCard label="Platform actions" value={rows.filter((r) => !r.tenantId).length} hint="Plans, errors and platform settings." />
      </div>

      <Card>
        <CardHeader
          title="Audit trail"
          subtitle="Append-only. Actor, tenant and before/after values are retained per entry."
          action={
            <div className="flex flex-wrap gap-2">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search action, actor or summary"
                className="w-56"
              />
              <Field label="From" className="w-36">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To" className="w-36">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
          }
        />
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No audit records" description="Platform actions will appear here." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Summary</th>
                    <th>Organization</th>
                    <th>Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-xs text-ink-400">{formatDateTime(row.createdAt)}</td>
                      <td><Badge tone={row.action.includes('SUSPEND') ? 'danger' : 'neutral'}>{row.action}</Badge></td>
                      <td className="max-w-[380px] text-sm text-ink-200">{row.summary ?? row.entity}</td>
                      <td className="text-xs text-ink-400">{row.tenantName ?? 'Platform'}</td>
                      <td className="text-xs text-ink-400">{row.actorEmail ?? 'system'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {query.data ? (
              <Pagination
                page={query.data.meta.page}
                pageSize={query.data.meta.pageSize}
                total={query.data.meta.total}
                totalPages={query.data.meta.totalPages}
                onPage={setPage}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
