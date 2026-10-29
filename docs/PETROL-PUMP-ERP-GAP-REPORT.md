# PetroFlow ERP — "Petrol pump ERP/CRM ke liye kaafi hai kya?" Poori Gap Report

> Date: 2026-10-29 · Branch: `arena/52039f5d-petrolflow-erp`
> Ye report **code khud padh + chalake** banayi gayi hai (129 files, ~29,000 lines), sirf README/audit doc
> padh ke nahi. Har claim ke saath `file:line` evidence hai.
>
> **Aaj ka health check (maine actually chalaya):**
> `npm ci` ✅ · `npm test` → **64/64 pass** ✅ · `npm run typecheck` → **clean (4 workspaces)** ✅ ·
> `npm run build` → **frontend + backend build ok** ✅
>
> Repo me pehle se `docs/PETROL-PUMP-ERP-AUDIT.md` hai. Wo **kaafi jagah stale ho chuka hai**
> (jo cheezein ban chuki hain unhe "❌ missing" bolti hai) — Section 5 me uski corrections hain.

---

## 1. Ek line me verdict

**Forecourt ka "hisaab-kitab engine" asli ERP level ka hai — lekin ye abhi poora ERP/CRM nahi hai.**
Jo missing hai wo 3 grops me hai: **(a) staff/HR model systematically toota hua hai, (b) paisa/tax
(P&L, VAT/GST, payables) ka hissa sirf Aadha hai, (c) bahar ki duniya se judne ki cheezein (real
hardware, notifications, backup, CI) abhi stub ya absent hain.**

| Module | Maturity | Ek line me |
|---|---|---|
| Shifts / totalizer / meter validation | 🟢 **Production-grade** | Reading galat aayi to system jhooth nahi bolta — flag karta hai |
| Tank stock & calibration | 🟢 **Solid** | Sirf ledger se stock chalta hai, haath se edit nahi; dip chart zaroori |
| Day closing / audit / idempotency | 🟢 **Solid** | 8 jagah `assertDayOpen` enforce, har action audit hota hai |
| Density / TT decantation / compliance | 🟡 **Achha par print+workflow nahi** | Data toot-ta hai, register/licence print & approval flow nahi |
| Udhaar (AR) / customers | 🟡 **Aadha CRM** | Credit slip + statement + ageing hai; discounts/follow-ups nahi |
| Payables (AP) / bank / tax | 🔴 **Adhura** | Bill se payment link nahi, MDR nahi, VAT/GST returns nahi, P&L **bilkul nahi** |
| Staff / attendance / payroll | 🔴 **Toota hua** | Sirf 2 login allowed (owner+manager) → filler/DSM/cashier exist hi nahi kar sakte |
| Hardware integration | 🔴 **Simulator-only** | Modbus adapter `throw` karta hai; asli FCC/ATG nahi |
| Notifications / offline / ops | 🔴 **Absent** | In-app alert ke alawa kuch nahi; backup/CI nahi |

---

## 2. Jo **HAI** aur acha bana hai (dobara mat banao) ✅

### 2.1 Forecourt ki sachchai
| Feature | Kahan hai | Comment |
|---|---|---|
| Nozzle opening/closing totalizer → sales | `backend/src/lib/meter.ts` | Sales = closing − opening; **NEGATIVE / SUSPICIOUS / GAP / STALE / RESET** flags — galat reading chup-chaap sales nahi banti |
| **Nozzle → Tank fix mapping** | `nozzles.tank_id` (`db/schema.sql:247`), `shifts.ts:857` | Pro-rata guessing khatam; sirf unmapped nozzle par fallback `allocateAcrossTanks` (`stock.ts:189`) |
| **Testing litres** (5L calibration/sample return) | `shift_nozzle_readings.testing_litres`, `shifts.ts:553,690` | Billable litres = metered − testing. **Sahi hai** — warna roz 5–15L jhoothi sale lagti |
| Manual reading + device reading dono | `readings/manual`, `gateway/events` | Source + quality track hota hai |
| Price change history | `fuel_prices` + `pricing.ts` | `effective_from/to`, station-specific rate tenant se upar — OMC ke roz 6 baje wale rate change ke liye sahi |
| Paisa Decimal.js me, DB me TEXT | `lib/decimal.ts`, schema header | Float kabhi nahi — ₹0.01 ka farak nahi aayega |

