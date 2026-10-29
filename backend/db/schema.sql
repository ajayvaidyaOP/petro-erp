-- ============================================================================
-- PetroFlow ERP — core relational schema
-- ----------------------------------------------------------------------------
-- Portable DDL. The running demo database uses the Node.js built-in SQLite
-- engine (see README.md). All monetary and measured
-- quantities are stored as exact decimal TEXT values; application code performs
-- arithmetic with Decimal.js (never IEEE-754 floats).
-- backend/db/mysql/schema.sql is generated from this file for a future MySQL review.
-- ============================================================================
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- tenancy ---
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  legal_name TEXT,
  gstin TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',          -- ACTIVE | SUSPENDED | PENDING
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  monthly_price TEXT NOT NULL DEFAULT '0',
  annual_price TEXT NOT NULL DEFAULT '0',
  max_stations INTEGER NOT NULL DEFAULT 1,
  max_users INTEGER NOT NULL DEFAULT 5,
  max_dispensers INTEGER NOT NULL DEFAULT 4,
  features TEXT NOT NULL DEFAULT '[]',
  trial_days INTEGER NOT NULL DEFAULT 14,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'TRIALING',        -- TRIALING | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  trial_ends_at TEXT,
  seats INTEGER NOT NULL DEFAULT 5,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id, status);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount TEXT NOT NULL,
  tax_amount TEXT NOT NULL DEFAULT '0',
  total_amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ISSUED',          -- ISSUED | PAID | OVERDUE | VOID
  issued_at TEXT NOT NULL,
  due_at TEXT,
  paid_at TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_tenant ON subscription_invoices(tenant_id, status);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status TEXT NOT NULL DEFAULT 'ACTIVE',          -- ACTIVE | INACTIVE
  opening_date TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_stations_tenant ON stations(tenant_id, status);

-- ------------------------------------------------------------- identity ----
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'STATION',          -- PLATFORM | TENANT | STATION
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE RESTRICT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',          -- ACTIVE | DISABLED
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  granted_permissions TEXT NOT NULL DEFAULT '[]', -- STAFF only; owner/manager use the role bundle
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id, status);

CREATE TABLE IF NOT EXISTS user_station_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

