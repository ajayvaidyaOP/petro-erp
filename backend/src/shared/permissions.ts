/** Fine-grained permissions. Roles are bundles of these, evaluated server-side. */
export const PERMISSIONS = {
  // platform (SaaS super admin only — never grantable to pump staff)
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

/**
 * Permissions an owner may hand to a staff login.
 * Team administration and platform access stay with the owner so a cashier
 * cannot create another admin.
 */
export const STAFF_GRANTABLE: Permission[] = Object.values(P).filter(
  (permission) =>
    permission !== P.PLATFORM_MANAGE &&
    permission !== P.PLATFORM_AUDIT &&
    permission !== P.EMPLOYEES_WRITE,
);

const GRANTABLE = new Set<string>(STAFF_GRANTABLE);

export interface PermissionGroup {
  id: string;
  label: string;
  hint: string;
  sensitive?: boolean;
  permissions: { key: Permission; label: string }[];
}

/** Checkbox groups shown when the owner creates a staff login. */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'forecourt',
    label: 'Shifts & readings',
    hint: 'Nozzle readings, shift open/close, density register.',
    permissions: [
      { key: P.SHIFTS_READ, label: 'View shifts' },
      { key: P.SHIFTS_OPEN, label: 'Open a shift' },
      { key: P.SHIFTS_CLOSE, label: 'Close a shift' },
      { key: P.SHIFTS_APPROVE, label: 'Approve a flagged shift' },
      { key: P.READINGS_READ, label: 'View meter readings' },
      { key: P.READINGS_MANUAL, label: 'Enter manual readings' },
      { key: P.DENSITY_READ, label: 'View density register' },
      { key: P.DENSITY_WRITE, label: 'Record density' },
      { key: P.DAYCLOSE_MANAGE, label: 'Day close / reopen' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock & deliveries',
    hint: 'Tanks, tanker receipts, lubricants.',
    permissions: [
      { key: P.STOCK_READ, label: 'View tank stock' },
      { key: P.STOCK_WRITE, label: 'Adjust or transfer stock' },
      { key: P.TANKS_READ, label: 'View tanks' },
      { key: P.TANKS_WRITE, label: 'Edit tanks' },
      { key: P.DELIVERIES_READ, label: 'View deliveries' },
      { key: P.DELIVERIES_WRITE, label: 'Record a delivery' },
      { key: P.LUBRICANTS_READ, label: 'View lubricants' },
      { key: P.LUBRICANTS_WRITE, label: 'Sell or receive lubricants' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales & credit',
    hint: 'Nozzle sales and fleet udhaar.',
    permissions: [
      { key: P.SALES_READ, label: 'View fuel sales' },
      { key: P.SALES_WRITE, label: 'Post a credit slip' },
      { key: P.CUSTOMERS_READ, label: 'View customers' },
      { key: P.CUSTOMERS_WRITE, label: 'Add customers & follow-ups' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    hint: 'Collections, expenses, suppliers, reconciliation, reports.',
    permissions: [
      { key: P.PAYMENTS_READ, label: 'View payments' },
      { key: P.PAYMENTS_WRITE, label: 'Record payments' },
      { key: P.EXPENSES_READ, label: 'View expenses' },
      { key: P.EXPENSES_WRITE, label: 'Record expenses' },
      { key: P.SUPPLIERS_READ, label: 'View suppliers' },
      { key: P.SUPPLIERS_WRITE, label: 'Edit suppliers' },
      { key: P.RECONCILIATION_READ, label: 'View reconciliation' },
      { key: P.RECONCILIATION_WRITE, label: 'Close reconciliation' },
      { key: P.REPORTS_READ, label: 'View, download and share reports' },
    ],
  },
  {
    id: 'people',
    label: 'Attendance',
    hint: 'Who was on the forecourt. Creating logins stays with the owner.',
    permissions: [
      { key: P.ATTENDANCE_READ, label: 'View attendance' },
      { key: P.ATTENDANCE_WRITE, label: 'Mark attendance' },
      { key: P.EMPLOYEES_READ, label: 'See the team list' },
    ],
  },
  {
    id: 'setup',
    label: 'Setup (sensitive)',
    hint: 'Prices, pumps and settings. Give these only to someone you trust.',
    sensitive: true,
    permissions: [
      { key: P.STATIONS_READ, label: 'View pumps' },
      { key: P.STATIONS_WRITE, label: 'Edit pumps' },
      { key: P.PRODUCTS_READ, label: 'View products' },
      { key: P.PRODUCTS_WRITE, label: 'Edit products' },
      { key: P.PRICES_WRITE, label: 'Change fuel prices' },
      { key: P.DISPENSERS_READ, label: 'View dispensers' },
      { key: P.DISPENSERS_WRITE, label: 'Edit dispensers' },
      { key: P.DEVICES_READ, label: 'View devices' },
      { key: P.DEVICES_WRITE, label: 'Register devices' },
      { key: P.COMPLIANCE_READ, label: 'View licences' },
      { key: P.COMPLIANCE_WRITE, label: 'Edit licences' },
      { key: P.AUDIT_READ, label: 'View audit log' },
      { key: P.SETTINGS_READ, label: 'View settings' },
      { key: P.SETTINGS_WRITE, label: 'Change settings' },
      { key: P.BILLING_READ, label: 'View subscription' },
    ],
  },
];

export interface StaffPreset {
  key: string;
  label: string;
  description: string;
  permissions: Permission[];
}

const managerPermissions: Permission[] = [
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
];

/** One-click starting points. The owner can still tick or untick anything after. */
export const STAFF_PRESETS: StaffPreset[] = [
  {
    key: 'attendant',
    label: 'Pump attendant',
    description: 'Open a shift and enter nozzle readings. No money, no prices.',
    permissions: [P.SHIFTS_READ, P.SHIFTS_OPEN, P.READINGS_READ, P.READINGS_MANUAL, P.SALES_READ, P.STOCK_READ, P.DENSITY_READ],
  },
  {
    key: 'cashier',
    label: 'Cashier',
    description: 'Close the shift, count cash, take payments and record expenses.',
    permissions: [
      P.SHIFTS_READ, P.SHIFTS_CLOSE, P.SALES_READ, P.CUSTOMERS_READ,
      P.PAYMENTS_READ, P.PAYMENTS_WRITE, P.EXPENSES_READ, P.EXPENSES_WRITE,
      P.RECONCILIATION_READ, P.REPORTS_READ,
    ],
  },
  {
    key: 'accountant',
    label: 'Accountant',
    description: 'Reports, udhaar, suppliers and reconciliation. No price changes.',
    permissions: [
      P.REPORTS_READ, P.CUSTOMERS_READ, P.CUSTOMERS_WRITE, P.PAYMENTS_READ,
      P.EXPENSES_READ, P.SUPPLIERS_READ, P.RECONCILIATION_READ, P.RECONCILIATION_WRITE,
      P.AUDIT_READ, P.LUBRICANTS_READ, P.STOCK_READ,
    ],
  },
  {
    key: 'supervisor',
    label: 'Shift supervisor',
    description: 'Day-to-day operations at assigned pumps, without prices or settings.',
    permissions: managerPermissions,
  },
];

/** Fixed seats. Staff logins are separate and can be many. */
export const ROLE_DEFINITIONS = {
  OWNER: {
    name: 'Owner',
    label: 'Owner',
    scope: 'TENANT' as const,
    description: 'Full control of pumps, prices, finance, team and settings.',
    permissions: Object.values(P).filter(
      (permission) => permission !== P.PLATFORM_MANAGE && permission !== P.PLATFORM_AUDIT,
    ) as Permission[],
  },
  MANAGER: {
    name: 'Manager',
    label: 'Manager',
    scope: 'STATION' as const,
    description: 'Daily shifts, readings, stock, deliveries, credit and expenses.',
    permissions: managerPermissions,
  },
  STAFF: {
    name: 'Staff',
    label: 'Staff',
    scope: 'STATION' as const,
    description: 'Login with only the permissions the owner ticked for this person.',
    permissions: [] as Permission[],
  },
} as const;

export type BusinessRoleKey = keyof typeof ROLE_DEFINITIONS;
export const BUSINESS_ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as BusinessRoleKey[];
/** Seats that stay unique per organisation. Staff is intentionally not in this list. */
export const UNIQUE_SEAT_ROLES = ['OWNER', 'MANAGER'] as const;

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
export const RETIRED_ROLE_KEYS = ['ACCOUNTANT', 'CASHIER', 'OPERATOR'] as const;

export function permissionsForRole(role: string): Permission[] {
  const def = SYSTEM_ROLE_DEFINITIONS[role as RoleKey];
  return def ? [...def.permissions] : [];
}

/** Drop anything a staff login must never hold, including forged platform rights. */
export function sanitizeStaffGrants(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const grants: Permission[] = [];
  for (const value of input) {
    const key = String(value);
    if (!GRANTABLE.has(key) || seen.has(key)) continue;
    seen.add(key);
    grants.push(key as Permission);
  }
  return grants;
}
