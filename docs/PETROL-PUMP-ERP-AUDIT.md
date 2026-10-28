# PetroFlow ERP — Petrol Pump ke hisaab se pura Audit + Roadmap

> Date: 2026-10-28 · Branch: `arena/b559f44e-petrolflow-erp`
> Ye report code ko line-by-line padh ke banayi gayi hai (112 files, ~19,000 lines).
> Health check: `npm ci` ✅ · `npm test` **48/48 pass** ✅ · `npm run typecheck` **clean** ✅

---

## 1. Ek line me verdict

**Engine (backend + hisaab-kitab ki logic) bahut solid hai — pump ke core kaam (totalizer, shift,
stock ledger, credit, DSR) sahi tareeke se bane hain. Lekin 8–10 aise features missing hain jo ek
asli Indian petrol pump par roz chahiye hote hain** (density register, testing/sampling, nozzle→tank
fix mapping, licence/stamping expiry, lubricant stock, gaadi-number credit slip, cash denomination,
day-closing). UI purana generic-blue SaaS jaisa tha — **isiliye is branch me pura UI/UX redesign
bhi kar diya gaya hai** (Section 6 dekho).

---

## 2. System kaise bana hai (architecture)

| Hissa | Kya hai | File |
|---|---|---|
| Frontend | React + Vite + Tailwind, 28 screens, dark/light theme | `frontend/` |
| Backend | Node 22 + Express API (`/api/v1`), session-cookie login | `backend/` |
| Database | SQLite (Node built-in), 37 tables, saara paisa/litre **Decimal TEXT** me (float kabhi nahi) | `db/schema.sql` |
| Hardware gateway | Dispenser/controller se reading laane wala alag program + simulator | `gateway/` |
| Shared | Roles, permissions, constants (frontend+backend dono use karte hain) | `packages/shared/` |

**Multi-tenant SaaS hai**: ek platform par kai dealer-organizations (tenants), har organization ke
kai pumps (stations). Demo me "Sunrise Fuels" ke 2 pump (Baner + Hinjewadi) seed hain.

### Roles (6) — sahi bane hain
`SUPER_ADMIN` (SaaS wala) · `OWNER` (dealer) · `MANAGER` · `ACCOUNTANT` · `CASHIER` · `OPERATOR`
(filler/DSM) — har role ke permissions server par enforce hote hain, sirf UI me hide nahi hota. ✅

---

## 3. Jo SAHI hai (petrol pump ke hisaab se) ✅

1. **Totalizer logic bilkul sahi** (`backend/src/lib/meter.ts`)
   - Sales = Closing − Opening totalizer. Reading ghati to `NEGATIVE` flag, achaanak bada jump to
     `SUSPICIOUS`, 24 ghante se zyada gap to `GAP` — galat reading **kabhi chup-chaap sales nahi banti**.
   - Meter reset/rollover par auto-convert nahi karta — insaan verify karega. Yehi sahi practice hai.
2. **Paisa Decimal.js se** — paisa kabhi float me nahi ghumta, to ₹0.01 ka farak nahi aayega.
3. **Price history sahi** (`pricing.ts`) — rate badalne par purana rate overwrite nahi hota;
   `effective_from/to` ke saath history rehti hai, station-specific rate tenant rate se upar.
   (Roz subah 6 baje wale OMC price-change ke liye yehi chahiye.)
4. **Tank stock = ledger** (`stock.ts`) — har litre ka movement (`OPENING/DELIVERY/DISPENSED/
   ADJUSTMENT`) likha jata hai; book stock ledger se banta hai, haath se edit nahi hota.
5. **Dip → Litre conversion calibration chart se** hota hai, bina chart ke system mana kar deta hai
   (andaz nahi lagata). Dip variance = measured − book, 50L tolerance ke saath alert.
6. **Shift close par hi sales banti hai**, flagged shift ko manager approve karta hai, reversal
   original movements se hota hai (double-entry jaisa discipline).
7. **Credit system**: customer-wise credit limit, credit entries, payments, outstanding — hai.
8. **Reconciliation**: cash expected vs counted, digital expected vs settled, variance approval — hai.
9. **DSR + reports**: Daily Sales Register, sales trend, owner dashboard, station summary — hai.
10. **Audit log har jagah** — kisne kya badla, pehle kya tha, baad me kya — sab record.
11. **Idempotency keys** — gateway double-reading bheje to duplicate sales nahi banegi.
12. **Hardware honesty** — simulator ko har jagah "SIMULATED" label; asli dispenser bina vendor
    protocol test ke "verified" nahi bolta. Ye imaandari production me bachaati hai.

---

## 4. Jo GALAT / RISKY hai (fix hona chahiye) ⚠️

