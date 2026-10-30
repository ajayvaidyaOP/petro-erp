# PetroFlow ERP

Petrol-pump operations and credit CRM. React/Vite frontend, Java API (`gradlew`), MySQL. One dealer organisation, one or more pumps.

## Seedha jawab

Repo mein sirf do kaam ke folders hain:

| Folder | Kya hai |
| --- | --- |
| `frontend/` | Jo screen pe dikhta hai (React + Vite + TypeScript). Login, dashboard, shifts, stock, udhaar, reports. |
| `backend/` | Pure Java 21 API (`src/main/java/in/petrolflow`, `gradlew`), MySQL 8 schema/seed (`db/mysql/`), Java tests (`src/test/java/`), aur Java gateway simulator (`GatewaySimulator`). |

Root pe `package.json`, `README.md` aur `.env.example` isliye hain taaki dono ek saath start ho sakein. Ye alag apps nahi hain.

```text
petrolflow-erp/
├── frontend/          screens (React / Vite)
├── backend/           Java 21 API + MySQL schema/seed + Java tests + gateway simulator
├── package.json       Java API + frontend start/build/test commands
└── README.md
```

Chalane ka poora tarika neeche **Deployment** mein hai. Windows Command Prompt (`cmd`) ke commands wahi se copy karo. Browser screens **http://localhost:5173** (dev) ya **http://localhost:4173** (built). Java API port **4000** pe sunti hai. Browser seedha 4000 nahi bulata — frontend `/api` ko aage bhej deta hai.

`npm run dev` ab seedha Java 21 API (`gradlew run`) aur Vite frontend dono ek saath start karta hai.

Demo login (khali database pe):

- Owner: `owner@sunrisefuels.in` — sab kuch
- Manager: `manager@sunrisefuels.in` — roz ka kaam, dono pumps
- Staff: `attendant@sunrisefuels.in` — sirf shift aur readings, Baner pump
- Password: `PetroFlow@2025`

## Kya hai

Ye forecourt ka hisaab-kitab hai, poora Tally ya GST portal nahi.

**Forecourt**

- Shift open, nozzle opening/closing, testing litres, flag agar reading galat ho
- Cash note count (₹500 se ₹1) aur Cash / UPI / Card / Bank / Credit settlement
- Day close lock. Band date dubara tabhi khulti hai jab reason likha ho
- Tank stock sirf ledger se. Dip alag measurement hai, balance haath se edit nahi hota
- TT delivery record: dip, seal, sample, density
- Density register, 15°C correction, spec ke bahar flag
- Licence expiry (PESO, W&M, Fire NOC, insurance) dashboard pe

**Paisa aur credit**

- Customer credit limit, slip, vehicle, monthly statement, FIFO ageing (0–30 / 31–60 / 61–90 / 90+)
- Follow-up: call, visit, promise-to-pay, next date. Customers screen pe
- Payments, expenses, suppliers, reconciliation
- Lubricant SKU, stock, GST CSV
- Reports: DSR, stock loss vs OMC norm, ageing, sales register, stock statement

**Team**

- Ek owner. Woh staff login banata hai
- Har staff ke liye pumps aur permissions alag tick hoti hain
- Preset: pump attendant, cashier, accountant, shift supervisor. Uske baad tick hata sakte ho
- Server har request pe check karta hai. Menu chhupana kaafi nahi
- Staff ko naya login banane ka right nahi diya ja sakta. Woh sirf owner ke paas hai
- Ek manager seat ab bhi hai, daily operations ke liye. Extra log staff login se aate hain

**Reports share**

Har report pe Download aur Share hai. Phone pe file share hoti hai. Desktop pe WhatsApp khulta hai aur summary copy ho jaati hai. CSV Excel / Tally ke liye hai. Print bhi DSR pe hai.

## Kya nahi hai

Ye jaan-bujh kar nahi banaya. Pump pe kaam chalane ke liye ye pehle zaroori nahi, ya alag system ka kaam hai.

