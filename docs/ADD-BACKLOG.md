# PetroFlow ERP — "Isme kya-kya ADD karna hai" (implementation backlog)

> Date: 2026-10-29 · Companion to `docs/PETROL-PUMP-ERP-GAP-REPORT.md` (wo "kya missing hai" ke liye, ye "kaise add karein" ke liye).
> Har item me **exact files** di hain — repo ki current wiring follow ki gayi hai, isiliye developer ko dhundhna nahi padega.

---

## 0. Pehle: repo me feature add karne ka standard pattern (yaad rakhne layak)

| Kya add karna hai | Kahan karo | Note |
|---|---|---|
| **Nayi table** | `db/schema.sql` me `CREATE TABLE IF NOT EXISTS …` | Boot par `migrate()` chala deta hai (`backend/src/db/index.ts:82`) — alag migration file nahi chahiye |
| **Purani table me naya column** | `backend/src/db/index.ts` → `COLUMN_MIGRATIONS` array (line ~43) | Format: `['table','column','ALTER TABLE … ADD COLUMN …']`. Idempotent; purana DB khud upgrade ho jayega |
| **Naya permission** | `packages/shared/src/permissions.ts` → `PERMISSIONS`, phir **`ROLE_DEFINITIONS.MANAGER.permissions` me bhi daalo** | ⚠️ Manager list me nahi daala to manager ko 403 milega (ye logo ne 15 baar galat kiya hai) |
| **Naya router/endpoints** | `backend/src/routes/<module>.ts` → `export const xRouter` → mount in `backend/src/app.ts` (~line 140): `v1.use('/x', requireAuth, xRouter)` | `requireAuth` mount me hi lagao, router ke andar bhi `router.use(requireAuth)` hai (dono safe) |
| **Master data CRUD** | `backend/src/routes/catalog.ts` me `makeCrudRouter({...})` (pattern: `customerCrud` line ~558) | Pagination, search, sort, audit, soft-delete helper already milte hain |
| **Naya settings key** | `backend/src/routes/settings.ts` → `ALLOWED_KEYS` (line 20) + `DEFAULTS` (line 61) | Allow-list hai — key add na kiya to `Unknown setting` error |
| **Naya screen** | `frontend/src/pages/X.tsx` → `App.tsx` `pages` array (line ~76) `[path, Page, 'x.read']` → `frontend/src/lib/navigation.ts` me entry | Lazy import mat bhoolna; nav me `permission` daalo warna manager ko dikhega/na dikhega inconsistent |
| **CSV export** | `backend/src/routes/reports.ts` → `sendCsv(res, filename, header, rows)` helper (line 776) | Frontend me `apiDownload('/reports/export/x.csv?…')` (`Reports.tsx:526`) |
| **Dashboard alert** | `backend/src/routes/reports.ts` (owner-dashboard alerts array) + `frontend/src/lib/alerts.ts` `buildAttentionItems` | Har alert par `to:` route lagta hai (`alerts.test.ts` isko enforce karta hai) |
| **Demo data** | `backend/src/db/seed.ts` (sirf **empty DB** par chalta hai — existing DB touch nahi hota) | Har row me `is_demo=1`, fixed `rngState` seed use karo (deterministic) |
| **Money/litres maths** | `backend/src/lib/decimal.ts` → `D()`, `money()`, `fmtRate()` | Kabhi bhi `+`/`*` on floats nahi; DB me TEXT |
| **Lock after day close** | `assertDayOpen(stationId, businessDate)` har mutating route me | Ye pattern tod diya to Roznamcha ka matlab khatam |
| **Tests** | `backend/tests/<module>.test.ts` (vitest + supertest, 64 tests abhi) | `npm test` se chalta hai; ek e2e flow `e2e/workflows.spec.ts` me add karo |

---

## 1. 🔴 P0-A · `staff_members` — staff master data (login se alag)  ▸ *3–4 din*

**Kyun:** abhi `users` me sirf `OWNER|MANAGER` allowed (`catalog.ts:789` enum, + 1-1 cap).
Attendance `FROM users` chalti hai (`attendance.ts:26-38`) aur `shift_nozzle_readings.operator_id → users(id)`
— isliye **filler/DSM/cashier na haaziri lag sakte hain, na nozzle attribution**. Ye repo ka sabse bada
structural gap hai (Gap report §3 P0-1).