### 2.2 Stock & Tank
- Tank **calibration chart** (dip cm → litres) — chart na ho to dip entry **mana** kar deta hai (`stock.ts:116`). Andaz nahi lagata, ye discipline bahut achha hai.
- **Water dip** entry (`tank_measurements.water_dip_cm`, `catalog.ts:409`) — paani nikalne ka record.
- Stock sirf **ledger** se: `OPENING / DELIVERY / DISPENSED / ADJUSTMENT / TRANSFER_IN / TRANSFER_OUT`.
- **Inter-station transfer** + manual adjustment + opening stock APIs (`inventory.ts`: `/transfers`, `/adjustments`, `/opening-stock`) — 2-pump dealer ke liye zaroori tha, hai.
- **Monthly stock loss/gain vs OMC norms** (`reports.ts /stock-loss`, `STOCK_LOSS_NORM_PCT`: petrol 0.75% / diesel 0.25%) + **water** ka asar.
- **Indent suggestion** (`/reports/indent`) — days-of-cover + safe ullage se "kal TT mangao" ka sujhav.

### 2.3 Shift / galla / din band karna
- Shift open → per-nozzle capture → preview → close → **FLAGGED approve** → **REVERSE** (reversal original movements se) — poora flow (`shifts.ts`, 1064 lines).
- **Cash denomination count** ₹500→₹1 (`shift_cash_denominations`, `CASH_DENOMINATIONS` me 500/200/100/50/20/10/5/2/1) — cashier ka guna verify hota hai.
- **Mode-wise settlement** Cash/UPI/Card/Bank/Credit + auto **short/excess** (`shift_settlements`).
- **Day close (Roznamcha) lock** + reopen sirf reason ke saath (`day_closings`, `lib/dayclose.ts`) aur **8 routes me enforce** (shift, density, finance, inventory, lubricants, attendance, catalog) — ye bahut badi baat hai, most pump software me nahi hota.

### 2.4 Quality & Legal (data level par)
- **Daily density register** observed + temp → **@15°C correction** + BIS/BS-VI spec band flag (`lib/density.ts`, `DENSITY_SPEC_KG_M3`).
- **TT decantation full record** — dip before/after, depot vs pump density, temp, `density_at_15c`, **seal numbers, sample seal no, chamber details** (`deliveries` table) → transit loss ka daava karne ka evidence banta hai.
- **Delivery dispute** flag (`POST /deliveries/:id/dispute`).
- **Licence expiry tracking** — PESO, W&M stamping, Fire NOC, Trade licence, Tank testing, Pollution NOC, Electrical safety, Insurance (`compliance_documents`, `renewal_lead_days`) + dashboard alerts.

### 2.5 Udhaar / customers / reports
- Customer ledger, **credit limit HARD block** (`finance.ts:207-211` — limit over ho to entry hoti hi nahi), auto due-date from `credit_days`.
- **Vehicle-wise credit slips** + auto slip number (`customer_vehicles`, `credit_entries.vehicle_number/driver_name`).
- **Printable monthly customer statement** (`/finance/customer-statement`) + `@media print` CSS (`index.css:320`).
- **FIFO ageing** 0–30/31–60/61–90/90+ (`/reports/ageing`).
- **4 CSV exports** — sales register, stock statement, ageing, lubricants GST (`/reports/export/*.csv`) — CA/Tally ke liye ready.
- **Lubricants/NFR**: SKU (brand, pack size, **HSN + GST%**, purchase/sale rate, per-pack margin), stock movements, over-sale block, GST register export.
- DSR, sales trend, owner dashboard, station summary, **combined multi-pump dashboard** (owner-only).

### 2.6 Platform / security hygiene (SaaS ke liye)
Multi-tenant (tenants → stations), station-level access (`user_station_access`), permission-based **server-side** enforcement (`packages/shared/src/permissions.ts` — 40+ permissions), subscriptions + plans + invoices (SaaS billing ka structure), `helmet`, origin guard, login/password **rate limits**, session table with revoke, **idempotency keys** (gateway double-hit se duplicate sale nahi), full **audit log** with before/after, `platform_errors` sink, device API-key hashing + rotation, gateway **NDJSON spool** (net gaya to reading nahi khoyegi), IST-first dates, demo-data `is_demo` tagging, 32 frontend pages (24 pump + 8 admin), Playwright e2e 13 tests.