| Cheez | Status | Baad mein kaise |
| --- | --- | --- |
| Asli nozzle hardware (Gilbarco / Tokheim / ATG) | Simulator only (`GatewaySimulator.java`). | Vendor register map certify karke Java gateway adapter jodo |
| P&L / dealer margin per litre | Nahi. Sales estimate hai, munafa nahi | Purchase rate already delivery pe hai. Report mein sales minus cost jodna hai |
| Fuel VAT / GSTR-1 / e-invoice | Nahi. Lubricant GST CSV hai | CA export kaafi hai. Filing portal khud mat banao |
| OMC bill payment ageing | Adhura. Supplier hai, bill se payment link nahi | `payments` ko delivery se jodna |
| Bank / UPI settlement auto-match, MDR | Nahi. Manual reconciliation hai | Bank CSV import, alag phase |
| Email / SMS / WhatsApp alerts | Nahi. Share button manual hai. Auto digest nahi | Notification table + ek provider. Abhi mat jodo jab tak backup solid na ho |
| Payroll, PF, ESI, payslip | Nahi. Attendance aur payable days hain | Staff pay rate table, phir payslip print |
| Shop POS, car wash, rent income | Nahi | Alag income head. Lubricant already hai |
| Forgot password / 2FA | Nahi. Owner password reset karta hai | Email provider ke bina mat jodo |
| Database | Backend pure Java 21 + MySQL 8 use karta hai (`backend/db/mysql/schema.sql`) | Roz `mysqldump` backup rakho |
| Hindi UI | Nahi. Labels English hain | Baad mein, hisaab pehle |

Full double-entry accounting, loyalty wallet, native mobile app, aur drag-drop report builder is pump ke liye overkill hain. Tally export aur yeh screens kaafi hain.

## Staff login kaise banega

1. Owner se sign in karo.
2. **Team → Add staff login**.
3. Name, email, password, pump tick karo.
4. Preset chuno, phir jo nahi dena woh hata do.
5. Prices aur settings wala group sensitive hai. Default mein mat do.
6. Staff usi email/password se login karega. Jo tick nahi hua, screen nahi khulegi, API bhi 403 degi.

Password kam se kam 10 characters, ek letter aur ek number.

## Colour

UI **Ember & Evergreen** hai — dark charcoal workspace, warm orange actions aur green status cues.

- Orange: primary button, active menu, focus aur important actions.
- Green: live shift, healthy stock aur settled/paid status.
- Charcoal: page, navigation aur card surfaces; readable light text ke saath.
- Light theme bhi available hai: header ka sun/moon button use karo.

Dark default hai. Aapki selected theme `localStorage` key `petroflow.theme` mein rehti hai; pehle se save ki hui light choice bhi preserve hoti hai.

## Deployment

Pump PC ya office server pe yeh stack chahiye: **JDK 21**, **MySQL 8**, **Node.js 22+**. Node sirf screens build/start karne ke liye hai. Hisaab Java API + MySQL mein rehta hai.

Do CMD windows chahiye. Ek API, ek screens. Dono band karne ke liye us window mein `Ctrl+C`.

### 1. Install (ek baar)

Command Prompt **Run as administrator** kholo.

```cmd
winget install --id Microsoft.OpenJDK.21 -e --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
```

MySQL 8 Community Server installer se lagao (ya jo `MySQL80` service banata hai). Root password yaad rakhna. Service naam aksar `MySQL80` hota hai — `services.msc` mein confirm karo.

Nayi CMD window kholo (PATH update ke baad) aur check karo:

```cmd
java -version
node -v
mysql --version
```

`java -version` mein **21** hona chahiye. `node -v` **v22** ya usse upar. `mysql` PATH mein na ho to poora path use karo:

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" --version
```

MySQL service start:

```cmd
net start MySQL80
```

### 2. Code aur `.env` (ek baar)

```cmd
cd /d C:\petroflow-erp
copy .env.example .env
notepad .env
```

`.env` mein kam se kam yeh set karo. Password wahi jo MySQL root ka hai. Khali chhodo sirf jab root ka password khali ho.

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=petroflow
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
SEED_DEMO_DATA=true
ENABLE_DEMO_TOOLS=true
NODE_ENV=development
COOKIE_SECURE=false
PETROFLOW_API_URL=http://127.0.0.1:4000
```

Database khud ban jaati hai. `CREATE DATABASE` alag se mat chalao, jab tak user ke paas woh right ho. API start pe `petroflow` database, tables, aur khali database pe demo rows daalti hai.

Frontend packages:

```cmd
cd /d C:\petroflow-erp
npm ci
```

### 3. Roz chalana — development