| # | Problem | Asli pump par asar | Severity |
|---|---|---|---|
| 1 | **Nozzle → Tank fix mapping nahi hai.** Dispensed litre usi product ke saare tanks me *pro-rata* baant diya jata hai (`allocateAcrossTanks`). | Asli pump par har nozzle ek fix tank se pipe se juda hota hai. Is wajah se per-tank dip variance kabhi sahi nahi milega — chori/leak pakad nahi paoge. | 🔴 High |
| 2 | **Testing quantity ka hisaab nahi** (5-litre calibration test, density sample — jo fuel tank me wapas dalta hai). | Roz ka 5–15L "sale" dikhega jo asal me return hota hai → shift short/excess galat. | 🔴 High |
| 3 | **Cash denomination entry nahi** (₹500×n, ₹200×n… sirf notes me text likh sakte ho). | Cashier ka cash count verify nahi hota; short/excess ka pata denomination se hi chalta hai. | 🟠 Medium |
| 4 | **Shift me per-operator nozzle assignment nahi** — poori shift ka ek operator. | 2–3 filler ek saath kaam karte hain; kis nozzle ka cash kiske paas — hisaab alag nahi ho sakta. | 🟠 Medium |
| 5 | **Shift settlement breakup kamzor** — sirf opening/closing cash; mode-wise expected (Cash/UPI/Card/Fleet/Credit) vs mila hua, short/excess auto nahi. | Manager ko shift band karte waqt haath se milana padega. | 🟠 Medium |
| 6 | **Delivery (TT decantation) adhuri** — invoice vs received hai, par density/temp (VCF @15°C), dip before/after, compartment-wise, retention sample no. nahi. | Transit loss / kam maal ka daava OMC se nahi kar paoge; evidence nahi banta. | 🟠 Medium |
| 7 | `README` me `docs/ARCHITECTURE.md` ka zikr hai par file repo me **exist hi nahi karti**. | Naya developer bhatkega. | 🟢 Low |
| 8 | Kuch pages me hardcoded Tailwind rang (`emerald-500` aadi) bache hain jo light theme me halke pad sakte hain. | Light mode me kuch badges halke dikhenge. | 🟢 Low |

---

## 5. Ek Petrol Pump ERP me kya-kya HONA hi chahiye — puri checklist

### A. Roz ka Forecourt kaam
- [x] Subah ki price change (history ke saath) — **hai**
- [ ] **Subah ka density check register** (MS/HSD, hydrometer+thermometer, density @15°C) — OMC inspection me pehle yehi manga jata hai — ❌ **missing**
- [x] Shift A/B/C open-close, nozzle opening/closing reading — **hai**
- [ ] Shift me **filler-wise nozzle assign** + usi ka cash hisaab — ❌
- [ ] **Testing/sample quantity** (5L test return-to-tank) shift sales se minus — ❌
- [ ] **Cash denomination count** + short/excess per shift — ❌
- [x] Credit slip / udhaar entry — hai, par **gaadi number + driver + slip no.** ke saath bil banna chahiye — ⚠️ aadha
- [ ] **Day-closing / Roznamcha** — din band karne ke baad purani date me entry lock — ❌
- [ ] Customer ko **bill/receipt print** (thermal) + monthly credit statement — ❌

