import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, ChevronDown, Fuel, RefreshCw, Save, Server, ShieldCheck, Store, Tag } from 'lucide-react';
import { apiGet, apiPut } from '../lib/api';
import { useAuth, useStations } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  PageHeader,
  StatCard,
  useToast,
} from '../components/ui';

interface SettingSchema {
  type: 'number' | 'boolean' | 'string';
  min?: number;
  max?: number;
  label: string;
  description: string;
  scope: string;
}

interface SettingsResponse {
  settings: Record<string, string>;
  effective: Record<string, string | number | boolean>;
  schema: Record<string, SettingSchema>;
}

interface Diagnostics {
  application: { name: string; version: string; apiVersion: string; environment: string; nodeVersion: string; platform: string; uptimeSeconds: number; serverTime: string; timezone: string };
  database: { engine: string; file: string; sizeBytes: number; tenants: number; stations: number; users: number; tanks: number; nozzles: number; meterReadings: number; shifts: number; creditEntries: number; payments: number; auditLogs: number };
  hardware: { devices: Record<string, number>; eventStates: Record<string, number>; onlineWindowMinutes: number; adapterContractVersion: string; simulatorEnabled: boolean; realHardwareVerified: boolean; note: string };
  security: { sessionsAreServerSide: boolean; sessionCookie: string; cookieSecure: boolean; sessionTtlHours: number; passwordHashing: string; rateLimiting: string; demoPasswordInUse: boolean; demoPasswordWarning: string };
  environment: { demoMode: boolean; seedDemoData: boolean; trustProxy: boolean; corsOrigin: string; backupRetentionDays: number };
  operations: { backup: string; restore: string; migrations: string };
}

