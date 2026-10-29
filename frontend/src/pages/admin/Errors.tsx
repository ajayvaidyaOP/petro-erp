import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ShieldAlert } from 'lucide-react';
import { apiList, apiPatch, type ListMeta } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  useToast,
} from '../../components/ui';

interface PlatformError {
  id: string;
  source: string;
  message: string;
  detail: string | null;
  path: string | null;
  severity: string;
  tenantName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export default function Errors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PlatformError | null>(null);

  const query = useQuery<{ data: PlatformError[]; meta: ListMeta }>({
    queryKey: ['admin-errors', scope, page],
    queryFn: () => apiList<PlatformError>(`/admin/errors?page=${page}&pageSize=20${scope === 'all' ? '&resolved=true' : ''}`),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => apiPatch(`/admin/errors/${id}/resolve`),
    onSuccess: () => {
      toast('Error resolved', { tone: 'success' });
      setDetail(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-errors'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
    },
    onError: (error: Error) => toast('Could not resolve', { tone: 'danger', description: error.message }),
  });

  const rows = query.data?.data ?? [];
  const open = rows.filter((row) => !row.resolvedAt).length;

  return (
    <div>
      <PageHeader
        title="Platform errors"
        description="Server-side 5xx captures with request path and stack. Tenant fuel and financial data is never included here."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Errors in view" value={query.data?.meta.total ?? 0} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Unresolved (this page)" value={open} tone={open ? 'danger' : 'success'} />
        <StatCard label="Source" value="API" hint="Captured by the centralised error handler." />
      </div>

      <Card>
        <CardHeader
          title="Error log"
          action={
            <Select
              className="w-full sm:w-44"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'open' | 'all');
                setPage(1);
              }}
            >
              <option value="open">Unresolved only</option>
              <option value="all">All errors</option>
            </Select>
          }
        />
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No errors" description="Nothing has been captured for this filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Message</th>
                    <th>Path</th>
                    <th>Organization</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-xs text-ink-400">{formatDateTime(row.createdAt)}</td>
                      <td className="max-w-[380px] truncate text-sm text-ink-200">{row.message}</td>
                      <td className="font-mono text-xs text-ink-400">{row.path ?? '—'}</td>
                      <td className="text-xs text-ink-400">{row.tenantName ?? 'Platform'}</td>
                      <td>
                        {row.resolvedAt ? <Badge tone="success">RESOLVED</Badge> : <Badge tone="danger">{row.severity}</Badge>}
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
                          Inspect
                        </Button>
                      </td>
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

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title="Error detail"
        description={detail?.path ?? undefined}
        footer={
          detail && !detail.resolvedAt ? (
            <>
              <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
              <Button loading={resolve.isPending} onClick={() => detail && resolve.mutate(detail.id)}>
                <CheckCheck className="h-4 w-4" /> Mark resolved
              </Button>
            </>
          ) : (
            <Button onClick={() => setDetail(null)}>Close</Button>
          )
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-100">{detail?.message}</p>
          <div className="flex flex-wrap gap-2 text-xs text-ink-500">
            <Badge tone="neutral">{detail?.source}</Badge>
            <Badge tone="neutral">{detail?.severity}</Badge>
            <span>{formatDateTime(detail?.createdAt)}</span>
            <span>{detail?.tenantName ?? 'Platform-level'}</span>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-carbon-700/60 bg-inset p-3 text-[11px] text-ink-300">
            {detail?.detail ?? 'No stack trace captured.'}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