---

## 3. Jo **NAHI** hai — priority ke saath 🔴

> Priority = pump par asar. **P0 = system sach me nahi chalega / paisa-legal ka risk**,
> **P1 = roz ka kaam adhura**, **P2 = nice-to-have**.

### P0-1 · Staff model hi nahi hai (sabse bada regression) ⚠️⚠️
`users` ka role enum sirf **`OWNER` | `MANAGER`** hai (`permissions.ts` `ROLE_DEFINITIONS`, `catalog.ts:789`), aur **per tenant max 1 owner + 1 manager** (partial unique index; duplicate banane par `conflict`, `catalog.ts:799`). Asli pump par 10–15 log hote hain: DSM, pump attendants/fillers, cashier, accountant, pumper, cleaner.

Iske **do direct toote hue results** nikalte hain:
1. **Haaziri vyavaharik roop se bekaar hai** — `attendance_records.user_id → users(id)`
   aur attendance sheet `FROM users` banti hai (`attendance.ts:26-38`). Matlab haaziri sirf
   **owner + manager** ki lag sakti hai. Actual fillers ki attendance **mark ho hi nahi sakti**,
   kyunki unka koi entity hi nahi hai.
2. **Filler-wise nozzle hisaab dead column hai** — audit doc kehti "per-operator nozzle assign ban gaya";
   `shift_nozzle_readings.operator_id` column **hai** (`schema.sql:402`) aur `shifts.ts:530` set karta bhi hai,
   lekin selectable "operators" ke naam par sirf 2 login hain → attribution kaam nahi karti.
3. Sath hi `cashier`/`operator`/`accountant` roles **RETIRED** kar diye gaye
   (`permissions.ts: RETIRED_ROLE_KEYS`), to staff ko *restricted* login bhi nahi de sakte —
   ya to owner bana do (sab kuch dikhega) ya manager (finance/expenses dikhega). Cashier ko
   sirf galla dikhane ka koi upay nahi.

**Kya chahiye:** `staff_members` master table (name, role/duty, joining, Aadra-card no need — but pay rate,
attendance id, active), **login se alag** — operator bina login ke bhi shift/nozzle/attendance se jud sake.
Plus optional 3rd "STAFF" login role with a very narrow permission set (apni shift + apna galla).

### P0-2 · Asal munafa (P&L) ek dam nahi hai
`deliveries.rate_per_litre` me **purchase cost store hota hai** — par koi report use **sales ke against nahi**
jodti. `station-summary` me sirf `shiftLitres / shiftValue / transactionValue` hain (`reports.ts`), margin ka
koi field nahi. **Dealer commission / OMC margin per litre** ka koi model hi nahi (India me dealer ki kamai
purchase-vs-sale spread + OMC commission se hoti hai). Expenses alag track hote hain, income statement nahi
banta. Khud code maanta hai: `ACCOUNTING_DISCLAIMER = "…operational estimates… not audited financial statements"`.
→ Owner ko abhi **nahi pata ki aaj ka munafa kitna hai**. Ye ERP ka sabse bada business-value gap hai.

### P0-3 · Tax engine nahi hai (VAT/GST dono)
- Fuel par **state VAT + central excise** ka koi concept nahi — `grep -i vat` → **0 hits**. `deliveries.tax_amount`
  ek free-form number hai, rate configurable nahi, per-station/per-state nahi.
- Lubricants par `gst_rate_pct` + `hsn_code` **hai** aur GST CSV export bhi hai — **par GSTR-1/GSTR-3B
  ready data nahi**, nil/RCT/ISR split nahi, e-invoice (IRN) nahi.
- Fuel **tax invoice** B2B fleet customer ke liye print nahi hota (sirf credit slip + statement).
→ CA/Tally me aadha kaam phir bhi haath se hoga.

### P0-4 · Real hardware abhi bhi nahi hai (honest hai, par kaam nahi karega)
`gateway/src/adapters/modbusTcp.ts:74` → `throw new Error('Modbus adapter is not implemented for physical devices.')`.
Sirf **simulator** verified hai. Asli FCC (Gilbarco/Faroad/Tokheim/Wayne) aur **ATG (Veeder-Root TLS)** ke
adapters nahi — Matlab pump ke 90% totalizer readings abhi bhi **haath se** daalni padengi. (Idea sahi hai —
jhoothi "integration" mark nahi ki gayi; lekin production ke liye ye P0 hi rahega.)