**CMD window 1 — API.** Pehli baar Gradle 8.11.1 download hota hai. Internet chahiye. Repo root se mat chalao; `backend` folder se chalao.

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat run
```

Jab yeh line aaye, API up hai:

```text
PetroFlow API listening on http://0.0.0.0:4000
```

Check, teesri window mein:

```cmd
curl http://127.0.0.1:4000/api/v1/health
```

`{"data":{"ok":true,...}}` aana chahiye. MySQL band ho to yahi command fail karegi — pehle `net start MySQL80`.

**CMD window 2 — screens.**

```cmd
cd /d C:\petroflow-erp
npm run dev:frontend
```

Browser: **http://localhost:5173**

Demo (sirf pehli khali database pe, password `PetroFlow@2025`):

- `owner@sunrisefuels.in`
- `manager@sunrisefuels.in`
- `attendant@sunrisefuels.in`

Real data daalne se pehle demo password badal do, aur `.env` mein `SEED_DEMO_DATA=false` kar do.

### 4. Pump PC pe deploy (built screens)

Development server (`5173`) pump pe chhodna mat. Screens build karke preview chalao. API alag CMD mein chalti rahe.

`.env` production values:

```text
NODE_ENV=production
ENABLE_DEMO_TOOLS=false
SEED_DEMO_DATA=false
COOKIE_SECURE=true
MYSQL_PASSWORD=your-mysql-password
PETROFLOW_API_URL=http://127.0.0.1:4000
```

`COOKIE_SECURE=true` sirf tab jab site **https://** pe ho. Pump LAN pe `http://192.168.x.x` ho to `false` rakho, warna login cookie save nahi hogi.

`NODE_ENV=production` ke saath demo cheezein band rehti hain:

- `SEED_DEMO_DATA` aur `ENABLE_DEMO_TOOLS` ka default `false` hai. Inme se kisi ko bhi `true` karoge to API **start hi nahi hogi** — demo users production DB mein kabhi nahi banenge.
- `/api/v1/auth/demo-accounts` production mein 404 deta hai, aur demo login shortcuts kaam nahi karte.
- Agar production DB mein purane demo accounts bache hue mile (`superadmin@petroflow.dev`, `owner/manager/attendant@sunrisefuels.in`, ya `is_demo=1` wala koi bhi row) to API start hote waqt ruk jaati hai aur message deti hai. Wo accounts **khud delete ya disable nahi hote** — pehle asli dealer login banao, phir demo rows hatao ya `is_demo=0` karo, uske baad restart karo.

**Nayi (khali) production database pe pehla owner kaise banao**

Demo seed production mein band hai, isliye pehla asli login ek one-time command se banta hai. Ye command sirf tab chalti hai jab database mein koi OWNER/SUPER_ADMIN na ho, aur ek baar successful hone ke baad apne aap band ho jaati hai:

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat run --args="--bootstrap-owner"
```

(Repository root se `npm run db:bootstrap` bhi wahi command chalata hai.)

Uske baad screen pe poocha jaata hai: account type (OWNER), email, aapka naam, pump company ka naam, short company code, pehla station ka naam/code, aur password (typing dikhayi nahi degi, do baar poocha jaayega).

Zaroori baatein:

- Password command line pe kabhi na likho — wo process list aur command history mein dikhta hai. Command khud poochti hai.
- Password kam se kam 10 characters, usme letter aur number dono ho. Published demo password (`PetroFlow@2025`) mana hai.
- Ye command **HTTP endpoint nahi** hai. Internet pe koi public registration page nahi hai.
- Ek hi database pe dobara chalane par refuse ho jaayegi (owner pehle se hai ya marker `security.bootstrap.completed` maujood hai).
- Agar email/slug pehle se kisi account/company ka hai to command ruk jaati hai aur ek bhi row nahi likhti.
- Password PBKDF2 hash ke roop mein hi save hota hai, account `is_demo=0` ke saath banta hai.

**Database reset protection**

`--reset-db` (aur `npm run db:reset`) sirf development/test ke liye hai. `NODE_ENV=production` mein ye command **koi bhi SQL chalane se pehle** refuse ho jaati hai, taaki galti se asli shifts/sales/payments/ledger na ud jaayein. Production mein database dobara banana ho to backup restore karo.

Login throttling (brute force rokne ke liye) default: 15 minute ke window mein ek account par 8 fail, ek IP par 30 fail. Badalna ho to:

```text
PETROFLOW_LOGIN_WINDOW_SECONDS=900
PETROFLOW_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT=8
PETROFLOW_LOGIN_MAX_ATTEMPTS_PER_IP=30
```

Reverse proxy (nginx/Caddy) ke peeche chala rahe ho tabhi ye do lines lagao, warna `X-Forwarded-For` ignore hota hai:

```text
PETROFLOW_TRUST_PROXY=true
PETROFLOW_TRUSTED_PROXIES=10.0.0.5
```

**CMD window 1 — API** (pehle se `gradlew.bat run` chal raha ho to `Ctrl+C`, phir dubara, taaki naya `.env` pick ho):

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat run
```