**Schema** (`db/schema.sql` + seed):
```sql
CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  code TEXT NOT NULL,                      -- "PMP-01"
  name TEXT NOT NULL,
  duty TEXT NOT NULL DEFAULT 'FILLER',      -- FILLER | DSM | CASHIER | PUMPER | ACCOUNTANT | CLEANER | OTHER
  phone TEXT,
  joined_on TEXT,
  pay_basis TEXT NOT NULL DEFAULT 'MONTHLY',-- MONTHLY | DAILY | PER_LITRE (DSM incentive)
  pay_rate TEXT NOT NULL DEFAULT '0',       -- ₹ / month ya ₹ / day  (Decimal TEXT!)
  incentive_per_kl TEXT NOT NULL DEFAULT '0',
  pf_no TEXT, esi_no TEXT, uan_no TEXT,     -- statutory (optional, plain text)
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- login se link (agar login hai)
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_staff_station ON staff_members(station_id, is_active);
```
Plus `COLUMN_MIGRATIONS` me:
- `['attendance_records','staff_id','ALTER TABLE attendance_records ADD COLUMN staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL']`
- `['shift_nozzle_readings','staff_id','ALTER TABLE shift_nozzle_readings ADD COLUMN staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL']`
- `['shifts','staff_id','ALTER TABLE shifts ADD COLUMN staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL']`
(`user_id`/`operator_id` **rename mat karo** — purana history tootega; dono accept karo, `staff_id` prefer karo.)

**API:** `makeCrudRouter` se `staff` master CRUD (`catalog.ts` pattern, `permissions:{read:'employees.read',write:'employees.write'}`,
`softDelete:true` via `is_active`) + `GET /catalog/staff?stationId=&active=1` dropdown endpoint.
**`attendance.ts` rewrite:** sheet = `staff_members (active)` **UNION** login users; upsert by `(COALESCE(staff_id,user_id), date)`;
summary me `pay_rate × payableDays + incentive` ka payable amount (₹) bhi aaye.
**`shifts.ts`:** `operatorId` ki jagah/ saath `staffId` accept karo (schema me `.optional()`), aur response me
`operatorName` staff se resolve ho.

**UI:** `Employees.tsx` (Team) me 2 blocks — **① Logins (Owner/Manager)** jaisa hai waisa, **② Staff (no login)**
naya table: add/edit/deactivate, duty, pay rate. Shift screen ke nozzle row me operator dropdown = staff list.
AttendancePanel me staff rows aa jaayein.

**Permissions:** naya key nahi chahiye — `employees.read/write` reuse karo (manager ke paas already hain).
**Test:** staff create → usse attendance mark → summary me payable ₹; nozzle row ko staff assign → closed shift report
me us staff ka naam/litres; disabled staff ko naye shift me select na kar saka (purane me naam rahe).