### P1-5 · Payables (OMC ko paisa) adhura hai
`payments` me `direction = RECEIPT | PAYOUT` + `supplier_id` hai, **par `delivery_id`/invoice link nahi**
(`grep delivery_id db/schema.sql` → 0 hits). Natija:
- Kaunsa TT bill pending, kitna din purana — **AP ageing nahi** hai (AR ageing hai, AP ki nahi).
- `suppliers.credit_days` sirf ek field hai — **due date auto nahi banti** (customer side me auto banti hai, `finance.ts:213`).
- Part-payment / advance / interest-on-delay ka koi hisaab nahi.

### P1-6 · Bank / UPI / card settlement ka milan nahi
`payments.settlement_ref` + `SETTLED` status **manual** hai. **MDR / handling charges / TDR ka koi column hi nahi**
(`grep -iE "MDR|settlement_charge"` → 0 hits). Na bank statement import (.csv/BAI), na PG settlement report se
auto-match. Pump par roz 200–600 card/UPI hits hote hain — T+2 settlement aur charges ka milana **manual** hi rahega.
`reconciliations.digital_expected vs digital_settled` hai, par source data haath se aata hai.

### P1-7 · Kuch bhi bahar nahi jaata: notifications zero
`NotificationCenter` sirf **live in-app** items dikhata hai ("No fake read state" — `NotificationCenter.tsx:35-38`).
`grep -iE "SMTP|email|sms|whatsapp|push"` in `backend/src` → **0 hits**. Matlab:
- Licence **expire ho gayi** → dashboard kholne tak kisi ko pata nahi chalega.
- Tank 15% se neeche / shift short / 90+ din ka udhaar → koi alert email/WhatsApp nahi.
- Owner ko subah DSR nahi chahiye (jo actually sab maangte hain).
- Koi `notifications` table hi nahi → "bheja gaya / nahi bheja" ka record nahi, retry nahi.

### P1-8 · Payroll / HR bilkul nahi, chahe aadha bana hua dikhta hai
`AttendancePanel.tsx:82` kehta hai *"monthly payable days drive payroll computation"* — par **payroll compute
kahin nahi hota**: `attendance.ts:/summary` sirf `payableDays = present + half*0.5 + week_off` return karta hai.
Koi `salary_structure`, per-day rate, advance, PF/ESI/ESIC, overtime, incentive (DSM ka per-KL incentive), form
16, payslip **nahi** (`grep -iE "PF_|ESI"` → 0 hits). Advance ka sirf ek demo **expense category** hai
(`seed.ts:751` 'Staff salary advance') — matlab advance expense me dub jayega, employee se link nahi rahega.

### P1-9 · Quality/inspection & printing workflows — data hai, kaam nahi
Density register, dip, TT decantation ka **data** store hota hai, par:
- koi **register print** (OMC inspection officer jo paper maangta hai) nahi — sirf DSR/CSV.
- **filter paper test, water-content test, tank tightness test (TTL), visual proof (dip) certificate** — no records.
- **complaint book / OMC officer visit remarks / inspection notes** — kuch nahi (`compliance_documents` me sirf expiry dates).
- Sample retention **6 mahine** ka expiry tracker nahi (sirf sample number likhta hai).

### P1-10 · Non-fuel revenue (NFR) sirf lubricants tak simit
Ye hai: lubricant SKU + GST export. Ye **nahi** hai: convenience store/shop inventory (multiparcel, POS-style sales),
car wash / PUC / nitrogen / air / RO water services (rate + booking + revenue), **shop/ATM/canopy rent income**
(jo pump ka 2nd biggest income hota hai), parking, hotel/restaurant tie-up. In sabka revenue abhi sirf
"expense me negative" trick se hi dikhega — income head hi nahi hai.

### P1-11 · Ops / DB reality: SQLite + adhuri docs + broken scripts
- `node:sqlite` **experimental** hai (har test run par warning aati hai) aur ye single-writer local file hai →
  2-pump se aage (3–5 pump, 15 users, 5-min gateway polling) par scaling risk.
