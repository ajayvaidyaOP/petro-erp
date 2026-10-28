export interface UnclosedShiftAlert {
  id: string;
  stationId: string;
  stationName: string;
  shiftNumber: number;
  hoursOpen: string;
}

export interface ShiftAlertsResponse {
  thresholdHours: number;
  count: number;
  alerts: UnclosedShiftAlert[];
}

export function unclosedShiftMessage(alert: UnclosedShiftAlert) {
  return `Shift #${alert.shiftNumber} at ${alert.stationName} has been open for ${alert.hoursOpen} hours.`;
}
