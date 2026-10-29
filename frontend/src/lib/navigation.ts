export interface NavigationItem {
  to: string;
  label: string;
  permission: string;
  end?: boolean;
}

export type NavigationGroup = 'Forecourt Operations' | 'Sales & Accounting' | 'Workspace & Setup';

export interface NavigationSection extends NavigationItem {
  group: NavigationGroup;
  description: string;
  children: NavigationItem[];
}

/** Eight everyday destinations grouped by operational domain. Specialist tools live inside their parent section. */
export const navigation: NavigationSection[] = [
  {
    to: '/',
    label: 'Overview',
    group: 'Forecourt Operations',
    description: 'Live station telemetry & daily command',
    permission: 'reports.read',
    end: true,
    children: [],
  },
  {
    to: '/shifts',
    label: 'Shifts & readings',
    group: 'Forecourt Operations',
    description: 'Shift lifecycle, totalizers & density register',
    permission: 'shifts.read',
    children: [
      { to: '/shifts', label: 'Shifts', permission: 'shifts.read' },
      { to: '/readings', label: 'Meter readings', permission: 'readings.read' },
      { to: '/density', label: 'Density check', permission: 'density.read' },
    ],
  },
  {
    to: '/tanks',
    label: 'Stock & deliveries',
    group: 'Forecourt Operations',
    description: 'Underground tanks, TT receipts & lubricants',
    permission: 'stock.read',
    children: [
      { to: '/tanks', label: 'Tank stock', permission: 'stock.read' },
      { to: '/deliveries', label: 'Deliveries', permission: 'deliveries.read' },
      { to: '/lubricants', label: 'Lubricants', permission: 'lubricants.read' },
    ],
  },
  {
    to: '/sales',
    label: 'Sales & credit',
    group: 'Sales & Accounting',
    description: 'Nozzle sales & fleet customer credit',
    permission: 'sales.read',
    children: [
      { to: '/sales', label: 'Fuel sales', permission: 'sales.read' },
      { to: '/customers', label: 'Customer credit', permission: 'customers.read' },
    ],
  },
  {
    to: '/finance',
    label: 'Finance',
    group: 'Sales & Accounting',
    description: 'Collections, expenses, payables & reconciliation',
    permission: 'payments.read',
    children: [
      { to: '/finance', label: 'Payments & expenses', permission: 'payments.read' },
      { to: '/suppliers', label: 'Suppliers', permission: 'suppliers.read' },
      { to: '/reconciliation', label: 'Reconciliation', permission: 'reconciliation.read' },
    ],
  },
  {
    to: '/reports',
    label: 'Reports',
    group: 'Sales & Accounting',
    description: 'DSR, stock loss norms, ageing & CSV exports',
    permission: 'reports.read',
    children: [],
  },
  {
    to: '/employees',
    label: 'Team',
    group: 'Workspace & Setup',
    description: 'Owner & manager access and attendance',
    permission: 'employees.read',
    children: [],
  },
  {
    to: '/settings',
    label: 'Settings',
    group: 'Workspace & Setup',
    description: 'Outlets, prices, dispensers, gateways & compliance',
    permission: 'settings.read',
    children: [
      { to: '/settings', label: 'General', permission: 'settings.read' },
      { to: '/stations', label: 'Pumps', permission: 'stations.read' },
      { to: '/products', label: 'Products & prices', permission: 'products.read' },
      { to: '/dispensers', label: 'Dispensers', permission: 'dispensers.read' },
      { to: '/devices', label: 'Devices', permission: 'devices.read' },
      { to: '/compliance', label: 'Licences', permission: 'compliance.read' },
      { to: '/audit', label: 'Audit log', permission: 'audit.read' },
      { to: '/billing', label: 'Subscription', permission: 'billing.read' },
    ],
  },
];

export function activeSection(pathname: string) {
  return navigation.find(
    (section) => section.to === pathname || section.children.some((child) => child.to === pathname),
  );
}