Jar se chalana ho (Gradle har baar na uthaye):

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat jar
cd /d C:\petroflow-erp
java -jar backend\build\libs\petroflow-1.0.0.jar
```

Jar bhi repo root se chalao, taaki `backend\db\mysql\schema.sql` mil sake.

**CMD window 2 — built screens.**

```cmd
cd /d C:\petroflow-erp
npm ci
npm run build -w @petroflow/web
npm run preview -w @petroflow/web
```

Browser, isi PC pe: **http://localhost:4173**

Doosre PC / cashier desk se, API wale PC ka LAN IP:

```cmd
ipconfig
```

`IPv4 Address` lo, masalan `192.168.1.50`. Doosri machine pe browser: **http://192.168.1.50:4173**

Firewall, API wale PC pe, administrator CMD:

```cmd
netsh advfirewall firewall add rule name="PetroFlow Screens" dir=in action=allow protocol=TCP localport=4173
```

MySQL port **3306** LAN pe mat kholo. Screens sirf isi PC ke `127.0.0.1:4000` se API ko bolti hain.

### 5. Update

```cmd
cd /d C:\petroflow-erp
git pull
npm ci
npm run build -w @petroflow/web
```

API window mein `Ctrl+C`, phir:

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat run
```

Screens window mein bhi `Ctrl+C`, phir `npm run preview -w @petroflow/web`.

### 6. Backup aur restore

Roz backup, pump ke disk se bahar (USB / doosra PC). `mysqldump` PATH mein na ho to `C:\Program Files\MySQL\MySQL Server 8.0\bin\` se chalao.

```cmd
mkdir C:\petroflow-backups
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --routines --databases petroflow > C:\petroflow-backups\petroflow.sql
```

Restore (yeh current `petroflow` data overwrite karega):

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < C:\petroflow-backups\petroflow.sql
```

### Linux server (bash)

Wahi do process. `gradlew.bat` ki jagah `./gradlew`.

```bash
sudo apt-get update
sudo apt-get install -y openjdk-21-jdk mysql-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo systemctl enable --now mysql

cd /opt/petrolflow-erp
cp .env.example .env
nano .env

cd /opt/petrolflow-erp/backend
chmod +x gradlew
./gradlew run
```

Doosre terminal mein:

```bash
cd /opt/petrolflow-erp
npm ci
npm run build -w @petroflow/web
npm run preview -w @petroflow/web
```

Backup:

```bash
mysqldump -u root -p --routines --databases petroflow > /var/backups/petroflow.sql
```

## Commands

Roz ka start **Deployment** section se ya root `npm` scripts se karo — sabhi commands ab Java 21 + MySQL 8 backend aur React/Vite frontend chalate hain:

```cmd
cd /d C:\petroflow-erp\backend
gradlew.bat run
```

Ya root folder se:

```cmd
cd /d C:\petroflow-erp
npm run dev
npm run dev:backend
npm run dev:frontend
npm run dev:gateway
npm run typecheck
npm test
npm run build
npm run test:e2e
```

MySQL schema: `backend/db/mysql/schema.sql`. Demo seed: `backend/db/mysql/seed.sql`. Java API khali database pe schema aur seed khud lagati hai.

## Domain rules — inhe mat todna

1. Paisa aur litre `VARCHAR` + Java `BigDecimal` (`Money.java`). Float kabhi nahi.
2. Sale meter se aati hai, invoice se nahi. Galat reading sales nahi banti, flag hoti hai.
3. Tank stock sirf `stock_movements` se. Dip variance hai, edit nahi.
4. Band business date pe mutation nahi. Reopen reason ke saath, audit mein.
5. Price history overwrite nahi hoti. Kal ki report kal ka rate dikhati hai.
6. Tenant id session se aata hai, request se nahi. Doosri company ka data query mein aata hi nahi.
7. Staff permission user row pe stored hai. Station JSON se extra right nahi badhta.

## Hardware

`in.petrolflow.GatewaySimulator` (`npm run dev:gateway`) pump ke LAN pe chal sakta hai. Abhi simulator verified hai. Asli dispenser controller certify hone tak readings haath se daalo. Simulated data ko live meter mat bolo.

## Production se pehle

- Demo password hatao. `ENABLE_DEMO_TOOLS=false`, `SEED_DEMO_DATA=false`.
- `COOKIE_SECURE=true` sirf HTTPS pe. Pump LAN `http://` pe `false`, warna login cookie nahi tikegi.
- Roz `mysqldump` (Deployment §6) aur backup ko pump ke disk se bahar copy karo.
- Ek hi Java API process chalao. MySQL port 3306 LAN pe mat kholo.
- Ye audited accounts nahi hain. CA ko CSV do, Tally mein final books rakho.