export default function Settings() {
  const { can } = useAuth();
  const { stationId } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});

  const settings = useQuery<SettingsResponse>({
    queryKey: ['settings', stationId],
    queryFn: () => apiGet<SettingsResponse>(`/settings?stationId=${stationId}`),
    enabled: Boolean(stationId),
  });
  const diagnostics = useQuery<Diagnostics>({
    queryKey: ['settings-diagnostics', stationId],
    queryFn: () => apiGet<Diagnostics>(`/settings/diagnostics?stationId=${stationId}`),
    enabled: Boolean(stationId),
  });

  useEffect(() => {
    if (settings.data) setValues(settings.data.effective);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      apiPut('/settings', {
        stationId,
        values: Object.fromEntries(
          Object.entries(values).filter(([key]) => settings.data?.schema[key]?.scope !== 'tenant'),
        ),
      }),
    onSuccess: () => {
      toast('Settings saved', { tone: 'success', description: 'Changes are audited and apply to future readings.' });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error: Error) => toast('Could not save settings', { tone: 'danger', description: error.message }),
  });

  if (settings.isLoading) return <LoadingBlock label="Loading settings…" rows={5} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const schema = settings.data!.schema;
  const entries = Object.entries(schema);

  return (
    <div>
      <PageHeader
        title="Pump settings"
        description="Set up your pump once. Keep advanced tools out of the way of everyday work."
        actions={
          can('settings.write') ? (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" /> Save settings
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { to: '/stations', label: 'Pump details', text: 'Names, addresses and outlet information', icon: Store, permission: 'stations.read' },
          { to: '/products', label: 'Fuel & prices', text: 'Products and effective price revisions', icon: Tag, permission: 'products.read' },
          { to: '/dispensers', label: 'Dispensers & nozzles', text: 'Nozzle-to-tank mapping and setup', icon: Fuel, permission: 'dispensers.read' },
          { to: '/compliance', label: 'Licences & compliance', text: 'Documents, expiry dates and reminders', icon: ShieldCheck, permission: 'compliance.read' },
          { to: '/devices', label: 'Devices & gateways', text: 'Hardware connections and simulator', icon: Server, permission: 'devices.read' },
          { to: '/audit', label: 'Activity & audit log', text: 'A traceable history of every change', icon: CheckCircle2, permission: 'audit.read' },
        ].filter((item) => can(item.permission)).map((item) => <Link key={item.to} to={item.to} className="quick-action"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><item.icon className="h-4 w-4" /></span><span><span className="block text-xs font-semibold text-ink-100">{item.label}</span><span className="mt-1 block text-[11px] leading-relaxed text-ink-500">{item.text}</span></span><ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-500" /></Link>)}
      </div>
      {can('billing.read') && <Link to="/billing" className="mb-5 flex items-center justify-between rounded-xl border border-navy-700/70 px-4 py-3 text-xs text-ink-400"><span>Subscription & plan details</span><ArrowUpRight className="h-4 w-4 text-accent" /></Link>}
      <details className="card group mb-5"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-ink-200">Advanced settings & diagnostics <ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary><div className="border-t border-navy-700/60 p-4">
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Environment" value={diagnostics.data?.application.environment ?? '—'} icon={<Server className="h-4 w-4" />} />
        <StatCard label="API version" value={diagnostics.data?.application.apiVersion ?? '—'} hint={diagnostics.data?.application.version} />
        <StatCard
          label="Server-side sessions"
          value={diagnostics.data?.security.sessionsAreServerSide ? 'Enabled' : 'No'}
          tone={diagnostics.data?.security.sessionsAreServerSide ? 'success' : 'danger'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Real hardware"
          value={diagnostics.data?.hardware.realHardwareVerified ? 'Verified' : 'Unverified'}
          tone="warning"
          hint="No certified forecourt controller has been connected."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Operational thresholds" subtitle="Station-level overrides take precedence over organization defaults." />
          <div className="space-y-4 p-4">
            {entries.map(([key, spec]) => {
              const disabled = spec.scope === 'tenant' || !can('settings.write');
              return (
                <div key={key} className="rounded-lg border border-navy-700/60 bg-navy-900/30 p-3">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-100">{spec.label}</p>
                    <div className="flex gap-1">
                      <Badge tone={spec.scope === 'tenant' ? 'info' : 'neutral'}>{spec.scope === 'tenant' ? 'Organization' : 'Station'}</Badge>
                      <Badge tone="muted">{key}</Badge>
                    </div>
                  </div>
                  {spec.type === 'boolean' ? (
                    <Checkbox
                      checked={Boolean(values[key])}
                      disabled={disabled}
                      onChange={(checked) => setValues({ ...values, [key]: checked })}
                      label={values[key] ? 'Enabled' : 'Disabled'}
                    />
                  ) : (
                    <Field label="">
                      <Input
                        type={spec.type === 'number' ? 'number' : 'text'}
                        min={spec.min}
                        max={spec.max}
                        disabled={disabled}
                        value={String(values[key] ?? '')}
                        onChange={(e) => setValues({ ...values, [key]: spec.type === 'number' ? Number(e.target.value) : e.target.value })}
                      />
                    </Field>
                  )}
                  <p className="mt-1 text-xs text-ink-500">{spec.description}</p>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Runtime diagnostics"
              subtitle={`${diagnostics.data?.application.nodeVersion ?? ''} · ${diagnostics.data?.application.platform ?? ''}`}
              action={
                <Button size="sm" variant="ghost" onClick={() => void diagnostics.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              }
            />
            <div className="p-4">
              <KeyValue
                items={[
                  { label: 'Server time (IST)', value: formatDateTime(diagnostics.data?.application.serverTime) },
                  { label: 'Uptime', value: `${Math.floor((diagnostics.data?.application.uptimeSeconds ?? 0) / 60)} min` },
                  { label: 'Database engine', value: diagnostics.data?.database.engine ?? '—' },
                  { label: 'Database file', value: diagnostics.data?.database.file ?? '—' },
                  { label: 'Meter readings', value: diagnostics.data?.database.meterReadings ?? 0 },
                  { label: 'Audit rows', value: diagnostics.data?.database.auditLogs ?? 0 },
                  { label: 'Password hashing', value: diagnostics.data?.security.passwordHashing ?? '—' },
                  { label: 'Session cookie', value: `${diagnostics.data?.security.sessionCookie ?? ''} (secure: ${diagnostics.data?.security.cookieSecure ? 'yes' : 'no'})` },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Hardware integration posture" />
            <div className="space-y-2 p-4 text-sm text-ink-400">
              <div className="flex flex-wrap gap-1">
                <Badge tone="warning">Adapter contract v{diagnostics.data?.hardware.adapterContractVersion ?? '1.0.0'}</Badge>
                <Badge tone={diagnostics.data?.hardware.simulatorEnabled ? 'info' : 'muted'}>Simulator {diagnostics.data?.hardware.simulatorEnabled ? 'enabled' : 'disabled'}</Badge>
                <Badge tone="danger">Real hardware unverified</Badge>
              </div>
              <p>{diagnostics.data?.hardware.note}</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(diagnostics.data?.hardware.eventStates ?? {}).map(([state, count]) => (
                  <div key={state} className="rounded border border-navy-700/60 p-2 text-xs">
                    <span className="text-ink-500">{state}</span>
                    <p className="num text-ink-200">{count}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Backup & recovery" subtitle="Documented procedure — no automated backup runs in this environment." />
            <div className="space-y-3 p-4 text-sm text-ink-400">
              <p><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-ok" />{diagnostics.data?.operations.backup}</p>
              <p>{diagnostics.data?.operations.restore}</p>
              <p className="text-xs text-ink-500">{diagnostics.data?.operations.migrations}</p>
            </div>
          </Card>
        </div>
      </div>
      </div></details>
    </div>
  );
}
