import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Radio, TriangleAlert } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
} from '../../components/ui';

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  isSimulated: number;
  online: boolean;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  keyVersion: number;
  vendor: string | null;
  model: string | null;
  protocol: string | null;
  stationName: string;
  tenantName: string;
  tenantId: string;
  eventCount: number;
  errorCount: number;
}

interface Fleet {
  devices: DeviceRow[];
  onlineWindowMinutes: number;
  realHardwareVerified: boolean;
  note: string;
}

export default function AdminDevices() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery<Fleet>({
    queryKey: ['admin-devices'],
    queryFn: () => apiGet<Fleet>('/admin/devices'),
    refetchInterval: 60_000,
  });

  const rows = (query.data?.devices ?? []).filter((device) => {
    const matchesSearch = !search || `${device.name} ${device.code} ${device.tenantName}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !status || device.status === status;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <PageHeader
        title="Hardware fleet"
        description="Every gateway across the platform with heartbeat-derived liveness. Real hardware connectivity remains unverified."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Gateways" value={query.data?.devices.length ?? 0} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Online" value={(query.data?.devices ?? []).filter((d) => d.online).length} tone="success" icon={<Radio className="h-4 w-4" />} />
        <StatCard label="Simulated" value={(query.data?.devices ?? []).filter((d) => d.isSimulated).length} hint="Clearly labelled demo gateways." />
        <StatCard
          label="Event errors"
          value={(query.data?.devices ?? []).reduce((acc, d) => acc + Number(d.errorCount ?? 0), 0)}
          tone="warning"
          icon={<TriangleAlert className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader
          title="Device registry"
          subtitle={query.data?.note}
          action={
            <div className="flex gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search gateway or organization" className="w-full sm:w-56" />
              <Select className="w-full sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="ONLINE">Online</option>
                <option value="OFFLINE">Offline</option>
                <option value="DISABLED">Disabled</option>
              </Select>
            </div>
          }
        />
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No gateways" description="No devices match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Gateway</th>
                  <th>Organization / station</th>
                  <th>Last heartbeat</th>
                  <th className="text-right">Events</th>
                  <th className="text-right">Errors</th>
                  <th>Credential</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-100">{device.name}</span>
                        <Badge tone="neutral">{device.code}</Badge>
                        {device.isSimulated ? <Badge tone="warning">SIMULATED</Badge> : <Badge tone="danger">REAL · UNVERIFIED</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {[device.vendor, device.model, device.protocol].filter(Boolean).join(' · ') || device.type}
                      </p>
                    </td>
                    <td className="text-sm text-ink-300">
                      {device.tenantName}
                      <p className="text-xs text-ink-500">{device.stationName}</p>
                    </td>
                    <td className="text-xs text-ink-400">
                      {device.lastHeartbeatAt ? timeAgo(device.lastHeartbeatAt) : 'Never'}
                      <p className="text-ink-500">{formatDateTime(device.lastHeartbeatAt)}</p>
                    </td>
                    <td className="text-right tabular-nums">{device.eventCount}</td>
                    <td className="text-right tabular-nums">
                      {Number(device.errorCount) > 0 ? <span className="text-danger">{device.errorCount}</span> : '0'}
                    </td>
                    <td className="text-xs text-ink-400">v{device.keyVersion}</td>
                    <td>
                      <StatusBadge status={device.status} />
                      <p className={`mt-1 text-[11px] ${device.online ? 'text-ok' : 'text-danger'}`}>
                        {device.online ? 'reachable' : 'offline'}
                      </p>
                    </td>
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
