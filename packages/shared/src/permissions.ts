/** Fine-grained permissions. Roles are bundles of these, evaluated server-side. */
export const PERMISSIONS = {
  // platform (SaaS super admin only)
  PLATFORM_MANAGE: 'platform.manage',
  PLATFORM_AUDIT: 'platform.audit',
  // tenancy / station configuration
  STATIONS_READ: 'stations.read',
  STATIONS_WRITE: 'stations.write',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  PRICES_WRITE: 'prices.write',
  TANKS_READ: 'tanks.read',
  TANKS_WRITE: 'tanks.write',
  DISPENSERS_READ: 'dispensers.read',
  DISPENSERS_WRITE: 'dispensers.write',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_WRITE: 'employees.write',
  // hardware
  DEVICES_READ: 'devices.read',
  DEVICES_WRITE: 'devices.write',
  READINGS_READ: 'readings.read',
  READINGS_MANUAL: 'readings.manual',
  // operations
  SHIFTS_READ: 'shifts.read',
  SHIFTS_OPEN: 'shifts.open',
  SHIFTS_CLOSE: 'shifts.close',
  SHIFTS_APPROVE: 'shifts.approve',
  SALES_READ: 'sales.read',
  SALES_WRITE: 'sales.write',
  STOCK_READ: 'stock.read',
  STOCK_WRITE: 'stock.write',
  DELIVERIES_READ: 'deliveries.read',
  DELIVERIES_WRITE: 'deliveries.write',
  // finance
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_WRITE: 'customers.write',
  SUPPLIERS_READ: 'suppliers.read',
  SUPPLIERS_WRITE: 'suppliers.write',
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_WRITE: 'payments.write',
  EXPENSES_READ: 'expenses.read',
  EXPENSES_WRITE: 'expenses.write',
  RECONCILIATION_READ: 'reconciliation.read',
  RECONCILIATION_WRITE: 'reconciliation.write',
  REPORTS_READ: 'reports.read',
  DENSITY_READ: 'density.read',
  DENSITY_WRITE: 'density.write',
  DAYCLOSE_MANAGE: 'dayclose.manage',
  COMPLIANCE_READ: 'compliance.read',
  COMPLIANCE_WRITE: 'compliance.write',
  LUBRICANTS_READ: 'lubricants.read',
  LUBRICANTS_WRITE: 'lubricants.write',
  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_WRITE: 'attendance.write',
  AUDIT_READ: 'audit.read',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  BILLING_READ: 'billing.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

/** Only two business roles. Platform maintenance is deliberately separate. */
export const ROLE_DEFINITIONS = {
  OWNER: {
    name: 'Owner',
    label: 'Owner',
    scope: 'TENANT' as const,
    description: 'Full control of both pumps, prices, finance, team and settings.',
    permissions: Object.values(P).filter(
      (p) => p !== P.PLATFORM_MANAGE && p !== P.PLATFORM_AUDIT,
    ) as Permission[],
  },
  MANAGER: {
    name: 'Manager',
    label: 'Manager',
    scope: 'STATION' as const,
    description: 'Daily shifts, readings, stock, deliveries, credit and expenses.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.TANKS_READ, P.DISPENSERS_READ,
      P.DEVICES_READ, P.READINGS_READ, P.READINGS_MANUAL,
      P.SHIFTS_READ, P.SHIFTS_OPEN, P.SHIFTS_CLOSE, P.SHIFTS_APPROVE,
      P.SALES_READ, P.SALES_WRITE, P.STOCK_READ, P.STOCK_WRITE,
      P.DELIVERIES_READ, P.DELIVERIES_WRITE, P.CUSTOMERS_READ, P.CUSTOMERS_WRITE,
      P.SUPPLIERS_READ, P.PAYMENTS_READ, P.PAYMENTS_WRITE, P.EXPENSES_READ,
      P.EXPENSES_WRITE, P.RECONCILIATION_READ, P.RECONCILIATION_WRITE,
      P.REPORTS_READ, P.DENSITY_READ, P.DENSITY_WRITE, P.DAYCLOSE_MANAGE,
      P.COMPLIANCE_READ, P.LUBRICANTS_READ, P.LUBRICANTS_WRITE,
      P.ATTENDANCE_READ, P.ATTENDANCE_WRITE,
    ] as Permission[],
  },
} as const;

export type BusinessRoleKey = keyof typeof ROLE_DEFINITIONS;
export const BUSINESS_ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as BusinessRoleKey[];

const SYSTEM_ROLE_DEFINITIONS = {
  ...ROLE_DEFINITIONS,
  SUPER_ADMIN: {
    name: 'Platform Administrator',
    label: 'Platform Administrator',
    scope: 'PLATFORM' as const,
    description: 'Internal platform maintenance. Not a petrol-pump business role.',
    permissions: [P.PLATFORM_MANAGE, P.PLATFORM_AUDIT, P.SETTINGS_READ] as Permission[],
  },
} as const;

/** @deprecated Use BusinessRoleKey for business code. Includes the internal platform role. */
export type RoleKey = keyof typeof SYSTEM_ROLE_DEFINITIONS;
export const ROLE_KEYS = BUSINESS_ROLE_KEYS;
export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLE_DEFINITIONS) as RoleKey[];
export const RETIRED_ROLE_KEYS = ['STAFF', 'ACCOUNTANT', 'CASHIER', 'OPERATOR'] as const;

export function permissionsForRole(role: string): Permission[] {
  const def = SYSTEM_ROLE_DEFINITIONS[role as RoleKey];
  return def ? [...def.permissions] : [];
}
