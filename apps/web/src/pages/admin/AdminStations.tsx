import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Building2, Plus, Store } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  useToast,
} from '../../components/ui';

interface Station {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  tankCount: number;
  dispenserCount: number;
  deviceCount: number;
}

export default function AdminStations() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tenantFilter, setTenantFilter] = useState(searchParams.get('tenantId') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ tenantId: '', code: '', name: '', address: '', city: '', state: 'Maharashtra' });

  const tenants = useQuery<{ id: string; name: string }[]>({
    queryKey: ['admin-tenants-all'],
    queryFn: () => apiGet('/admin/tenants?pageSize=100'),
  });
  const stations = useQuery<Station[]>({
    queryKey: ['admin-stations', tenantFilter],
    queryFn: () => apiGet(`/admin/stations${tenantFilter ? `?tenantId=${tenantFilter}` : ''}`),
  });

  useEffect(() => {
    if (tenantFilter && !form.tenantId) setForm((current) => ({ ...current, tenantId: tenantFilter }));
  }, [tenantFilter, form.tenantId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-stations'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
  };

  const create = useMutation({
    mutationFn: () => apiPost('/admin/stations', form),
    onSuccess: () => {
      toast('Station created', { tone: 'success', description: 'The tenant owner can now configure tanks and dispensers.' });
      setCreateOpen(false);
      setForm({ tenantId: tenantFilter, code: '', name: '', address: '', city: '', state: 'Maharashtra' });
      invalidate();
    },
    onError: (error: Error) => toast('Could not create station', { tone: 'danger', description: error.message }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/admin/stations/${id}`, { status }),
    onSuccess: () => {
      toast('Station updated', { tone: 'success' });
      invalidate();
    },
    onError: (error: Error) => toast('Update failed', { tone: 'danger', description: error.message }),
  });

  const rows = stations.data ?? [];

  return (
    <div>
      <PageHeader
        title="Stations"
        description="Platform-wide station registry. Platform staff can create and deactivate stations; operational configuration stays with the tenant."
        actions={
          <Button onClick={() => { setCreateOpen(true); setForm((c) => ({ ...c, tenantId: tenantFilter })); }}>
            <Plus className="h-4 w-4" /> New station
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Stations" value={rows.length} icon={<Store className="h-4 w-4" />} />
        <StatCard label="Active" value={rows.filter((s) => s.status === 'ACTIVE').length} tone="success" />
        <StatCard label="Dispensers" value={rows.reduce((a, s) => a + Number(s.dispenserCount ?? 0), 0)} />
        <StatCard label="Gateways" value={rows.reduce((a, s) => a + Number(s.deviceCount ?? 0), 0)} />
      </div>

      <Card>
        <CardHeader
          title="All stations"
          action={
            <Select className="w-64" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
              <option value="">All organizations</option>
              {(Array.isArray(tenants.data) ? tenants.data : []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </Select>
          }
        />
        {stations.isLoading ? (
          <LoadingBlock />
        ) : stations.isError ? (
          <ErrorState error={stations.error} onRetry={() => void stations.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No stations" description="Create a station for an organization to begin." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Organization</th>
                  <th>Location</th>
                  <th className="text-right">Tanks</th>
                  <th className="text-right">Dispensers</th>
                  <th className="text-right">Gateways</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((station) => (
                  <tr key={station.id}>
                    <td>
                      <span className="font-medium text-ink-100">{station.name}</span>{' '}
                      <Badge tone="neutral">{station.code}</Badge>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-sm text-ink-300">
                        <Building2 className="h-3.5 w-3.5 text-ink-500" />
                        {station.tenantName}
                      </span>
                      <StatusBadge status={station.tenantStatus} />
                    </td>
                    <td className="text-ink-400">{[station.city, station.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="text-right tabular-nums">{station.tankCount}</td>
                    <td className="text-right tabular-nums">{station.dispenserCount}</td>
                    <td className="text-right tabular-nums">{station.deviceCount}</td>
                    <td><StatusBadge status={station.status} /></td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus.mutate({ id: station.id, status: station.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                      >
                        {station.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New station"
        description="Created on behalf of a tenant. No operational data is created automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create station</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organization" required className="sm:col-span-2">
            <Select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
              <option value="">Select an organization…</option>
              {(Array.isArray(tenants.data) ? tenants.data : []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Code" required>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