**⚠️ Gotchas:**
- staff delete mat karo (soft delete only) — purani shift/attendance ka attribution preserve hona chahiye. Unique `(tenant,code)` rakho.
- **Attendance ka unique constraint theek se samjho:** schema me `UNIQUE (user_id, attendance_date)` hai
  (`schema.sql:857`). Table rebuild ki zaroorat **nahi** — SQLite me NULLs unique constraint me **distinct** maane
  jaate hain, to staff rows (`user_id = NULL, staff_id = <id>`) aise hi collide nahi karenge. Bas **ek partial
  unique index add karo**:
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_staff ON attendance_records(staff_id, attendance_date) WHERE staff_id IS NOT NULL;`
  aur code me dono keys ka upsert alag-alag handle karo (`ON CONFLICT(staff_id, attendance_date)`).
  Duplicate-row safety ke liye application-level `(person, date)` dedupe bhi rakho.
- `shift_nozzle_readings` ka `UNIQUE (shift_id, nozzle_id)` **mat chhedo** — staff attribution usme column hi, key nahi.
- Naya index `schema.sql` **aur** `COLUMN_MIGRATIONS` ke paas boot-safe rakho (CREATE … IF NOT EXISTS), warna purane
  DB par boot fail karega.

---

## 2. 🔴 P0-B · Margin + Daily P&L + dealer commission  ▸ *4–5 din*

**Kyun:** `deliveries.rate_per_litre` me purchase cost **store hota hai** par koi report sales se nahi jodti.
Owner ko aaj ka munafa nahi pata. (Gap report §3 P0-2.)

**Schema:** `fuel_prices` ke paas naya table (nahi — prices me commission daalna galat hoga):
```sql
CREATE TABLE IF NOT EXISTS product_economics (      -- per tenant + station + product
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  dealer_commission_per_litre TEXT NOT NULL DEFAULT '0',   -- OMC se milne wala ₹/L
  freight_per_litre TEXT NOT NULL DEFAULT '0',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, station_id, product_id, effective_from)
);
CREATE TABLE IF NOT EXISTS tank_avg_cost (          -- moving average cost per tank (derived, cached)
  tank_id TEXT PRIMARY KEY REFERENCES tanks(id) ON DELETE CASCADE,
  avg_cost_per_litre TEXT NOT NULL,
  litres TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
**Logic:** `lib/costing.ts` (naya) — **weighted-average cost**: delivery receive hote hi
`new_avg = (old_stock×old_avg + recv_litres×(rate + freight)) / (old_stock + recv_litres)`; `DISPENSED`
movement par `COGS = net_litres × avg_cost`. Tank khaali/negative ho to last avg hold karo + note.
Formula `stock_movements` se **derive** karo, haath se editable mat rakho.

**API:**
- `GET /reports/profit?stationId=&from=&to=&groupBy=day|product|shift` → rows: litres, sale_value, cogs,
  **gross_margin**, commission, expenses(allocated), **net_profit**, margin %.
- `GET /reports/export/profit-loss.csv` + `GET /reports/export/margin-monthly.csv` (`sendCsv`).
- `POST /catalog/economics` (commission/freight set karo) — `prices.write` permission use karo (already owner-only).
**UI:** Dashboard par **"Aaj ka munafa"** KPI + margin% badge; `Reports.tsx` me **Profit & Loss** tab (day-wise +
product-wise); Products page me per-product "Commission ₹/L" + "Freight ₹/L" field; exports list me 2 naye rows.
**Constants:** `ACCOUNTING_DISCLAIMER` ko update karo — ab figures "cost-model based estimates" kehenge; P&L screen
par chhota note: "Margin = dispenser litres × moving-average cost. Excise/VAT & commission slabs are as configured."
**Test:** 1000L @ ₹96 deliver → 400L sale @ ₹103 → margin = 400×(103−96) (approx; avg-cost check) → din band
hone ke baad P&L row match kare; `npm run typecheck` ke saath Decimal exactness (₹0.01 tolerance).

---

## 3. 🔴 P0-C · Tax engine: fuel VAT/excise + NFR GST + returns  ▸ *5–6 din*

**Kyun:** fuel par **state VAT + excise ka koi model hi nahi** (`grep -i vat` → 0 hits); lubricants me HSN+GST% hai
par **GSTR-1/3B export nahi**; fleet customer ke liye printable **tax invoice** nahi. (Gap report §3 P0-3.)

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  tax_type TEXT NOT NULL,                    -- EXCISE | VAT | GST | CESS | LOCAL_CESS
  rate_pct TEXT NOT NULL,
  is_gst_applicable INTEGER NOT NULL DEFAULT 0,   -- fuel = 0 (GST ke bahar)
  hsn_sac TEXT,                              -- e.g. 27101220 / 996714
  taxability TEXT NOT NULL DEFAULT 'TAXABLE',-- TAXABLE | NIL | EXEMPT | RCT
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, station_id, product_id, tax_type, effective_from)
);
CREATE TABLE IF NOT EXISTS tax_journals (     -- har invoice/entry ka breakup, return-ready
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL, station_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  doc_type TEXT NOT NULL,                     -- FUEL_SALE | LUBE_SALE | CREDIT_INVOICE | PURCHASE | EXPENSE
  doc_id TEXT,
  party_gstin TEXT, invoice_no TEXT,
  taxable_value TEXT NOT NULL,
  cgst TEXT NOT NULL DEFAULT '0', sgst TEXT NOT NULL DEFAULT '0', igst TEXT NOT NULL DEFAULT '0',
  cess TEXT NOT NULL DEFAULT '0', vat TEXT NOT NULL DEFAULT '0',
  total TEXT NOT NULL,
  reverse_charges INTEGER NOT NULL DEFAULT 0,
  itc_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_journal_period ON tax_journals(tenant_id, business_date, doc_type);
```
**API:** `routes/tax.ts` → `/tax/rates` CRUD, `/tax/summary?from=&to=` (VAT + GST dono ka monthly breakup),
`/tax/export/gstr1.csv`, `/tax/export/gstr3b.csv`, `/tax/export/vat-return.csv`,
`GET /tax/invoice/:creditEntryId` (printable B2B invoice payload: HSN, GSTIN, qty, rate, tax breakup).
Har **new** lube sale / credit slip / delivery par `tax_journals` row likho (existing `lubricants POST /movements`
aur `finance POST /credit-sales` me hook).
**UI:** Settings → naya "Taxes" tab (state-wise VAT/-excise slab editor + HSN mapping); Customers page me
**Print tax invoice** button (statement ke bagal me); Reports me "Tax (GST + VAT)" tab + 3 naye CSV exports.
**Frontend print:** `index.css:320` ka `@media print` already hai — naya `.print-invoice` layout (A5 thermal-friendly).
**Test:** 12% VAT + 0% GST wale petrol ki sale par `tax_journals.vat` = taxable×12%, cgst=0; lube sale par
CGST+SGST = 18%/2 each; **out-of-state** lube sale par IGST; GSTR-1 CSV me B2B row tab tak na aaye jab tak
customer ka GSTIN ho (fallback B2C).
**⚠️ Honest note:** ye rates India-specific aur state-variant hain — code me **hardcode mat karo**, sirf storage +
reporting banao, aur UI me "rates as configured by dealer, verify with CA" disclaimer.

---

## 4. 🔴 P0-D · Asli hardware: Modbus/FCC + ATG adapters  ▸ *2 hafte (vendor ke bina possible nahi)*

**Kyun:** `gateway/src/adapters/modbusTcp.ts:74` → `throw new Error('Modbus adapter is not implemented…')`.
Sirf simulator verified hai. (Gap report §3 P0-4.)

**Kya banana hai:**
1. `adapters/vendorConfig.ts` — per-model **register map** (JSON config: start address, scale, word order,
   totalizer/price counters, status bits), file `gateway/registers/<vendor>-<model>.json` se load.
2. `modbusTcp.poll()` implement: read → `GatewayEvent[]` (nozzle totals litres + value + status), drift/gap
   `lib/meter.ts` rules par **already** depend karta hai — naya validation mat banao.
3. `adapters/veederRoot.ts` (ATG): level mm + water + temp + leak-alarm → `POST /v1/gateway/events`
   with `type:'ATG_SNAPSHOT'` (backend me `device_events.type` allow-list me add karo), aur `tank_measurements`
   me `method='AUTOMATED'` row banao (existing field hai — schema change nahi).
4. **Commissioning checklist** + per-device "verified" badge: `devices.ts` me `verification_status`
   (`SIMULATED | PILOT | CERTIFIED`) — sirf CERTIFIED par UI disclaimer hatega (`HARDWARE_DISCLAIMER` already hai).
5. Retries/backoff + `spool` replay already ready hai (`gateway/src/spool.ts`) — usi par chalao.
**Test:** register-map fixture se golden `GatewayEvent[]` (bytes → litres), out-of-order + duplicate eventId
idempotency check, ATG level→litres via calibration chart.
**⚠️ Reality:** asli pump ke bina ye "verified" nahi kehlayega — **do not fake it**. Agar abhi vendor nahi mila,
to isko park karo aur 1–3 + 5–7 pehle karo (manual entry speed se hi pehla faayda milega).

---

## 5. 🟠 P1-A · Payables: TT bill → payment allocation + AP ageing  ▸ *2–3 din*

**Kyun:** `payments` me `direction/supplier_id` hai **par `delivery_id` nahi** (`grep delivery_id db/schema.sql` → 0) →
kaunsa bill pending, kitna purana — pata nahi chalta. AR me due-date auto banti hai (`finance.ts:213`), AP me nahi.
(Gap report §3 P1-5.)

**Kya add karo:**
```sql
CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (payment_id, delivery_id)
);
```
- `suppliers` par `credit_days` **already** hai → delivery create karte waqt `deliveries.due_date`
  (`COLUMN_MIGRATIONS`) auto banao (customer wali same formula).
- `GET /finance/payables?asOf=` → open/ partly-paid bills + buckets (0–30/31–60/61–90/90+).
- `POST /finance/payments` me optional `allocations:[{deliveryId, amount}]` + over-allocation block.
- `GET /reports/export/payables.csv`.
- Suppliers page me **Ageing** column + "Pay" action (pre-filled allocation).
**Test:** 2 bills ₹1,00,000 + ₹50,000, payment ₹1,20,000 → oldest-first FIFO allocate → 2nd partly paid ₹30,000;
duplicate reference par `UNIQUE(tenant_id, reference)` already bachaata hai — allocation totals > payment → 422.

---

## 6. 🟠 P1-B · Bank/PG settlement auto-match + MDR charges  ▸ *2–3 din*

**Kyun:** `payments.settlement_ref`/`SETTLED` **manual** hai; **MDR/handling ka koi column nahi**
(`grep -iE "MDR|settlement_charge"` → 0 hits). Roz ke card/UPI hits ka T+2 milan aaj Excel me hota hai. (Gap report §3 P1-6.)

**Kya add karo:**
- `COLUMN_MIGRATIONS`: `['payments','gross_amount', …]`, `['payments','mdr_amount', …]`, `['payments','net_settled', …]`,
  `['payments','bank_txn_ref', …]`.
- `POST /finance/bank-statements/import` (multipart CSV upload; columns: date, ref, amount; 5k rows cap)
  → `bank_statement_rows` temp table; `POST /finance/bank-statements/:id/match` → **date-window + amount tolerance
  (₹1)** + ref-contains match; unmatched → 422 report (na auto-post, na auto-force).
- `GET /finance/settlements?from=&to=` → expected vs settled vs **charges**, mode-wise (Cash/UPI/Card/Bank).
- `reconciliations` table me `mdr_expected/mdr_actual` (naye columns) — **day-close pattern** follow karo.
- Expense auto-post mat karo (MVP me) — par summary me "₹X MDR — expense me book karna hai" dikhao +
  "Create expense rows" button (existing `POST /finance/expenses` reuse).
**Test:** 3 payments ₹100/₹250/₹1000 → CSV me 2 rows + 1 extra bank entry → matched 2, unmatched 1 both sides,
`variance` = 0 only for matched; duplicate import idempotent (same file hash → 409).

---

## 7. 🟠 P1-C · Notifications engine (email + WhatsApp/SMS) + DSR digest  ▸ *3 din*

**Kyun:** `settings.ts` me `notifications.contactEmail` **key already maujood hai** aur uska description khud kehta
hai *"Email delivery is not configured in this build"* — yani plumbing ka irada tha, code nahi. Koi `notifications`
table nahi, koi retry/history nahi. Licence expire → pata nahi chalega. (Gap report §3 P1-7.)

**Kya add karo:**
```sql
CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
  event TEXT NOT NULL,              -- LICENCE_EXPIRING | TANK_LOW | DAY_NOT_CLOSED | SHIFT_SHORT | CREDIT_OVERDUE | DSR_DAILY | TT_INDENT
  channel TEXT NOT NULL,            -- EMAIL | WHATSAPP | SMS
  target TEXT NOT NULL,             -- email / wa number / sms number
  threshold TEXT, min_level TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, station_id TEXT,
  rule_id TEXT REFERENCES notification_rules(id) ON DELETE SET NULL,
  event TEXT NOT NULL, channel TEXT NOT NULL, target TEXT NOT NULL,
  payload TEXT NOT NULL,            -- JSON text
  status TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED | SENT | FAILED | SKIPPED
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, dedupe_key TEXT,
  scheduled_for TEXT, sent_at TEXT, created_at TEXT NOT NULL,
  UNIQUE (dedupe_key)
);
```
- `lib/notify.ts`: `queueNotification(event, payload, {dedupeKey, channels})` + `dispatchOutbox()` —
  providers behind an interface: `SMTPProvider` (nodemailer), `WhatsAppCloudApiProvider` (Meta Cloud API),
  `Msg91SmsProvider`. **Env vars:** `SMTP_HOST/PORT/USER/PASS/FROM`, `WA_TOKEN`, `WA_PHONE_ID`, `MSG91_AUTH_KEY`,
  `NOTIFY_DRY_RUN=true` (default in dev → outbox me row, asli network call nahi). **Idempotency:** `dedupe_key =
  event:station:date:entityId` → duplicate nahi jayega (existing `lib/idempotency.ts` jaisa soch).
- `env.ts` me `str()` entries + `.env.example` me block (comments ke saath, koi secret commit mat karo).
- Trigger points: `complianceAlerts()` (expiry buckets 30/7/1/0 din), `reports.ts` low-tank, `shifts.ts` close par
  `|short_excess| > threshold`, `day-close` na hone par 11pm, **`cron` 07:00 IST owner DSR** (₹/L aaj ka sales,
  tank %, short, overdue udhaar).
- `GET /notifications` + `POST /notifications/test` (owner) + `POST /notifications/:id/retry`.
**UI:** Settings me "Alerts & Notifications" section (rules + test send); Team/Owner ko daily DSR preview dikhao.
**Test:** dry-run me 1 licence alert = exactly 1 outbox row (2 baar check karne par bhi — dedupe), retry on FAILED
with attempts++, DSR digest ka rendered text snapshot (WhatsApp template me ₹ + litres + tank list).

---

## 8. 🟠 P1-D · Payroll (attendance → payable ₹ → payslip)  ▸ *3 din*

**Kyun:** UI header "Monthly payroll summary" kehta hai par **`salary_structure` table nahi**, amount compute
kahin nahi hota — `attendance.ts:/summary` sirf `payableDays` return karta hai. Advance ka sirf ek demo
**expense category** hai (`seed.ts:751`) → advance employee se linked nahi. (Gap report §3 P1-8.)

**Kya add karo:** (Item 1 ke `staff_members.pay_rate/incentive_per_kl` par build)
```sql
CREATE TABLE IF NOT EXISTS payroll_records (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, station_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  month TEXT NOT NULL,                       -- YYYY-MM
  payable_days TEXT NOT NULL, present_days INTEGER NOT NULL DEFAULT 0,
  basic TEXT NOT NULL DEFAULT '0', incentive TEXT NOT NULL DEFAULT '0',
  advances_deducted TEXT NOT NULL DEFAULT '0', pf_employee TEXT NOT NULL DEFAULT '0',
  pf_employer TEXT NOT NULL DEFAULT '0', esi_employee TEXT NOT NULL DEFAULT '0', esi_employer TEXT NOT NULL DEFAULT '0',
  net_payable TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | APPROVED | PAID
  approved_by TEXT, approved_at TEXT, paid_payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (staff_id, month)
);
CREATE TABLE IF NOT EXISTS staff_advances (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL, given_on TEXT NOT NULL, settled_month TEXT, settled_amount TEXT NOT NULL DEFAULT '0',
  reason TEXT, created_by TEXT, created_at TEXT NOT NULL
);
```
- `POST /payroll/generate?stationId=&month=` → attendance + incentive + **unsettled advances** se draft banao
  (PF 12% of basic, ESI 0.75%/3.25% — **rates settings keys banao**: `payroll.pfEmployeePct` etc., hardcoded nahi).
- `POST /payroll/:id/approve` (owner-only) + `POST /payroll/:id/mark-paid` → `payments` me `direction='PAYOUT'`
  auto row (advance expense-duplication khatam).
- Payslip **print** view (`@media print`) + `GET /payroll/:id/payslip.pdf`? — PDF nahi, print-friendly HTML se shuru karo.
**UI:** Team page me **"Payroll"** tab (month picker → generate → edit → approve → mark paid); Staff drawer me
Advances list. Manager ko read-only (salary owner ka business: `payroll.read` = owner-only permission banao).
**Test:** 26 present + 2 half → payable 27 days × ₹700 = ₹18,900; advance ₹5,000 → net ₹13,900 + advance settled
mark; dobara generate → idempotent (existing draft update, duplicate nahi); closed-month approve ke baad day-close
pattern follow karo (past month lock optional — par `assertDayOpen` mat lagao payroll par, month-lock alag flag).

---

## 9. 🟠 P1-E · Backup + restore + integrity + CI  ▸ *1–2 din* ← **sabse pehle ye karo**

**Kyun:** `BACKUP_RETENTION_DAYS=14` env var **hai**, par koi backup tool nahi; `settings.ts:276` sirf text batata hai
"copy the database file… see docs/OPERATIONS.md" — **aur `docs/OPERATIONS.md` maujood hi nahi**. Ek corrupt `db/*.db` =
poora business gaya. `.github/` **nahi** → koi CI nahi (test/typecheck/build apne aap nahi chalte). LICENSE, ESLint
config bhi nahi. (Gap report §3 P1-11.)

**Kya add karo:**
1. `backend/src/db/backup.ts` + `restore.ts`, npm scripts `-w @petroflow/server`: `db:backup`, `db:restore`, `db:integrity`.
   Backup = `sqlite3`-free: `run("VACUUM INTO ?", [file])` (node:sqlite supports) → `db/backups/petroflow-YYYY-MM-DD-HHmm.db`
   (dir already `.gitignore` me: `db/backups/`) → sha256 sidecar + `PRAGMA integrity_check` after → retention prune by
   `BACKUP_RETENTION_DAYS`. Restore = verify integrity → copy `*.pre-restore` safety copy → swap → health check.
2. `.github/workflows/ci.yml`: node 22.x (`22.13`), `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
   `npx playwright install --with-deps chromium` + `npm run test:e2e` (ubuntu-latest, ek job; artifact on failure).
3. `.github/workflows/backup.yml` (optional nightly `workflow_dispatch`/cron → artifact) — sirf demo/backup practice ke liye.
4. **`eslint.config.js`** (flat config, typescript-eslint + react-hooks + prettier) + `npm run lint`; root scripts me add.
5. **LICENSE** (proprietary/all-rights-reserved ho to `LICENSE.md` me wahi text — SaaS hai to bhi chahiye) +
   **`docs/ARCHITECTURE.md`** aur **`docs/OPERATIONS.md`** **likho** (already referenced! 2 dead links) aur
   `.env.example` ke paas **`docs/HARDWARE-INTEGRATION.md`** (vendor register map ka contract).
6. Root `package.json` ka **`db:mysql-ddl`** ya to theek karo (`scripts/generate-mysql-ddl.mjs` banao) **ya hata do** —
   abhi broken hai; aur `db/schema.sql` header ka "db/mysql/schema.sql is generated from this file" jhooth hai →
   comment theek karo jab tak MySQL adapter na ho.
**Test:** backup → `integrity_check` ok → modify DB → restore → data wapas; CI green on this commit.

---

## 10. 🟡 P1-F · Register prints & inspection paperwork  ▸ *3 din*

**Kya add karo (data mostly already hai, print layer nahi):**
- `GET /reports/print/density-register?stationId=&from=&to=` → officer-ready rows (observed, temp, @15°C, spec,
  signature column) — `density_checks` se.
- `GET /reports/print/dsr?stationId=&date=` → **DSR with manager + operator signatures** (abhi sirf data table + CSV).
- `GET /reports/print/dip-register` (from `tank_measurements` incl. water dip) · `GET /reports/print/licence-summary`
  (compliance) · `GET /reports/print/seal-sample-log` (deliveries) · **`POST /density/:id/ack`** (supervisor sign-off
  = `approved_by/at` columns).
- **Nayi tables:** `inspection_visits` (officer, date, remarks, follow_up_on) + `complaint_book`
  (customer, vehicle, date, nature, resolution, closed_at) + `sample_retention` (delivery_id, bottle_no,
  retain_until, destroyed_at, destroyed_by) + `tank_tightness_tests` (tank_id, tested_on, method, result_lph, next_due).
  Ye chaaron **OMC inspection me directly manga jate hain** — aaj kuch bhi nahi hai.
- UI: ek `PrintDocument.tsx` component (A4 print layout) + har page par **Print** button; `window.print()` se
  chalega (koi PDF lib nahi chahiye abhi).
**Test:** density register print payload me ek out-of-spec row + `within_spec=0` flag; sample retention expiry
(`retain_until < today`) alert; complaint open → close flow audit log me.

---

## 11. 🟡 P2-A · CRM mota karna: customer pricing, overrides, follow-ups  ▸ *3–4 din*

**Kyun:** `grep -i discount` backend+frontend → **0 hits**. Fleet customer ko ₹0.50/L chhoot dena **system me
possible hi nahi** (rate sirf product+station level). Credit limit hard-block hai (achha) par owner override nahi.
(Gap report §3 P2-12.)

**Kya add karo:**
```sql
CREATE TABLE IF NOT EXISTS customer_rates (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES fuel_products(id) ON DELETE RESTRICT,
  discount_per_litre TEXT NOT NULL DEFAULT '0', flat_rate TEXT,   -- dono me se ek (validation)
  valid_from TEXT NOT NULL, valid_to TEXT, approved_by TEXT, note TEXT, created_at TEXT NOT NULL,
  UNIQUE (customer_id, product_id, valid_from)
);
CREATE TABLE IF NOT EXISTS customer_interactions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- CALL | VISIT | QUOTE | COMPLAINT | FOLLOW_UP | RENEWAL_TALK
  occurred_at TEXT NOT NULL, by_user TEXT, summary TEXT, next_action_on TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL
);
```
- `pricing.ts` me `rateFor(customerId, …)` overlay: station rate − `discount_per_litre` (never negative); manual/credit
  slips par apply, **device-derived totalizer sales par mat lagao** (meter pump rate par chalta hai — isliye
  customer-rate ka asar sirf **bill/credit slip value** me dikhega; ye distinction UI me clearly bolo).
- `POST /finance/credit-sales` me `allowOverLimit:{boolean, reason}` → `owner-only` override; `audit` me flag
  `credit_limit_overridden:true`; `GET /customers/:id/summary` → 12-month volume trend, avg litres/slip, last
  purchase date, **`days_since_last`** → "30 din se nahi aaye" list.
- New report: `/reports/customer-activity` + `GET /customers/at-risk` (no purchase 45d / overdue / limit-breach).
- Customers page: Rates tab (bulk customer ka effective rate), Interactions timeline, "Log follow-up".
**Test:** ₹103/L station rate, ₹0.50 discount → credit slip amount = qty×102.50; discount `valid_to` ke baad purana
rate; over-limit owner override audit log me reason ke saath; manager ko override 403.

---

## 12. 🟡 P2-B · NFR income (shop/services/rent) — sirf agar business me sach me hai  ▸ *4 din*

**Kya add karo:** `other_income_streams` (type: `SHOP | WASH | PUC | NITROGEN | RENT_ATM | RENT_SHOP | PARKING |
WATER_RO | OTHER`, party, amount, frequency `DAILY|MONTHLY`, business_date, receipt_no) + `shop_items`
SKU stock (lubricants pattern **copy** karo — `lube_products`/`lube_movements` already tested shape hai) +
rent **auto-accrual** (monthly) + reports: `NFR Income` tab, `GET /reports/export/nfr-income.csv`.
Reports/Dashboard me "Fuel vs Non-fuel income" split. **Agar dealer ke paas shop/rent nahi hai, ye item skip karo** —
0 value, extra screens ka bojh.

---

## 13. 🧹 Chhoti par sasti jeet (2–6 ghante each) — alag PR me bhejo

| Add | Kahan | Kyun |
|---|---|---|
| **Forgot-password** (1-use token, email link) | `auth.ts` + `Login.tsx` link | Aaj manager atak gaya to sirf owner reset kar sakta hai; `must_change_password` column already hai |
| **TOTP 2FA** (owner-only, recovery codes) | `auth.ts` + `auth.tsx` (frontend) | Owner ka login = poora business. `sessions` table ready |
| Session hygiene: "log out all devices" + idle timeout | `auth.ts DELETE /sessions` already hai | TTL 12h fixed; ek button hi chahiye |
| **Customer/vehicle duplicate check** | `catalog.ts` | Same vehicle 3 customers me bind ho sakta hai |
| Shift **templates** per station (A 07:00–15:00 / B 15:00–23:00 / C 23:00–07:00, expected count) | `app_settings` keys + `shifts.ts` validation | `shift_number` 1..20 free chhoota hai → 3-shift pump par "shift 5" ban sakta hai |
| **Overdue-shift / not-closed-yesterday** auto nudge | `alerts.ts` + `complianceAlerts` pattern | Day-close lock tabhi kaam karega jab log yaad dilayein |
| Pagination parity: sab list endpoints `page/pageSize` | `lib/http.ts paging()` | `api.ts:120` ka special-case hat jayega |
| Hindi/Marathi label toggle (i18n JSON) | `frontend/src/lib/*` | Filler/cashier adoption ke liye — bhaasha barrier real hai |
| **Rate-limit / health metrics export** (`/metrics` Prometheus) | `app.ts` | Ops dashboards; abhi `platform_errors` hi dekhna padta hai |
| `npm run lint` + `format` + husky precommit | root `package.json` | 29k lines, abhi koi linter nahi |

---

## 14. 🚫 Ye ADD MAT karna (bojh banega, koi nahi maangta)

Full double-entry ledger/journal/trial balance (Tally → export kafi) · apna e-invoice/IRN generator (GSP se jodo) ·
native Android app (responsive + PWA kaafi) · loyalty/fuel-card wallet + NPCI prepaid handling (OMC ka kaam hai —
sirf mirror/import) · drag-drop dashboard builder / custom report writer / embedded BI · BPMN multi-level approval
workflow (2 logins hain!) · websocket forecourt streaming + LED board (phase 5) · spare-parts/office inventory ·
multi-currency / multi-country / IFRS / translation of legal text · weightbridge & TMS for trucks · full HRMS
(leave appraisal/recruitment) · LIMS lab integration · MySQL adapter **abhi** (pehle SQLite ko reliable banao:
backup + integrity + single-writer discipline) · SaaS self-serve checkout with Razorpay (subscription invoices already
manual-manageable hain; pehle pump ka product pakka karo) · mobile push notifications · dark-room voice assistant,
AI "smart insights" — **in sabka ROI aaj zero hai ek 2-pump dealer ke liye**.

---

## 15. Recommended order (6–7 hafte, 1 dev)

```text
Week 0.5   #9 backup + CI + missing docs + lint      ← risk pehle
Week 1–1.5 #1 staff_members (+ attendance/nozzle attribution fix)
Week 2     #2 margin + daily P&L + commission
Week 3     #7 notifications engine (+ #13 quick wins ke saath)
Week 3.5   #5 payables allocation + #6 bank/MDR
Week 4.5   #3 tax engine (VAT + GST returns + invoice print)
Week 5     #10 register prints + inspection/complaint/sample/TTL
Week 5.5   #8 payroll + payslip
Week 6     #11 CRM (customer rates, interactions, at-risk)
Week 6.5+  #4 hardware pilot (vendor milne par) · #12 NFR (zaroorat hone par)
```
Har item ka **ek PR = ek feature**, with tests + seed demo rows + `README`/audit doc update (stale docs ki bimari
yahin se aayi hai — Gap report §5 me corrections di hain, unhe bhi merge karo).