- `.env.example` **MySQL production** imply karta hai (`# DATABASE_URL="mysql://…"`), aur schema header kehta hai
  *"db/mysql/schema.sql is generated from this file"* — **wo file nahi hai, aur adapter bhi nahi**. README khud
  maanta hai "The commented MySQL variables do not enable a MySQL adapter".
- Root `package.json` ka `db:mysql-ddl` script → `scripts/generate-mysql-ddl.mjs` — **`scripts/` dir hi nahi hai** ❌ (broken npm script).
- `docs/ARCHITECTURE.md` aur `docs/OPERATIONS.md` **referenced but missing** (`settings.ts:276` bhi OPERATIONS.md bolta hai).
- **Backup sirf documentation hai** — `BACKUP_RETENTION_DAYS=14` env var hai par koi backup/restore script nahi,
  koi scheduled vacuum/integrity check (`PRAGMA integrity_check`) nahi. Ek corrupt .db = sab gaya.
- **`.github/` nahi → koi CI nahi** (test/typecheck/build apne aap nahi chalte), **LICENSE file nahi**, **no ESLint/Prettier config** (`.eslintcache` .gitignore me hai par config nahi).
- Koi **OpenAPI/Swagger** spec nahi — gateway/vendor integration ke liye API contract document nahi (vendor
  engineer ke saath protocol baat karte waqt ye sabse pehle chahiye hota hai).

### P2-12 · Chhoti par mehsoos hone wali kamiyan
| Gap | Detail |
|---|---|
| Forgot password | Self-service reset nahi (`grep -iE "forgot\|recover"` → 0). Owner reset kar sakta hai; manager atak gaya to phone call |
| 2FA/MFA | Nahi. Owner ka login = poora business. Recovery codes bhi nahi |
| Customer-wise rate | `grep -i discount` → **0 hits**. Fleet customer ko ₹0.50/L kam dena = **system me possible nahi** (rate sirf product+station level). Bahut common demand |
| Credit-limit override | Hard block hai (achha), par owner "reason ke saath allow" nahi kar sakta → slip paper par likhni padegi |
| Shift templates | `shift_number` 1..20 freely, par **station-wise shift config (9am–5pm A/B/C, times)** nahi — kya shift 2 thi ya 3, setup se enforce nahi hota |
| Loyalty / fuel cards | OMC ke fleet-card/loyalty ka import ya mirroring nahi (bulk-tariff customers) |
| Offline PWA | Gateway spool hai (badiya), par **browser offline** ho to frontend se entry nahi hoti; koi service worker/queue nahi |
| Realtime | No SSE/websocket — dashboard poll-based (chalta hai, par forecourt TV display nahi ban sakta) |
| Multi-language | UI English only; Hindi/Marathi labels nahi (staff ke liye helpful) |
| Pagination consistency | Sab list endpoints paginated nahi; frontend ko "unpaginated arrays" handle karne ka special case rakhna padta hai (`lib/api.ts:120`) |
| Session TTL | 12h fixed; idle-timeout / concurrent-session cap / "logout all devices" partial |

---

## 4. "Kya zaruri hai, kya nahi" — seedha jawab

### ✅ Ye **hona hi chahiye** aur is repo me already hai (chhendo mat)
Price history · totalizer-based sales + validation · shift open/close/approve/reverse · cash denomination ·
mode-wise settlement + short/excess · day-close lock · tank calibration + dip + variance + water dip · stock
ledger + transfers + adjustments · TT decantation (dip/seal/sample) · density @15°C + spec flag · loss/gain vs
norms · indent suggestion · customer credit limit + slips + statement + ageing · lubricant SKU + GST register ·
licence expiry tracking · attendance (as data) · CSV exports · audit log · idempotency · multi-station · decimal money.

### 🔴 Ye **hona chahiye, abhi nahi hai** (in order of pain)
1. Staff/master-data layer + staff-wise shift & galla attribution (P0)
2. Purchase-cost vs sales **margin + P&L** + dealer commission per litre (P0)
3. **Fuel VAT/excise + GST returns (GSTR-1/3B)** + printable tax invoice (P0)
4. Real dispenser **FCC/ATG adapters** (P0 for automation; simulator se business nahi chalta)
5. **AP**: TT bill → payment allocation + payables ageing + auto due date (P1)
6. **Bank/PG settlement auto-match + MDR charges** (P1)
7. **Email/WhatsApp/SMS notifications + daily DSR digest + alert history** (P1)
8. **Payroll**: pay rate, advances linked to staff, PF/ESI, payslip print (P1)
9. **Backup/restore + integrity check tooling + CI** (P1 — business bachaane wala kaam)
10. Register prints: density register, DSR with signatures, dip/stock register, complaint/inspection book (P1)
11. **Customer-level pricing / discounts** + credit-limit override with reason (P1)
12. NFR income heads (shop POS, services, rent) (P2)
13. Shift template config, 2FA, forgot-password, offline PWA, Hindi UI (P2)

