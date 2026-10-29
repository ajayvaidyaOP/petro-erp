import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';
import { useAuth } from './auth';
import { todayIst } from './format';
import { unclosedShiftMessage, type ShiftAlertsResponse } from './shifts';

export type AlertLevel = 'info' | 'warning' | 'error';

/** An operational alert produced by the backend. `to` is the workflow screen that resolves it. */
export interface OperationalAlert {
  level: AlertLevel;
  message: string;
  to?: string;
}

/** The subset of the owner-dashboard payload used for attention items and live shift context. */
export interface AttentionSource {
  alerts: OperationalAlert[];
  flaggedShifts: number;
  openShifts: Record<string, unknown>[];
}

/** One item in "Needs attention" and the notification centre. */
export interface AttentionItem extends OperationalAlert {
  id: string;
}

/**
 * Merges the dashboard alerts with unclosed-shift alerts into one ordered list.
 * Errors come first, then warnings, then information, so the most urgent item is at the top.
 */
export function buildAttentionItems(
  dashboard: AttentionSource | undefined,
  shiftAlerts: ShiftAlertsResponse | undefined,
): AttentionItem[] {
  const items: AttentionItem[] = [
    ...(dashboard?.alerts ?? []).map((alert, index) => ({ ...alert, id: `dash-${index}` })),
    ...(shiftAlerts?.alerts ?? []).map((alert) => ({
      id: `shift-${alert.id}`,
      level: 'warning' as const,
      message: unclosedShiftMessage(alert),
      to: '/shifts',
    })),
  ];
  const rank: Record<AlertLevel, number> = { error: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * Live attention and shift context for the signed-in user's selected pump. It reuses the same
 * query keys as the Overview screen, so when both are mounted only one request is made.
 */
export function useAttentionItems(stationId: string | null | undefined) {
  const { can } = useAuth();
  const today = todayIst();
  const dashboard = useQuery({
    queryKey: ['dashboard', stationId, today],
    queryFn: () => apiGet<AttentionSource>(`/reports/owner-dashboard?stationId=${stationId}&date=${today}`),
    enabled: Boolean(stationId) && can('reports.read'),
    refetchInterval: 60_000,
  });
  const shiftAlerts = useQuery({
    queryKey: ['shift-alerts', stationId],
    queryFn: () => apiGet<ShiftAlertsResponse>(`/shifts/alerts?stationId=${stationId}`),
    enabled: Boolean(stationId) && can('shifts.read'),
    refetchInterval: 60_000,
  });
  return {
    items: buildAttentionItems(dashboard.data, shiftAlerts.data),
    openShifts: dashboard.data?.openShifts ?? [],
    flaggedShifts: dashboard.data?.flaggedShifts ?? 0,
    businessDate: today,
    isLoading: dashboard.isLoading || shiftAlerts.isLoading,
    isFetching: dashboard.isFetching || shiftAlerts.isFetching,
    isError: dashboard.isError && shiftAlerts.isError,
    dataUpdatedAt: Math.max(dashboard.dataUpdatedAt, shiftAlerts.dataUpdatedAt),
    refetch: () => {
      void dashboard.refetch();
      void shiftAlerts.refetch();
    },
  };
}
