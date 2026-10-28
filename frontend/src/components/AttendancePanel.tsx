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
      toast('Attendance lag gayi', { description: `${date} ki Haziri save ho gayi.` });
      setMarks({});
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
    },
    onError: (error: Error) => toast('Attendance nahi lagi', { tone: 'danger', description: error.message }),
  });

  const toneFor = (status: string) =>
    status === 'PRESENT' ? 'bg-emerald-400/15 text-ok border-emerald-400/40'
      : status === 'ABSENT' ? 'bg-rose-500/10 text-danger border-rose-500/40'
      : status === 'HALF_DAY' ? 'bg-amber-400/10 text-warn border-amber-400/40'
      : 'bg-navy-800 text-ink-300 border-navy-600';

  return (
    <Card className="mt-4">
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-accent" /> Attendance — Haziri</span>}
        subtitle="Roz ki Haziri lagao; mahine ke aakhir me payable days se salary banti hai."
        action={(
          <div className="flex items-end gap-2">
            <Field label="Tarikh" className="mb-0 w-40">
              <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setMarks({}); }} />
            </Field>
            {canWrite && (
              <Button size="sm" variant="primary" loading={save.isPending} disabled={rows.length === 0} onClick={() => save.mutate()}>
                Haziri save karo
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
        <div className="divide-y divide-navy-800/70">
          {rows.map((row) => (
            <div key={row.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink-100">{row.name}</p>
                <p className="text-[10px] text-ink-500">{row.roleKey.replace(/_/g, ' ')} · {row.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ATTENDANCE_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!canWrite}
                    onClick={() => setMarks({ ...marks, [row.userId]: status })}
                    aria-pressed={statusOf(row) === status}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      statusOf(row) === status ? toneFor(status) : 'border-navy-700 bg-navy-900/50 text-ink-500 hover:text-ink-200'
                    } ${canWrite ? '' : 'cursor-not-allowed opacity-70'}`}
                  >
                    {status === 'PRESENT' ? 'Present' : status === 'ABSENT' ? 'Absent' : status === 'HALF_DAY' ? 'Aadha din' : status === 'WEEK_OFF' ? 'Chhutti din' : 'Leave'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-navy-700/60 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-ink-200">Mahine ka hisaab (salary ke liye)</p>
          <Field label="Mahina" className="mb-0 w-40">
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
                  <th className="text-right">Aadha din</th>
                  <th className="text-right">Absent</th>
                  <th className="text-right">Chhutti/Leave</th>
                  <th className="text-right">Payable days</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.employees ?? []).map((row) => (
                  <tr key={row.userId}>
                    <td className="text-ink-200">{row.name}<span className="block text-[10px] text-ink-500">{row.roleKey.replace(/_/g, ' ')}</span></td>
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
        <p className="mt-2 text-[11px] text-ink-500">Payable days = Present + aadha din × 0.5 + weekly off. Salary = (mahine ki tankhwah ÷ 30) × payable days.</p>
      </div>
    </Card>
  );
}
