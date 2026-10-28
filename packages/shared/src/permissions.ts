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

export const ROLE_DEFINITIONS = {
  SUPER_ADMIN: {
    name: 'SaaS Super Admin',
    scope: 'PLATFORM' as const,
    description: 'Manages tenant organizations, subscriptions, platform devices and errors.',
    permissions: [P.PLATFORM_MANAGE, P.PLATFORM_AUDIT, P.SETTINGS_READ] as Permission[],
  },
  OWNER: {
    name: 'Station Owner',
    scope: 'TENANT' as const,
    description: 'Full access to the organization, all stations and billing.',
    permissions: Object.values(P).filter(
      (p) => p !== P.PLATFORM_MANAGE && p !== P.PLATFORM_AUDIT,
    ) as Permission[],
  },
  STAFF: {
    name: 'Pump Staff',
    scope: 'STATION' as const,
    description: 'Daily work at the assigned pump only.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.TANKS_READ, P.DISPENSERS_READ,
      P.EMPLOYEES_READ, P.READINGS_READ, P.READINGS_MANUAL,
      P.SHIFTS_READ, P.SHIFTS_OPEN, P.SHIFTS_CLOSE, P.SALES_READ, P.SALES_WRITE,
      P.STOCK_READ, P.STOCK_WRITE, P.DELIVERIES_READ, P.DELIVERIES_WRITE,
      P.CUSTOMERS_READ, P.SUPPLIERS_READ, P.EXPENSES_READ, P.EXPENSES_WRITE,
      P.PAYMENTS_READ, P.DENSITY_READ, P.DENSITY_WRITE,
      P.LUBRICANTS_READ, P.LUBRICANTS_WRITE, P.ATTENDANCE_READ, P.ATTENDANCE_WRITE,
    ] as Permission[],
  },
  MANAGER: {
    name: 'Station Manager',
    scope: 'STATION' as const,
    description: 'Runs day-to-day station operations, approves shifts and variances.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.PRODUCTS_WRITE, P.PRICES_WRITE,
      P.TANKS_READ, P.TANKS_WRITE, P.DISPENSERS_READ, P.DISPENSERS_WRITE,
      P.EMPLOYEES_READ, P.DEVICES_READ, P.DEVICES_WRITE, P.READINGS_READ,
      P.READINGS_MANUAL, P.SHIFTS_READ, P.SHIFTS_OPEN, P.SHIFTS_CLOSE,
      P.SHIFTS_APPROVE, P.SALES_READ, P.SALES_WRITE, P.STOCK_READ, P.STOCK_WRITE,
      P.DELIVERIES_READ, P.DELIVERIES_WRITE, P.CUSTOMERS_READ, P.CUSTOMERS_WRITE,
      P.SUPPLIERS_READ, P.PAYMENTS_READ, P.PAYMENTS_WRITE, P.EXPENSES_READ,
      P.EXPENSES_WRITE, P.RECONCILIATION_READ, P.RECONCILIATION_WRITE,
      P.REPORTS_READ, P.DENSITY_READ, P.DENSITY_WRITE, P.DAYCLOSE_MANAGE,
      P.COMPLIANCE_READ, P.COMPLIANCE_WRITE, P.LUBRICANTS_READ, P.LUBRICANTS_WRITE,
      P.ATTENDANCE_READ, P.ATTENDANCE_WRITE, P.AUDIT_READ, P.SETTINGS_READ,
    ] as Permission[],
  },
  ACCOUNTANT: {
    name: 'Accountant',
    scope: 'STATION' as const,
    description: 'Handles ledgers, payments, expenses, reconciliations and reports.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.TANKS_READ, P.DISPENSERS_READ,
      P.DEVICES_READ, P.READINGS_READ, P.SHIFTS_READ, P.SALES_READ,
      P.STOCK_READ, P.DELIVERIES_READ, P.DELIVERIES_WRITE, P.CUSTOMERS_READ,
      P.CUSTOMERS_WRITE, P.SUPPLIERS_READ, P.SUPPLIERS_WRITE, P.PAYMENTS_READ,
      P.PAYMENTS_WRITE, P.EXPENSES_READ, P.EXPENSES_WRITE,
      P.RECONCILIATION_READ, P.RECONCILIATION_WRITE, P.REPORTS_READ,
      P.DENSITY_READ, P.COMPLIANCE_READ, P.LUBRICANTS_READ, P.LUBRICANTS_WRITE,
      P.ATTENDANCE_READ, P.AUDIT_READ, P.SETTINGS_READ,
    ] as Permission[],
  },
  CASHIER: {
    name: 'Cashier',
    scope: 'STATION' as const,
    description: 'Shift operations, cash collection, credit receipts and customer payments.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.TANKS_READ, P.DISPENSERS_READ,
      P.READINGS_READ, P.SHIFTS_READ, P.SHIFTS_OPEN, P.SHIFTS_CLOSE,
      P.SALES_READ, P.SALES_WRITE, P.CUSTOMERS_READ, P.PAYMENTS_READ,
      P.PAYMENTS_WRITE, P.EXPENSES_READ, P.RECONCILIATION_READ,
      P.RECONCILIATION_WRITE, P.REPORTS_READ, P.DENSITY_READ, P.DENSITY_WRITE,
      P.LUBRICANTS_READ, P.LUBRICANTS_WRITE, P.ATTENDANCE_READ,
    ] as Permission[],
  },
  OPERATOR: {
    name: 'Fuel Operator',
    scope: 'STATION' as const,
    description: 'Captures nozzle readings and operates the assigned shift.',
    permissions: [
      P.STATIONS_READ, P.PRODUCTS_READ, P.DISPENSERS_READ, P.READINGS_READ,
      P.READINGS_MANUAL, P.SHIFTS_READ, P.SHIFTS_OPEN, P.SHIFTS_CLOSE,
      P.SALES_READ, P.DENSITY_READ, P.DENSITY_WRITE, P.LUBRICANTS_READ,
      P.ATTENDANCE_READ,
    ] as Permission[],
  },
} as const;

export type RoleKey = keyof typeof ROLE_DEFINITIONS;

export const ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as RoleKey[];

export function permissionsForRole(role: string): Permission[] {
  const def = ROLE_DEFINITIONS[role as RoleKey];
  return def ? [...def.permissions] : [];
}
