export interface NavigationItem {
  to: string;
  label: string;
  permission: string;
  end?: boolean;
}

export interface NavigationSection extends NavigationItem {
  description: string;
  children: NavigationItem[];
}

/** Eight everyday destinations. Specialist tools live inside their parent section. */
export const navigation: NavigationSection[] = [
  { to: '/', label: 'Overview', description: 'Your pump at a glance', permission: 'reports.read', end: true, children: [] },
  { to: '/shifts', label: 'Shifts & readings', description: 'Open, record and close the day', permission: 'shifts.read', children: [
    { to: '/shifts', label: 'Shifts', permission: 'shifts.read' },
    { to: '/readings', label: 'Meter readings', permission: 'readings.read' },
    { to: '/density', label: 'Density check', permission: 'density.read' },
  ] },
  { to: '/tanks', label: 'Stock & deliveries', description: 'Fuel stock, tanks and receipts', permission: 'stock.read', children: [
    { to: '/tanks', label: 'Tank stock', permission: 'stock.read' },
    { to: '/deliveries', label: 'Deliveries', permission: 'deliveries.read' },
    { to: '/lubricants', label: 'Lubricants', permission: 'lubricants.read' },
  ] },
  { to: '/sales', label: 'Sales & credit', description: 'Nozzle sales and customer udhaar', permission: 'sales.read', children: [
    { to: '/sales', label: 'Fuel sales', permission: 'sales.read' },
    { to: '/customers', label: 'Customer credit', permission: 'customers.read' },
  ] },
  { to: '/finance', label: 'Finance', description: 'Expenses, payments and balances', permission: 'payments.read', children: [
    { to: '/finance', label: 'Payments & expenses', permission: 'payments.read' },
    { to: '/suppliers', label: 'Suppliers', permission: 'suppliers.read' },
    { to: '/reconciliation', label: 'Reconciliation', permission: 'reconciliation.read' },
  ] },
  { to: '/reports', label: 'Reports', description: 'Daily reports and CSV exports', permission: 'reports.read', children: [] },
  { to: '/employees', label: 'Team', description: 'One owner. One manager.', permission: 'employees.read', children: [] },
  { to: '/settings', label: 'Settings', description: 'Pump setup and advanced tools', permission: 'settings.read', children: [
    { to: '/settings', label: 'General', permission: 'settings.read' },
    { to: '/stations', label: 'Pumps', permission: 'stations.read' },
    { to: '/products', label: 'Products & prices', permission: 'products.read' },
    { to: '/dispensers', label: 'Dispensers', permission: 'dispensers.read' },
    { to: '/devices', label: 'Devices', permission: 'devices.read' },
    { to: '/compliance', label: 'Licences', permission: 'compliance.read' },
    { to: '/audit', label: 'Audit log', permission: 'audit.read' },
    { to: '/billing', label: 'Subscription', permission: 'billing.read' },
  ] },
];

export function activeSection(pathname: string) {
  return navigation.find((section) => section.to === pathname || section.children.some((child) => child.to === pathname));
}