### B. Stock & Tank
- [x] Tank calibration (dip chart),dip entry, variance — **hai**
- [ ] **Water dip** (water-finding paste) entry — ❌
- [ ] **Nozzle→Tank fix mapping** — ❌ (upar #1)
- [ ] Evaporation/handling **loss-gain % OMC norms ke hisaab se** (MS ~0.75%, HSD ~0.25% handling) monthly stock-loss statement — ❌ (abhi sirf flat 50L tolerance hai)
- [ ] Low-stock par **indent/order suggestion** (kitne din ka stock bacha, TT kab mangana hai) — ❌
- [ ] ATG (auto tank gauge) reading integrate — gateway ready hai, ATG type add karna hai — ⚠️

### C. Purchase / TT Decantation
- [x] Supplier (OMC), invoice, received qty — **hai**
- [ ] Dip before/after unloading, density depot vs pump, temp correction, sample retention (2×1L bottle no.), seal numbers — ❌
- [ ] Indent management — OMC ko order, payment (RTGS/PO), load status — ❌

### D. Paisa / Accounts
- [x] Customer/supplier ledger, payments, expenses, reconciliation — **hai**
- [ ] **Bank book** — cash deposit (CMS), card/UPI settlement charges (MDR) auto-match — ⚠️ aadha (settlement ref hai, charges nahi)
- [ ] **GST/VAT reports** — fuel VAT ke andar, lubricant/NFR GST ke andar; GSTR-1/3B ready export — ❌
- [ ] Dealer commission/margin per KL se **asli munafa (P&L)** per product — ⚠️ (system khud kehta hai figures "operational estimates" hain)
- [ ] Outstanding **ageing report** (0–30/30–60/60+ din) + WhatsApp reminder — ❌
- [ ] Tally/export (Excel/CSV) CA ke liye — ❌

### E. Lubricants & Non-Fuel (NFR)
- [ ] Oil/lubricant **SKU-wise stock** (500ml/1L/3.5L pack), 2T, coolant, distilled water — ❌ (category hai, stock system nahi)
- [ ] PUC, nitrogen/air, car-wash, ATM rent jaisi other income — ❌

### F. Staff & Compliance — sabse neglected hissa
- [ ] Attendance, advance, salary, PF/ESI hisaab — ❌ (Employees = sirf login users hain)
- [ ] **Licence/stamping expiry alerts** — PESO licence, Legal Metrology (W&M) stamping date per dispenser, Fire NOC, tank testing, trade licence — ❌
- [ ] Inspection register, complaint book (OMC officer visit remarks) — ❌
- [ ] Quality checks — filter paper test, density register print — ❌

### G. Owner ke liye
- [x] Multi-pump dashboard, alerts — **hai**
- [ ] Subah-shaam **WhatsApp par DSR summary** owner ko — ❌
- [ ] Offline mode (net gaya to bhi reading entry, baad me sync) — gateway me spool hai, frontend offline nahi — ⚠️

---

## 6. UI/UX Redesign (is branch me kar diya gaya) 🎨

**Naya design: "Forecourt" theme** — petrol-pump ki pehchan wala.

| Cheez | Pehle | Ab |
|---|---|---|
| Brand rang | Generic sky-blue | **Fuel Amber/Orange** gradient (aag/petrol wali pehchan) |
| Surfaces | Blue-navy | **Warm graphite** (dark) / **warm paper-white** (light) |
| Font | Sirf Inter | Headings **Sora**, body Inter, numbers tabular mono |
| Cards/buttons | Chhota radius, flat | **rounded-2xl**, gradient primary button, soft shadow |
| Sidebar | Plain list | Gradient active-pill, pump-workflow groups, brand block |
| Topbar | Sirf station+user | **Live IST clock** + aaj ki date, station switcher |
| Mobile | Sirf hamburger drawer | **Bottom navigation** (Home/Shifts/Readings/Tanks) — filler ek haath se use kare |
| Dashboard | Tables bhar ke | **Aaj ke Rates strip**, **tank gauge visuals**, quick actions, bade KPI |
| Login | Blue panel | Orange-glow brand panel, pump-bhasha features |

Design token-based hai (`frontend/src/index.css`) — isiliye **saari 28 screens ek saath nayi ho gayi**
bina har page chhuye. Kal ko IndianOil/BPCL/HP ke rang chahiye to sirf CSS variables badalne hain.

---

## 7. Aage kaise karenge — Roadmap (priority order)

> ### ✅ STATUS UPDATE — 28 Oct 2026: Phase 1, 2 aur 3 (audit ke hisaab se) IMPLEMENT HO GAYE
> Upar ki checklist ke items 1–11 ban chuke hain aur test-cover hain (55 backend tests pass):
> nozzle→tank fix mapping (+auto-migration, pro-rata khatam), testing litres, denomination-wise cash
> ginti, mode-wise settlement + short/excess, day-closing lock (reopen sirf karan ke saath),
> density register (@15°C + spec flag), TT decantation full record (dip/seal/sample/chamber),
> monthly stock loss-vs-norm report, water dip, indent suggestion (days-of-cover), gaadi-wise credit
> slips + mahine ki customer statement + FIFO ageing, lubricant SKU stock/sales (GST register export),
> compliance expiry alerts (dashboard par bhi), staff attendance (payable days), aur 4 CA-ready CSV
> exports. Sirf Phase 4 (asli hardware pilot, WhatsApp automation, offline PWA) baki hai — wo vendor
> protocol aur live pump ke bina sach me test nahi ho sakta, isliye jhuthi "integration" nahi banayi.
> Naye screens owner ke demo login par ready-made data ke saath khulte hain.

**Phase 1 — Roz ka hisaab pakka (2–3 hafte)**
1. Nozzle→Tank fix mapping (+ migration, pro-rata khatam)
2. Testing quantity + cash denomination + filler-wise shift settlement (short/excess auto)
3. Density register (subah ki entry + print)
4. Day-closing lock

**Phase 2 — Stock & Purchase pakka (2 hafte)**
5. TT decantation full flow (dip before/after, density/VCF, sample, seal)
6. Loss/gain % OMC norms + monthly stock statement
7. Water dip + indent suggestion (days-of-cover)

**Phase 3 — Paisa & Compliance (2–3 hafte)**
8. Gaadi-wise credit slips + monthly bill + ageing + WhatsApp reminder
9. Lubricant/NFR SKU stock + sale
10. VAT/GST exports + Tally export
11. Licence/stamping expiry alerts + staff attendance/salary

**Phase 4 — Smart pump**
12. Asli FCC/ATG hardware pilot (ek pump, vendor protocol ke saath)
13. Owner WhatsApp DSR, offline-first operator app (PWA)

---

## 8. Chalana kaise hai (demo)

```powershell
npm ci
npm run dev        # frontend http://localhost:5173 · API http://localhost:4000
```
Demo login: `owner@sunrisefuels.in` / `PetroFlow@2025` · Super admin: `superadmin@petroflow.dev`