### 🚫 Ye **jaan-boojh kar mat banao** (over-engineering ka gadha, pump par koi nahi maangta)
- **Full double-entry accounting / journal / trial balance** — Tally already karta hai; **export** kafi hai.
- **Self-made GST filing portal / e-invoice generator (IRN)** — GSP se jodo (vyapal), khud ka TN engine mat banao.
- **Native Android/iOS app** — PWA + responsive (already hai) se kaam chalta hai; 2 codebases ka bojh mat lo.
- **Loyalty program / fuel card wallet / prepaid wallet & NPCI handling** — ye OMC ka kaam hai; sirf *mirror* karo.
- **Generic dashboard-builder / drag-drop BI / custom report writer** — 5 fixed reports hi 95% use hain.
- **Workflow engine (multi-level approval chains, BPMN)** — ek manager + ek owner hain; 2 status kaafi.
- **Real-time websocket streaming + forecourt LED boards** — phase 5 ka khel hai.
- **Inventory for spare parts/HOD/office supplies** — lubricants + shop kaafi.
- **Multi-currency / multi-country / IFRS** — India, INR, IST. Khatam.
- **Weightbridge/TMS for trucks** — pump ka requirement nahi.
- **HRMS (leave approval, appraisal, recruitment)** — sirf attendance + payable days + advance chahiye.
- **Custom MySQL migration abhi** — pehle single-node reliability + backup sahi; MySQL tab jab 5+ pump/HA ki real zaroorat ho.

---

## 5. Purane `PETROL-PUMP-ERP-AUDIT.md` me **galat/stale** lines (corrections)

| Audit doc kehti hai | Sach (code me verify kiya) |
|---|---|
| ❌ "Nozzle→Tank fix mapping nahi hai" | **Ho gaya** — `nozzles.tank_id` + `shifts.ts:857`; pro-rata sirf unmapped fallback |
| ❌ "Testing quantity ka hisaab nahi" | **Ho gaya** — `testing_litres`, net billable (`shifts.ts:553`) |
| ❌ "Cash denomination entry nahi" | **Ho gaya** — `shift_cash_denominations` + 9 denominations |
| ❌ "filler-wise nozzle assignment nahi" | **Aadha** — column + UI hai, **par staff entity na hone se vyavaharik roop se bekaar** (P0-1) |
| ❌ "Day-closing lock nahi" | **Ho gaya** — `day_closings` + 8 routes me enforce |
| ❌ "Density register nahi" / "water dip nahi" / "licence alerts nahi" / "lube SKU nahi" / "attendance nahi" / "ageing nahi" / "CSV exports nahi" | **Sab ho gaya** (`density.ts`, `water_dip_cm`, `compliance.ts`, `lubricants.ts`, `attendance.ts`, `/reports/ageing`, 4 exports) |
| ❌ "Employees = sirf login users" | **Abhi bhi sach** — aur badtar: sirf 2 users allowed |
| Roles "6 sahi bane hain" | **Badal gaya** — ab jaan-boojh kar **2** (OWNER/MANAGER); OPERATOR/CASHIER/ACCOUNTANT retired. 6 role wala section ab purana hai |
| "48/48 tests" | Ab **64/64** (aaj chalake dekha) |
| Tables "37" | Ab **46** |
| README: `docs/ARCHITECTURE.md` | **File maujood nahi** — Section 3.11 |

---

## 6. Aage ka roadmap (effort ke saath) — 6–7 hafte, 1 dev

### Phase 1 — **Staff & Munafa** (1.5 hafte) — *sabse zyada kaam dikhne wala*
1. `staff_members` table (name, duty, mobile, pay_rate, joined, active, is_demo) + CRUD + Team screen me
   "Staff (no login)" block; `shift_nozzle_readings.operator_id` + `attendance_records` ko staff se jodo
   (nullable `user_id` **or** `staff_id`); haaziri sheet = owner+manager+**saare staff**.