-- --------------------------------------------------------- master data -----
CREATE TABLE IF NOT EXISTS fuel_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'PETROL',        -- PETROL | DIESEL | CNG | LUBRICANT
  unit TEXT NOT NULL DEFAULT 'L',
  color TEXT NOT NULL DEFAULT '#38bdf8',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS fuel_prices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  station_id TEXT REFERENCES stations(id) ON DELETE RESTRICT,
  rate_per_litre TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  note TEXT,
  created_by TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_product ON fuel_prices(product_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_tenant ON fuel_prices(tenant_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_station ON fuel_prices(station_id, effective_from);

CREATE TABLE IF NOT EXISTS tanks (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  capacity_litres TEXT NOT NULL,
  dead_stock_litres TEXT NOT NULL DEFAULT '0',
  calibration_reference TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (station_id, code)
);

CREATE TABLE IF NOT EXISTS tank_calibration_points (
  id TEXT PRIMARY KEY,
  tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  dip_cm TEXT NOT NULL,
  litres TEXT NOT NULL,
  UNIQUE (tank_id, dip_cm)
);

CREATE TABLE IF NOT EXISTS tank_measurements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE RESTRICT,
  measured_at TEXT NOT NULL,
  dip_cm TEXT,
  water_dip_cm TEXT,
  measured_litres TEXT NOT NULL,
  book_stock_litres TEXT NOT NULL,
  variance_litres TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'MANUAL',          -- DIP | MANUAL | AUTOMATED
  source TEXT,
  entered_by TEXT,
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tank_measurements_tank ON tank_measurements(tank_id, measured_at);

CREATE TABLE IF NOT EXISTS dispensers (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  model TEXT,
  serial_number TEXT NOT NULL,
  protocol TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',          -- ACTIVE | OFFLINE | MAINTENANCE
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (station_id, code),
  UNIQUE (station_id, serial_number)
);

CREATE TABLE IF NOT EXISTS nozzles (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  dispenser_id TEXT NOT NULL REFERENCES dispensers(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  tank_id TEXT REFERENCES tanks(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  totalizer_unit TEXT NOT NULL DEFAULT 'L',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (dispenser_id, number)
);

-- -------------------------------------------------------- hardware layer ---
CREATE TABLE IF NOT EXISTS hardware_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'GATEWAY',           -- GATEWAY | CONTROLLER
  vendor TEXT,
  model TEXT,
  serial_number TEXT,
  protocol TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE',         -- ONLINE | OFFLINE | DISABLED
  api_key_hash TEXT NOT NULL,
  api_key_prefix TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  last_heartbeat_at TEXT,
  last_sync_at TEXT,
  firmware_version TEXT,
  is_simulated INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_station ON hardware_devices(station_id, status);

CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES hardware_devices(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',          -- ACTIVE | ROTATED | REVOKED
  created_by TEXT,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  UNIQUE (device_id, version)
);

CREATE TABLE IF NOT EXISTS device_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL REFERENCES hardware_devices(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,                       -- TOTALIZER_SNAPSHOT | TRANSACTION
  sequence INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',        -- RECEIVED | PROCESSED | DUPLICATE | REJECTED | ERROR
  error TEXT,
  processed_at TEXT,
  source_ip TEXT,
  UNIQUE (device_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_device_events_status ON device_events(device_id, status);
CREATE INDEX IF NOT EXISTS idx_device_events_station ON device_events(station_id, received_at);

CREATE TABLE IF NOT EXISTS device_error_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES hardware_devices(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_errors_device ON device_error_logs(device_id, created_at);

CREATE TABLE IF NOT EXISTS meter_readings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  nozzle_id TEXT NOT NULL REFERENCES nozzles(id) ON DELETE RESTRICT,
  device_id TEXT REFERENCES hardware_devices(id) ON DELETE SET NULL,
  device_event_id TEXT UNIQUE REFERENCES device_events(id) ON DELETE SET NULL,
  reading_value TEXT NOT NULL,
  unit TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'DEVICE',          -- DEVICE | SIMULATOR | MANUAL | GATEWAY_REPLAY
  quality TEXT NOT NULL DEFAULT 'VALID',          -- VALID | SUSPICIOUS | NEGATIVE | STALE | RESET | GAP
  reading_at TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  delta_litres TEXT,
  previous_reading_id TEXT REFERENCES meter_readings(id) ON DELETE SET NULL,
  is_countable INTEGER NOT NULL DEFAULT 1,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meter_readings_nozzle ON meter_readings(nozzle_id, reading_at);
CREATE INDEX IF NOT EXISTS idx_meter_readings_station ON meter_readings(station_id, reading_at);

-- ---------------------------------------------------- shifts & sales -------
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  shift_number INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  operator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  opened_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',            -- OPEN | CLOSED | FLAGGED | REVERSED
  total_litres TEXT NOT NULL DEFAULT '0',
  total_value TEXT NOT NULL DEFAULT '0',
  opening_cash TEXT NOT NULL DEFAULT '0',
  closing_cash TEXT NOT NULL DEFAULT '0',
  cash_counted TEXT,
  short_excess TEXT,
  notes TEXT,
  close_notes TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (station_id, business_date, shift_number)
);
CREATE INDEX IF NOT EXISTS idx_shifts_station ON shifts(station_id, business_date);

CREATE TABLE IF NOT EXISTS shift_nozzle_readings (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  nozzle_id TEXT NOT NULL REFERENCES nozzles(id) ON DELETE RESTRICT,
  opening_reading TEXT,
  closing_reading TEXT,
  opening_reading_id TEXT REFERENCES meter_readings(id) ON DELETE SET NULL,
  closing_reading_id TEXT REFERENCES meter_readings(id) ON DELETE SET NULL,
  opening_source TEXT,
  closing_source TEXT,
  litres_sold TEXT,
  testing_litres TEXT NOT NULL DEFAULT '0',
  operator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  rate TEXT,
  sales_value TEXT,
  variance_litres TEXT,
  adjustment_litres TEXT NOT NULL DEFAULT '0',
  adjustment_reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',         -- PENDING | CAPTURED | FLAGGED | APPROVED
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shift_id, nozzle_id)
);
CREATE INDEX IF NOT EXISTS idx_shift_nozzles_shift ON shift_nozzle_readings(shift_id);

CREATE TABLE IF NOT EXISTS fuel_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  shift_id TEXT REFERENCES shifts(id) ON DELETE RESTRICT,
  nozzle_id TEXT REFERENCES nozzles(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  quantity_litres TEXT NOT NULL,
  rate TEXT NOT NULL,
  amount TEXT NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',      -- CASH | UPI | CARD | BANK | CREDIT
  customer_id TEXT,
  occurred_at TEXT NOT NULL,
  reference TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL',          -- TOTALIZER_AGGREGATE | MANUAL | DEVICE_TRANSACTION
  is_estimated INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  reversal_of TEXT,
  voided_at TEXT,
  void_reason TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_fuel_tx_station ON fuel_transactions(station_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fuel_tx_shift ON fuel_transactions(shift_id);

-- ------------------------------------------------------ supply & stock -----
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  gstin TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  credit_days INTEGER NOT NULL DEFAULT 0,
  opening_balance TEXT NOT NULL DEFAULT '0',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE RESTRICT,
  quantity_litres TEXT NOT NULL,
  received_litres TEXT,
  rate_per_litre TEXT NOT NULL,
  taxable_amount TEXT NOT NULL,
  tax_amount TEXT NOT NULL DEFAULT '0',
  total_amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',           -- DRAFT | RECEIVED | DISPUTED
  received_at TEXT,
  vehicle_number TEXT,
  driver_name TEXT,
  dip_before_cm TEXT,
  dip_after_cm TEXT,
  density_invoice TEXT,
  density_observed TEXT,
  temp_observed_c TEXT,
  density_at_15c TEXT,
  tt_seal_numbers TEXT,
  sample_seal_no TEXT,
  chamber_details TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, supplier_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_station ON deliveries(station_id, invoice_date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,                             -- OPENING | DELIVERY | DISPENSED | ADJUSTMENT | TRANSFER_IN | TRANSFER_OUT
  quantity_litres TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tank ON stock_movements(tank_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(reference_type, reference_id);

-- ------------------------------------------------------ credit & money -----
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  address TEXT,
  credit_limit TEXT NOT NULL DEFAULT '0',
  credit_days INTEGER NOT NULL DEFAULT 0,
  balance TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS credit_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,                             -- CREDIT_SALE | PAYMENT | ADJUSTMENT
  amount TEXT NOT NULL,
  slip_number TEXT,
  vehicle_number TEXT,
  driver_name TEXT,
  product_id TEXT REFERENCES fuel_products(id) ON DELETE SET NULL,
  quantity_litres TEXT,
  rate_per_litre TEXT,
  reference TEXT,
  occurred_at TEXT NOT NULL,
  due_date TEXT,
  transaction_id TEXT,
  payment_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_entries_customer ON credit_entries(customer_id, occurred_at);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL,                        -- RECEIPT | PAYOUT
  party_type TEXT NOT NULL,                       -- CUSTOMER | SUPPLIER
  customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'CASH',              -- CASH | UPI | CARD | BANK
  reference TEXT,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED',          -- POSTED | SETTLED | REVERSED
  settlement_ref TEXT,
  settled_at TEXT,
  notes TEXT,
  created_by TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_payments_station ON payments(station_id, occurred_at);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  paid_via TEXT NOT NULL DEFAULT 'CASH',
  reference TEXT,
  note TEXT,
  created_by TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_station ON expenses(station_id, occurred_at);

CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'CASH',              -- CASH | STOCK | SHIFT
  shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  cash_expected TEXT NOT NULL DEFAULT '0',
  cash_counted TEXT NOT NULL DEFAULT '0',
  digital_expected TEXT NOT NULL DEFAULT '0',
  digital_settled TEXT NOT NULL DEFAULT '0',
  variance TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'OPEN',            -- OPEN | BALANCED | VARIANCE | APPROVED
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconciliations_station ON reconciliations(station_id, business_date);

-- --------------------------------------------------- governance & system ---
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  station_id TEXT,
  actor_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  before_data TEXT,
  after_data TEXT,
  ip TEXT,
  user_agent TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (tenant_id, scope, key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  station_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, station_id, key)
);

CREATE TABLE IF NOT EXISTS platform_errors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  path TEXT,
  severity TEXT NOT NULL DEFAULT 'ERROR',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_errors_created ON platform_errors(created_at);


-- ------------------------------------------------ pump operations pack -----
-- Daily density register: subah ki density check jo OMC inspection me
-- sabse pehle mangi jati hai. Density values kg/m3 me (e.g. 742.5).
CREATE TABLE IF NOT EXISTS density_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  observed_density TEXT NOT NULL,
  observed_temp_c TEXT NOT NULL,
  density_at_15c TEXT NOT NULL,
  spec_min TEXT,
  spec_max TEXT,
  within_spec INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'NOZZLE',          -- NOZZLE | TANK | TT_SAMPLE
  checked_by TEXT,
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_density_station_date ON density_checks(station_id, business_date);

-- Shift closing cash denomination count (₹500 x n, ₹200 x n, ...).
CREATE TABLE IF NOT EXISTS shift_cash_denominations (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  denomination INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  amount TEXT NOT NULL DEFAULT '0',
  UNIQUE (shift_id, denomination)
);

-- Shift paise ka milaan: mode-wise expected (system) vs received (galla).
CREATE TABLE IF NOT EXISTS shift_settlements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL,                             -- CASH | UPI | CARD | BANK | CREDIT
  expected_amount TEXT NOT NULL DEFAULT '0',
  received_amount TEXT,
  difference_amount TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (shift_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_shift_settlements_shift ON shift_settlements(shift_id);

-- Roznamcha: din band hone ke baad purani date ki entries lock.
CREATE TABLE IF NOT EXISTS day_closings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CLOSED',          -- CLOSED | REOPENED
  closed_by TEXT,
  closed_at TEXT NOT NULL,
  reopened_by TEXT,
  reopened_at TEXT,
  reopen_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (station_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_day_closings_station ON day_closings(station_id, business_date);

-- Credit customer ki gaadiyan (fleet) — slip par gaadi number ke liye.
CREATE TABLE IF NOT EXISTS customer_vehicles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_number TEXT NOT NULL,
  vehicle_type TEXT,
  driver_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (customer_id, vehicle_number)
);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON customer_vehicles(customer_id);

-- Licence / stamping / NOC expiry tracking.
CREATE TABLE IF NOT EXISTS compliance_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  dispenser_id TEXT REFERENCES dispensers(id) ON DELETE SET NULL,
  tank_id TEXT REFERENCES tanks(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL,                         -- PESO_LICENCE | WM_STAMPING | FIRE_NOC | ...
  title TEXT NOT NULL,
  doc_number TEXT,
  authority TEXT,
  issued_on TEXT,
  expires_on TEXT NOT NULL,
  renewal_lead_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_station ON compliance_documents(station_id, expires_on);

-- Lubricants / NFR: pack-wise items (engine oil, 2T, coolant, grease...).
CREATE TABLE IF NOT EXISTS lube_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  pack_size TEXT NOT NULL DEFAULT '1 L',
  hsn_code TEXT,
  gst_rate_pct TEXT NOT NULL DEFAULT '18',
  purchase_rate TEXT NOT NULL DEFAULT '0',
  sale_rate TEXT NOT NULL DEFAULT '0',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS lube_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES lube_products(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,                             -- OPENING | PURCHASE | SALE | ADJUSTMENT
  quantity TEXT NOT NULL,                         -- signed: + andar, - bahar
  rate TEXT NOT NULL DEFAULT '0',
  amount TEXT NOT NULL DEFAULT '0',
  payment_mode TEXT,                              -- CASH | UPI | CARD | BANK | CREDIT (SALE par)
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_number TEXT,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  reference TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lube_movements_station ON lube_movements(station_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lube_movements_product ON lube_movements(product_id, occurred_at);

-- Staff haaziri (users hi employees hain is system me).
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PRESENT',         -- PRESENT | ABSENT | HALF_DAY | leave | WEEK_OFF
  in_time TEXT,
  out_time TEXT,
  note TEXT,
  marked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_station_date ON attendance_records(station_id, attendance_date);

-- Credit CRM: calls, visits and promise-to-pay notes. Not a second ledger.
CREATE TABLE IF NOT EXISTS customer_followups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'NOTE',              -- CALL | VISIT | PROMISE | NOTE
  note TEXT NOT NULL,
  promised_amount TEXT,
  next_on TEXT,                                   -- YYYY-MM-DD, when to call again
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON customer_followups(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_followups_due ON customer_followups(tenant_id, next_on);
