import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUSES } from '@petroflow/shared';
import { CalendarCheck2 } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useStations } from '../lib/auth';
import { formatNumber, todayIst } from '../lib/format';
import { Button, Card, CardHeader, ErrorState, Field, Input, LoadingBlock, useToast } from './ui';

interface AttendanceSheetRow {
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  status: string | null;
  inTime: string | null;
  outTime: string | null;
}

interface AttendanceSummaryRow {
  userId: string;
  name: string;
  roleKey: string;
  present: number;
  absent: number;
  halfDay: number;
  weekOff: number;
  leave: number;
  payableDays: number;
}

export function AttendancePanel({ canWrite }: { canWrite: boolean }) {
  const { stationId } = useStations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIst());
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [marks, setMarks] = useState<Record<string, string>>({});

  const sheet = useQuery<{ employees: AttendanceSheetRow[] }>({
    queryKey: ['attendance', stationId, date],
    queryFn: () => apiGet(`/attendance?stationId=${stationId}&date=${date}`),
    enabled: Boolean(stationId),
  });
  const summary = useQuery<{ employees: AttendanceSummaryRow[] }>({
    queryKey: ['attendance-summary', stationId, month],
    queryFn: () => apiGet(`/attendance/summary?stationId=${stationId}&month=${month}`),
    enabled: Boolean(stationId),
  });

  const rows = sheet.data?.employees ?? [];
  const statusOf = (row: AttendanceSheetRow) => marks[row.userId] ?? row.status ?? '';

  const save = useMutation({
    mutationFn: () =>
      apiPost('/attendance/mark', {
        stationId,
        date,
        entries: rows
          .filter((row) => statusOf(row))
          .map((row) => ({ userId: row.userId, status: statusOf(row), inTime: row.inTime ?? undefined, outTime: row.outTime ?? undefined })),
      }),
    onSuccess: () => {
      toast('Attendance saved', { description: `Attendance sheet for ${date} recorded.` });
      setMarks({});
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
    },
    onError: (error: Error) => toast('Could not save attendance', { tone: 'danger', description: error.message }),
  });

  const toneFor = (status: string) =>
    status === 'PRESENT' ? 'bg-ok/12 text-ok border-ok/35'
      : status === 'ABSENT' ? 'bg-danger/12 text-danger border-danger/35'
      : status === 'HALF_DAY' ? 'bg-warn/12 text-warn border-warn/35'
      : 'bg-navy-800 text-ink-200 border-navy-600';

  return (
    <Card className="mt-4">
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-accent" /> Daily crew attendance</span>}
        subtitle="Mark daily shift roster presence; monthly payable days drive payroll computation."
        action={(
          <div className="flex items-end gap-2">
            <Field label="Date" className="mb-0 w-40">
              <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setMarks({}); }} />
            </Field>
            {canWrite && (
              <Button size="sm" variant="primary" loading={save.isPending} disabled={rows.length === 0} onClick={() => save.mutate()}>
                Save attendance
              </Button>
            )}
          </div>
        )}
      />
      {sheet.isLoading ? (
        <LoadingBlock rows={3} />
      ) : sheet.isError ? (
        <div className="p-4"><ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} /></div>
      ) : (
        <div className="divide-y divide-navy-700/60">
          {rows.map((row) => (
            <div key={row.userId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-ink-100">{row.name}</p>
                <p className="text-[11px] text-ink-500">{row.roleKey.replace(/_/g, ' ')} · {row.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ATTENDANCE_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!canWrite}
                    onClick={() => setMarks({ ...marks, [row.userId]: status })}
                    aria-pressed={statusOf(row) === status}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                      statusOf(row) === status ? toneFor(status) : 'border-navy-700 bg-navy-900/60 text-ink-500 hover:border-navy-600 hover:text-ink-100'
                    } ${canWrite ? '' : 'cursor-not-allowed opacity-70'}`}
                  >
                    {status === 'PRESENT' ? 'Present' : status === 'ABSENT' ? 'Absent' : status === 'HALF_DAY' ? 'Half day' : status === 'WEEK_OFF' ? 'Weekly off' : 'Leave'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-navy-700/70 bg-navy-900/40 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold text-ink-100">Monthly payroll summary</p>
          <Field label="Month" className="mb-0 w-40">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </div>
        {summary.isLoading ? (
          <LoadingBlock rows={2} />
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th className="text-right">Present</th>
                  <th className="text-right">Half day</th>
                  <th className="text-right">Absent</th>
                  <th className="text-right">Off / Leave</th>
                  <th className="text-right">Payable days</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.employees ?? []).map((row) => (
                  <tr key={row.userId}>
                    <td className="font-medium text-ink-100">{row.name}<span className="block text-[10px] font-normal text-ink-500">{row.roleKey.replace(/_/g, ' ')}</span></td>
                    <td className="num text-right">{row.present}</td>
                    <td className="num text-right">{row.halfDay}</td>
                    <td className="num text-right text-danger">{row.absent}</td>
                    <td className="num text-right text-ink-400">{row.weekOff + row.leave}</td>
                    <td className="num text-right font-semibold text-ink-100">{formatNumber(row.payableDays, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2.5 text-[11px] text-ink-500">Payable days = Present + Half day × 0.5 + Weekly off.</p>
      </div>
    </Card>
  );
}