2. Optional `STAFF` login role: sirf `shifts.read/open` + apni shift ka galla (permission set chhota rakho).
3. **Margin engine**: `tank stock` ke liye moving-average purchase rate (ya FIFO by `deliveries`); per-shift
   `COGS = litres × avg purchase rate`; **Daily P&L report** = sales − COGS − expenses + **dealer commission
   /L (configurable per product/station)**; owner dashboard par "Aaj ka munafa" + monthly P&L CSV.

### Phase 2 — **Tax & Paisa** (1.5 hafte)
4. `tax_rules` (fuel: state VAT + excise / non-GST; NFR: HSN+GST%), station+product wise; delivery/txn par apply;
   `deliveries` se due-date auto + `payment_allocations` (bill-wise AP) + **AP ageing** report.
5. `settlement_charges`: mode-wise MDR/TDR, bank statement CSV import + auto-match by date+amount, unmatched list.
6. Exports: **GSTR-1 (B2B/B2C/nil/RCT)**, GSTR-3B summary, **Tally .xls/.csv voucher format**, VAT return schedule.
7. Printable **tax invoice** (fleet credit sales) + receipt print.

### Phase 3 — **Bahar ki duniya** (1 hafte)
8. `notifications` table + channels: SMTP (nodemailer) + WhatsApp (AI-SB / i2i / MSG91) + SMS fallback;
   rules: licence ≤30/7/0 din, tank ≤ safe-ullage, shift short > ₹500, 90+ din udhaar, **subah 7 baje owner DSR**.
   Daily digest cron + retry + audit.
9. **Forgot-password** (email link, 1-use token) + optional **TOTP 2FA** owner ke liye.
10. `npm run backup` (`VACUUM INTO` + `PRAGMA integrity_check` + sha256 + retention) + `npm run restore -- --from`
    + runbook. **Ye Phase 1 se bhi pehle kar sakte ho — 1 din ka kaam hai, business bachaata hai.**

### Phase 4 — **Register prints + Compliance paperwork** (1 hafte)
11. Print views (already `@media print` base maujood): density register with signatures, daily dip/stock register,
    DSR with manager sign, licence/expiry certificate list, complaint & inspection book.
12. Sample-retention expiry (6 months auto-due), TTL/tank-test log, filter-paper test record, seal-break register.

### Phase 5 — **Asli hardware pilot** (2 hafte, vendor ke bina possible nahi)
13. Ek vendor protocol real controller par: `modbusTcp.poll()` implement (register map config per vendor), readings
    verify + drift report; ATG (Veeder-Root) adapter; commissioning checklist; **sirf usi pump par "verified" badge**.
14. PWA offline queue for shift/reading entry (already spool pattern gateway me — same idea frontend me).

---

## 7. Chalane ka tareeka (quick)

```powershell
npm ci
npm run dev            # http://localhost:5173 (Vite) → /api proxy → :4000
npm test               # 64 tests
npm run typecheck      # 4 workspaces
npm run build && npm run start   # single-origin local run
```
Demo login: `owner@sunrisefuels.in` / `PetroFlow@2025` (Manager: `manager@sunrisefuels.in`) · 2 pumps seeded (Baner, Hinjewadi).
`db:reset` **destructive** hai. Note: `npm run db:mysql-ddl` **tuta hua hai** (missing `scripts/generate-mysql-ddl.mjs`).

---

## 8. Bottom line

- Ek **2-pump, manual-entry, single-accountant** dealer ke liye: **90% kaam ho sakta hai abhi** —
  shifts, readings, stock, TT, credit, reports. Engine sach me achha hai.
- Ek **asli "petrol pump ERP + CRM"** claim karne ke liye **4 cheezein must** hain: **staff layer, margin/P&L,
  tax (VAT+GST) engine, notifications**. In 4 ke bina product demo achha lagega, production par aadha chhod dega.
- **Business-risk se bachne ke liye pehla kaam:** backup/restore + CI (1 din) — code achha hai, uski hifazat nahi hai.
- Hardware automation ko "ready" mat bolo: `modbusTcp` ek scaffold hai. Pump owners ko pehle **manual-entry
  speed + print registers** se faayda hoga, FCC integration se nahi (wo vendor timeline par depend karta hai).
