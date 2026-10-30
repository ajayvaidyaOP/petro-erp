# PetrolFlow ERP — MySQL 8.0 / InnoDB staging verification plan

**Plan status: NOT READY TO EXECUTE.** This is a documentation-only plan. No test has been run and no database was accessed. Do not run any database command copied from this document until its blockers are cleared and all angle-bracket values have been replaced and independently reviewed. No global MySQL privileges, production-schema access, production host, or production data are permitted.

## 1. Source basis and mandatory safety gate

Reviewed repository source: `Main.java`, `Config.java`, `Web.java`, `Db.java`, `Mysql.java`, `Json.java`, `Passwords.java`, `Auth.java`, API route classes, Gradle files, root/frontend package manifests and `backend/db/mysql/schema.sql`. Source schema contains 47 `CREATE TABLE IF NOT EXISTS` declarations, all explicitly `ENGINE=InnoDB`; it contains no `CREATE VIEW`, `TRIGGER`, `PROCEDURE`, `FUNCTION`, or `EVENT` declarations. This does not establish the live staging database inventory: run the read-only inventory in STG-10 using an authorized verifier before dump/restore.

### Critical app-account privilege blocker

`Mysql.connect()` executes `CREATE DATABASE IF NOT EXISTS <configured-name>` before `USE <configured-name>` (`backend/src/main/java/in/petrolflow/Mysql.java:65–71`); `Db.open()` invokes that connection bootstrap (`Db.java:24–37, 240–250`). In MySQL 8, creating a database requires the global `CREATE` privilege; a grant scoped only to `petroflow_staging_verify.*` does not provide that global privilege. A pre-created database does not make this source statement a safe, schema-scoped operation. Granting global `CREATE` is expressly prohibited by this plan and could permit creating unrelated databases. **The present app cannot be asserted to start under the required no-global-privilege policy.**

Do not silently grant global `CREATE`, use an administrator account for the app, or permit production schema access. The minimum application change needed in a separate approved source-code task is: remove the database-creation statement from the application connection bootstrap and require an administrator to pre-create the configured staging schema; the app then connects to that existing schema and uses only its schema-scoped grants. No source change is authorized in this plan. After such an application change, source review and a separate privilege test must prove startup, schema DDL, normal CRUD, and reset behavior work with no global grants. Until then, bootstrap, seed, API, concurrency, deadlock and JAR-run verification are **BLOCKED** under the required security policy.

Database administrators may create disposable staging schemas/users outside the application, but they must never configure the application with a global grant. Before any future execution, verify connection target from an independently reviewed protected configuration source, and obtain:

```sql
SELECT @@version, @@version_comment;
SHOW GRANTS FOR 'petroflow_stg_app'@'STAGING_CLIENT_HOST';
SELECT user,host,Select_priv,Insert_priv,Update_priv,Delete_priv,Create_priv,Drop_priv,
       Grant_priv,File_priv,Process_priv,Super_priv,Trigger_priv,Event_priv,
       Create_routine_priv,Alter_routine_priv
FROM mysql.user WHERE user='petroflow_stg_app';
SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME LIKE 'petroflow_staging_%' OR SCHEMA_NAME='petroflow';
```

Substitute the real account/host; never run the literal placeholder. An administrator verifies the app principal’s complete grants and confirms every global privilege column is `N`, with no schema wildcard and no production-schema grant. Verify lack of production access from account grants/policy; do not connect to or query production as part of this staging plan. `mysql.user` inspection is administrative, not an app-account query. The app privilege baseline after the separately approved bootstrap change is schema-local `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP`, limited to the one disposable schema. Do not grant global `CREATE`, `FILE`, `PROCESS`, `SUPER`, `SYSTEM_USER`, `CREATE USER`, `GRANT OPTION`, or any privilege on production. Revisit least privilege only if a concrete staging operation fails; never fix it by broadening global access.

## 2. Build verification (manual operational verification; currently blocked from staging run)

Source contracts: root requires Node `>=22.13.0` (`package.json:6–8`); frontend workspace defines `build` as `tsc -b && vite build` (`frontend/package.json:6–10`); Gradle compiles with release 21 and produces a fat JAR with `Main` entry point (`backend/build.gradle.kts:9–20,49–55`).

From repository root, enforce versions (fail closed), install locked npm dependencies, then build:

```bash
set -euo pipefail
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if(M<22||(M===22&&m<13)) { console.error("Node >=22.13.0 required"); process.exit(1); }'
java -version 2>&1 | head -n 1 | grep -E '"21([.]|[" ])'
npm ci
npm run build -w @petroflow/web
./backend/gradlew -p backend --no-daemon --no-build-cache clean jar
test -s backend/build/libs/petroflow-1.0.0.jar
test -s frontend/dist/index.html
```

Remove the leading whitespace before `test` if copying into a shell that rejects it; it is harmless in bash. For stricter Java enforcement, use an approved JDK 21 toolchain image and record `java -version` and `./backend/gradlew -p backend --version`; Gradle release 21 will reject a compiler that cannot compile release 21, but the build command alone does not prove the runtime is exactly JDK 21. Artifact paths above follow the Gradle project `backend`, version `1.0.0`, and Vite workspace default output. Record and verify the actual artifacts; build success alone is not a staging test PASS. Root `npm run build` is also defined, but the explicit workspace and Gradle commands are preferred for per-artifact evidence.

## 3. Bootstrap modes (manual operational verification; blocked by privilege issue above)

`Main.main` calls `Db.open`, applies `schema.sql`, calls `seedIfEmpty`, then checks `--check-only` / `--migrate-only` (`Main.java:14–29`). `seedIfEmpty` returns only when `SEED_DEMO_DATA=false` or `users` is nonempty; otherwise it runs `seed.sql` (`Main.java:83–112`). Thus `--check-only` is **not read-only**, does not itself request seeding, and may seed as a side effect. `--migrate-only` likewise applies schema and calls the seeder first. There is no built-in read-only check-only flag.

**Schema bootstrap, fixture seeding, and read-only verification are separate steps.** The following are command templates only and must not run until the app-account blocker is resolved. Use a protected secret injection/config file, do not put credentials in shell history. Set and review effective host, port, schema, user and password; `PETROFLOW_DB_*` overrides `MYSQL_*` (`Config.java:44–48`). Do not assume local defaults.

1. **Schema bootstrap, no demo rows:** after admin pre-creates an empty disposable staging schema and app-account policy is cleared, run the built JAR with `SEED_DEMO_DATA=false` and `--check-only`. It still performs DDL; it is not read-only.
2. **Optional demo seed:** separate, explicit opt-in run with `SEED_DEMO_DATA=true`, only on empty disposable staging `users`. A nonempty `users` table causes seed skip, not reset. Verify rows independently and never seed production.
3. **Read-only verification:** use a separate verifier with only `SELECT` on the disposable staging schema for metadata/count/read queries. Do not use the application’s `--check-only` for read-only proof.

Illustrative shell assignments (the password must be injected securely; do not put a secret assignment here):

```bash
NODE_ENV=staging SEED_DEMO_DATA=false ENABLE_DEMO_TOOLS=false \
PETROFLOW_DB_HOST="$STG_HOST" PETROFLOW_DB_PORT="$STG_PORT" \
PETROFLOW_DB_NAME=petroflow_staging_verify PETROFLOW_DB_USER=petroflow_stg_app \
java -jar backend/build/libs/petroflow-1.0.0.jar --check-only
```

Do not run `--reset-db` in this plan. Source `Main.resetDatabase()` disables FK checks and drops tables found in the configured schema (`Main.java:43–58`); that is destructive. No destructive operation may target anything except a specifically approved disposable staging schema.

## 4. Test evidence contract

Every test below has classification, preconditions, procedure, expected status/body, independent SQL evidence and cleanup. Capture source commit, staging server/version, schema, UTC time, request/response headers and body with credentials redacted, JVM/server logs, harness logs and query output. A command exit code alone is never a PASS. If the listed synchronization/evidence cannot be captured, report **BLOCKED** or **INCONCLUSIVE**, not PASS.

All API paths include `/api/v1`; `Web.java:90–103` strips that prefix before matching. JSON API responses use `{ "data": ... }` for success and `{ "error": {"code":..., "message":...} }` for errors (`Web.java:502–520`).

### STG-03 — JVM kill after observed lock wait and intended uncommitted write

**Classification:** Integration harness required; not currently executable against the public API. The repository has no public pause/transaction test hook. A separate SQL connection waiting on a lock is not evidence about the application JVM and must not be used as a substitute. If the required harness cannot execute inside the target JVM-C and use its actual application pool connection, this test is **BLOCKED**, not passed.

**Preconditions:** disposable staging schema only; one identified test JVM-C; no production route; no concurrent test traffic; a harness running in JVM-C that can enter `Db.tx`, expose its MySQL `CONNECTION_ID()` and `CONNECTION_ID`↔JVM PID/transaction correlation, and pause at explicit latches. Harness creates/uses only a uniquely named disposable test table and a known row in staging; no application/business rows. Its table fixture is exactly `(id VARCHAR(64) PRIMARY KEY, value INT NOT NULL, run_id VARCHAR(64) NOT NULL)` with target row value 1 and blocker row value 1 in the same test table. After replacing `<RUN_TAG>` with alphanumeric/underscore run tag and IDs with generated values, setup is:

```sql
CREATE TABLE petroflow_staging_verify.stg03_<RUN_TAG> (
  id VARCHAR(64) PRIMARY KEY, value INT NOT NULL, run_id VARCHAR(64) NOT NULL
) ENGINE=InnoDB;
INSERT INTO petroflow_staging_verify.stg03_<RUN_TAG>(id,value,run_id)
VALUES ('target_<RUN_TAG>',1,'<RUN_UUID>'),('blocker_<RUN_TAG>',1,'<RUN_UUID>');
```

Create/drop only this uniquely named table in the disposable schema. The harness transaction must make an update to that row, retaining the transaction uncommitted, then issue a same-transaction read that returns its own updated value and records that result with the target connection/trx IDs, then attempt to acquire a second lock held by a separate harness blocker transaction. Use `SELECT ... FOR UPDATE` / an UPDATE matching the test row, not a fixed sleep. The observer must be able to match the target connection to the row-level granted and waiting locks below; harness logs alone are not enough.

**Synchronization immediately before SIGKILL:** an independent observer records the following MySQL server-side evidence, substituting recorded numeric IDs and generated table/row values. Both rows are required: a WAITING lock held by target trx on the intentionally contended row, and a GRANTED lock belonging to the same target trx on the intended row it changed. The blocker trx and target trx IDs must be distinct.

```sql
SELECT t.trx_id,t.trx_state,t.trx_mysql_thread_id,t.trx_query,
       w.requesting_engine_transaction_id,w.blocking_engine_transaction_id,
       dl.OBJECT_SCHEMA,dl.OBJECT_NAME,dl.INDEX_NAME,dl.LOCK_TYPE,dl.LOCK_MODE,
       dl.LOCK_STATUS,dl.LOCK_DATA
FROM performance_schema.data_lock_waits AS w
JOIN information_schema.innodb_trx AS t
  ON t.trx_id=w.requesting_engine_transaction_id
JOIN performance_schema.data_locks AS dl
  ON dl.ENGINE='INNODB'
 AND dl.ENGINE_TRANSACTION_ID=w.requesting_engine_transaction_id
WHERE t.trx_mysql_thread_id=<TARGET_MYSQL_CONNECTION_ID>
  AND dl.OBJECT_SCHEMA='petroflow_staging_verify'
  AND dl.OBJECT_NAME='<HARNESS_TABLE>'
ORDER BY dl.LOCK_STATUS,dl.LOCK_DATA;
```

`data_locks` exposes `LOCK_STATUS` values `WAITING`/`GRANTED`. The harness must arrange distinct target-table rows so the server output shows the target transaction’s granted record lock for the intended write row and a waiting lock for the deliberately blocked row. If optimizer/index behavior means the intended lock cannot be unambiguously identified, stop; do not infer it from transaction state. Save this query output immediately before the signal. Verify the intended row’s committed pre-test value in a separate consistent observer query; the target’s uncommitted new value is not visible to that observer, so the granted lock + harness-recorded exact UPDATE and trx identity form the server/harness evidence chain.

Only after those pre-signal artifacts are recorded, signal the verified JVM-C PID with OS `kill -KILL <PID>`. Then require MySQL to show its connection gone and transaction rolled back; restart the same app configuration and verify health. **Expected API status:** none (no test API route). After JVM restart, `GET $BASE/api/v1/health` must return HTTP 200 and `data.ok=true`, `data.service="petroflow-java"`. **Independent SQL evidence:** using the recorded numeric connection ID and test row ID, both transaction and connection lookups return no active target, and the row is unchanged:

```sql
SELECT trx_id,trx_state,trx_mysql_thread_id FROM information_schema.innodb_trx
WHERE trx_mysql_thread_id=<TARGET_MYSQL_CONNECTION_ID>;
SELECT THREAD_ID,PROCESSLIST_ID,PROCESSLIST_USER,PROCESSLIST_DB
FROM performance_schema.threads WHERE PROCESSLIST_ID=<TARGET_MYSQL_CONNECTION_ID>;
SELECT id,value,run_id FROM petroflow_staging_verify.<HARNESS_TABLE>
WHERE id='<TARGET_ROW_ID>' AND run_id='<RUN_UUID>';
```

The first two queries must return no target connection/transaction; the last must show the pre-test committed value, not the harness's uncommitted value. Test table/row cleanup is limited to exact generated IDs. The kill and recovery alone do not pass the test.

### STG-04 — exact idempotency request hash and active-claim response

**Classification:** API request with manual SQL fixture setup; exact hash calculation requires a temporary external harness or JShell reflection helper. No application file is edited. This test is blocked until bootstrap/app authentication can run under permitted privileges.

Source behavior (`Web.java:182–196, 402–415`, `Passwords.java:54–59`): hash = lowercase hex SHA-256 over UTF-8 bytes of `Json.stringify(canonicalize(Json.parse(requestBody)))`; maps recursively sorted by key, arrays remain ordered, strings/numbers/booleans/null retain parsed types. Scope is method + route path after `/api/v1` removal + raw query if any. For `POST /api/v1/finance/credit-sales` with no query scope is exactly `POST /finance/credit-sales` (`FinanceApi.java:14–18`). Idempotency key is trimmed. Body keys and values are hashed; headers/URL are not.

**Concrete fixture template:** use actual, SQL-read staging `tenant_id`, station ID and customer ID belonging to that tenant and authorized user. Body must be exactly the bytes posted; JSON values below are strings (not numeric JSON):

```json
{"amount":"1.00","customerId":"<REAL_CUSTOMER_ID>","stationId":"<REAL_STATION_ID>"}
```

Do not send this with literal placeholders. Resolve valid IDs from staging, verify station access, day is open, and customer's credit limit can accommodate the amount. To make the idempotency test harmless, the seeded record will prevent the credit-sale handler from executing. Use a unique key such as `stg04-<RUN_UUID>` (under 200 chars).

**Exact hash calculation procedure:** compile the already-built repo classes; write the following temporary helper outside the repository (for example `/tmp/PfHash.java`) and supply the exact body through stdin. Reflection is needed because `Web.canonicalize` is private. This calls the repo’s `Json.parse`, private canonicalizer, `Json.stringify`, and `Passwords.sha256`, rather than reproducing them in another JSON implementation:

```java
import in.petrolflow.Json;
import in.petrolflow.Passwords;
import in.petrolflow.Web;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class PfHash {
  public static void main(String[] args) throws Exception {
    String body = new Scanner(System.in, StandardCharsets.UTF_8).useDelimiter("\\A").next();
    Method canonicalize = Web.class.getDeclaredMethod("canonicalize", Object.class);
    canonicalize.setAccessible(true);
    Object canonical = canonicalize.invoke(null, Json.parse(body));
    String text = Json.stringify(canonical);
    System.out.println("canonical=" + text);
    System.out.println("request_hash=" + Passwords.sha256(text));
  }
}
```

Build classes first, then compile and run the temporary helper (not an application source edit):

```bash
javac --release 21 -cp backend/build/classes/java/main -d /tmp /tmp/PfHash.java
printf '%s' "$EXACT_BODY" | java -cp backend/build/classes/java/main:/tmp PfHash
```

On Windows use `;` instead of `:` in the Java classpath. The output `canonical=` must be retained and independently compared to the exact posted JSON’s parsed/canonical representation; copy only the generated `request_hash`. Do not hand-construct a hash or use zeros.

**Manual SQL fixture:** using an authorized staging operator, substitute the quoted values from verified staging records and a UTC ISO future expiry (same lexically sortable ISO format used by application). Confirm source table DDL first (`SHOW CREATE TABLE petroflow_staging_verify.idempotency_keys`). Then:

```sql
SET @test_id = 'idm_stg04_<RUN_UUID>';
SET @test_tenant = '<REAL_TENANT_ID>';
SET @test_scope = 'POST /finance/credit-sales';
SET @test_key = 'stg04-<RUN_UUID>';
SET @test_hash = '<HASH_FROM_PFHASH_OUTPUT>';
SET @now_iso = '<CURRENT_UTC_ISO_TIMESTAMP_WITH_MILLISECONDS_AND_Z>'; 
SET @future_iso = '<UTC_ISO_TIMESTAMP_AFTER_NOW_AND_BEFORE_TEST_END>';
INSERT INTO petroflow_staging_verify.idempotency_keys
 (id,tenant_id,scope,`key`,request_hash,status,response_status,response_body,created_at,expires_at)
VALUES (@test_id,@test_tenant,@test_scope,@test_key,@test_hash,'IN_PROGRESS',NULL,NULL,@now_iso,@future_iso);
SELECT id,tenant_id,scope,`key`,request_hash,status,response_status,response_body,expires_at
FROM petroflow_staging_verify.idempotency_keys
WHERE tenant_id=@test_tenant AND scope=@test_scope AND `key`=@test_key;
```

Send the exact body with `Content-Type: application/json`, valid session cookie, and `Idempotency-Key: <same test key>`:

```bash
curl -i -X POST "$BASE/api/v1/finance/credit-sales" \
  -H 'Content-Type: application/json' -H "Cookie: $SESSION_COOKIE" \
  -H "Idempotency-Key: $TEST_KEY" --data-binary "$EXACT_BODY"
```

**Expected:** HTTP 409, JSON error code `IDEMPOTENCY_IN_PROGRESS`; source can poll an active claim and eventually returns this status. The response must not be called a hash-mismatch test. A different body with same key is a distinct conflict case, expected 409 with “already been used with a different request payload”; do not combine these assertions. Independently verify same row’s exact hash equals helper output and stays `IN_PROGRESS`, response fields remain NULL, no matching credit entry exists, and customer balance is unchanged. Run exact cleanup only after capture:

```sql
DELETE FROM petroflow_staging_verify.idempotency_keys
WHERE id=@test_id AND tenant_id=@test_tenant AND scope=@test_scope AND `key`=@test_key;
SELECT COUNT(*) AS remaining FROM petroflow_staging_verify.idempotency_keys WHERE id=@test_id;
```

Manual SQL setup/cleanup is allowed only in disposable staging; never grant the app extra privileges for it. A missing row after API call is failure/inconclusive, not a pass.

### STG-05 — actual app pool exhaustion, 503, release, recovery

**Classification:** integration harness plus API request; not achievable through current public API alone. A harness must share the same JVM and exact `Db` pool as the HTTP API. A different process with its own `Db.open()` pool does not occupy the server JVM’s pool and is not valid evidence. If no supported same-JVM harness can be provided without changing app code, mark **BLOCKED**; do not claim API-only verification.

**Preconditions:** resolve startup privilege blocker; staging-only instance; set effective `PETROFLOW_DB_POOL_MAX=2`, `PETROFLOW_DB_POOL_TIMEOUT_MS=1000` (Config clamps timeout minimum to 1000, `Config.java:49–52`); one authorized account with `customers.read`; valid customer ID; no unrelated traffic; same-JVM harness with two worker threads. Harness calls public `Db.withConnection` twice concurrently, each holds its lease on a latch and executes `SELECT CONNECTION_ID()` on the leased connection. Record the two distinct MySQL connection IDs. Harness must also observe/record the in-process pool counts `Db.poolActiveCount()==2`, `Db.poolMaxSize()==2` while both latch holds are active; server process-list evidence alone does not prove permits are occupied. There is no public pool diagnostics endpoint.

**Synchronization:** do not issue request three until both leases and pool counters are confirmed. A valid session token is itself resolved through MySQL in `Auth.fromToken` (`Auth.java:55–75`), so the 503 can occur during authentication before the customer-ledger handler runs; this proves request-level pool exhaustion, not that the handler SQL began. Do not claim downstream handler coverage from this test. Then issue:

```bash
curl -i -b "$SESSION_COOKIE" "$BASE/api/v1/finance/customer-ledger?customerId=$CUSTOMER_ID"
```

Route is registered at `FinanceApi.java:15`; handler requires `customers.read` and a valid tenant customer (`FinanceApi.java` customerLedger handler). **Expected:** HTTP 503, error code `DB_POOL_EXHAUSTED` (`Db.java:253–265`); not `DB_UNAVAILABLE`. Save timestamps, HTTP response, in-JVM active/max counts and the two connection IDs. Release both latches in a `finally` path even if the request fails. Wait on latch state, not fixed sleep. Require pool active count to return to zero after both workers complete, then repeat identical GET: **expected HTTP 200** with `data.customer`, `data.ledger`/`data.entries`, `data.closingBalance`, `data.creditLimit`, `data.availableCredit`, `data.overdueAmount`, `data.note` (`FinanceApi.java` customerLedger result). Independently verify customer row and posted ledger entries:

```sql
SELECT id,tenant_id,balance,credit_limit FROM petroflow_staging_verify.customers WHERE id='<CUSTOMER_ID>';
SELECT id,tenant_id,station_id,customer_id,type,amount,status,occurred_at
FROM petroflow_staging_verify.credit_entries
WHERE tenant_id='<TENANT_ID>' AND customer_id='<CUSTOMER_ID>' AND status='POSTED'
ORDER BY occurred_at,created_at;
SELECT PROCESSLIST_ID,PROCESSLIST_USER,PROCESSLIST_DB,PROCESSLIST_STATE
FROM performance_schema.threads WHERE PROCESSLIST_ID IN (<LEASE_CONN_ID_1>,<LEASE_CONN_ID_2>);
```

The third request should not have acquired a connection while both leases are held. DB process-list is supplementary; combine it with source pool counters/harness events. Recovery PASS requires post-release pool capacity and second HTTP 200 with matching SQL read. No business mutation is expected; cleanup is release/close of the two harness leases and harness resources only.

### STG-06 — deterministic real InnoDB deadlock and outer retry

**Classification:** integration harness only. Current public credit-sale API does not expose deterministic two-row lock ordering (`FinanceApi.java:293–328`); concurrent sales are ordinary contention and are not this test. Harness must use same staging MySQL/InnoDB engine and call top-level `Db.tx` in the same harness process. If two-worker coordination cannot cause and capture a real cycle, mark **BLOCKED**; never relabel lock waiting/contention as deadlock.

Create only these disposable harness tables in the staging schema; insert two rows in each with a unique run ID. `CREATE TABLE petroflow_staging_verify.stg_deadlock_rows (id CHAR(1) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, value INT NOT NULL) ENGINE=InnoDB;` and `CREATE TABLE petroflow_staging_verify.stg_deadlock_outcomes (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, run_id VARCHAR(64) NOT NULL, worker_id CHAR(1) NOT NULL, UNIQUE KEY uq_run_worker (run_id,worker_id)) ENGINE=InnoDB;`. Use row IDs `A`,`B` for the run and initialize only in the disposable API staging schema: `INSERT INTO petroflow_staging_verify.stg_deadlock_rows(id,run_id,value) VALUES ('A','<RUN_UUID>',0),('B','<RUN_UUID>',0);`. Each of two worker threads calls top-level `Db.tx` and on its first callback attempt locks its own row (`SELECT ... FOR UPDATE`), signals a barrier, then attempts the other row in opposite order. Release second-lock attempt only after both first locks are confirmed by SQL. On a retry callback invocation, use a harness attempt counter to bypass the first-attempt barrier/order and do a single safe write so retry can commit. Each callback increments an in-memory attempt counter; each committed transaction inserts exactly one marker row carrying its worker/run ID in the same transaction. Do not use application business tables or claim this harness is an API test.

**Required synchronized evidence:** two first locks granted, then both opposite second-lock attempts represented in `performance_schema.data_lock_waits`; capture immediate `SHOW ENGINE INNODB STATUS\G` and MySQL error log showing a real deadlock and victim 1213. Source maps MySQL 1213 to `DB_DEADLOCK` (`Mysql.java:684`); source `Db.tx` catches that code at its outermost boundary and retries through at most 16 total attempts (`Db.java:18,85–100`). The successful test requires at least one worker callback to have been invoked again after rollback, proving outer retry, and both workers to finish successfully. There is no public HTTP response exposing intermediate deadlock because successful retry hides it; expected HTTP status: none. Do not assert a 503 for a successfully retried harness transaction.

**Independent SQL verification:** substitute generated run IDs and exact harness tables:

```sql
SELECT id,worker_id,run_id FROM petroflow_staging_verify.stg_deadlock_outcomes WHERE run_id='<RUN_UUID>' ORDER BY worker_id;
SELECT COUNT(*) AS outcome_count,COUNT(DISTINCT worker_id) AS worker_count
FROM petroflow_staging_verify.stg_deadlock_outcomes WHERE run_id='<RUN_UUID>';
SELECT trx_id,trx_state,trx_mysql_thread_id FROM information_schema.innodb_trx;
```

Exactly two committed markers (one per worker), no duplicate worker marker, callback count for victim greater than one, no active run transaction, and captured real 1213 cycle are all required. If engine scheduling or lock evidence does not produce a real cycle, the run is inconclusive. Cleanup only exact run-ID outcome rows and the two harness tables after artifacts are retained; table drop allowed only in the uniquely named disposable staging schema. This verifies `Db.tx` retry mechanics, not retry behavior through a credit-sale API endpoint.

### STG-07 — unauthenticated API authorization boundary

**Classification:** API. Requires running staging API, which is currently blocked by the startup privilege issue. Preconditions: approved disposable schema; choose a real staging customer ID; send no cookie/Authorization header; verify endpoint path exact.

Request:

```bash
curl -i "$BASE/api/v1/finance/customer-ledger?customerId=$CUSTOMER_ID"
```

Source registers GET `/finance/customer-ledger` (`FinanceApi.java:15`); handler calls `requireAuth()` before querying customer (`FinanceApi.java:77 onward`); unauthenticated response is **401** with error code `UNAUTHORIZED` (message is source-generated). No request body or payload. This is an authorization negative test, not a data read PASS. Capture HTTP status/body. Before/after SQL confirms the selected customer and ledger counts are unchanged (read-only endpoint):

```sql
SELECT id,tenant_id,balance FROM petroflow_staging_verify.customers WHERE id='<CUSTOMER_ID>';
SELECT COUNT(*) AS posted_entries FROM petroflow_staging_verify.credit_entries
WHERE tenant_id='<TENANT_ID>' AND customer_id='<CUSTOMER_ID>' AND status='POSTED';
```

**Cleanup:** none; no session or writes should be created. If a login cookie was accidentally sent, invalidate it and invalidate the run evidence.

### STG-08 — authorized customer catalog read and exact row check

**Classification:** API. Preconditions: authenticated owner/manager/staff account with `customers.read`; customer belongs to session tenant; for staff, customer station scope may return station-scoped balance. No mutation. Source registers `GET /catalog/customers` (`CatalogApi.java:36`) and handler requires `customers.read` (`CatalogApi.java:125–128`); result is 200 list with pagination meta (`CatalogApi.java:145–188`). Query params are optional `search`/`q`, `page`, `size`, and permitted `stationId`; do not send unsupported body fields.

Use a unique customer code/name that exists in the isolated staging fixture. Example request (URL-encode search value):

```bash
curl -i -b "$SESSION_COOKIE" "$BASE/api/v1/catalog/customers?search=$URLENCODED_UNIQUE_NAME&page=1&size=20"
```

**Expected:** HTTP 200; `data` is an array containing the chosen row’s camel-cased `id`, `tenantId`, `code`, `name`, and `balance`; `meta` contains pagination fields from `Domain.page`. Compare database row independently (for non-owner scoped roles, balance is scoped to allowed stations and need not equal raw customer balance):

```sql
SELECT id,tenant_id,code,name,balance,credit_limit,status
FROM petroflow_staging_verify.customers
WHERE tenant_id='<TENANT_ID>' AND id='<CUSTOMER_ID>' AND code='<CUSTOMER_CODE>';
SELECT COUNT(*) AS matches FROM petroflow_staging_verify.customers
WHERE tenant_id='<TENANT_ID>' AND name LIKE CONCAT('%','<UNIQUE_NAME>','%');
```

Require one exact row matching HTTP identity and no unexpected tenant rows. **Cleanup:** none for read-only request; if a dedicated customer fixture was created separately, remove it only by exact test ID after confirming no referencing row, otherwise retain disposable schema until approved teardown. Do not delete historical/shared demo fixture rows.

### STG-09 — one successful credit sale with independent business-state checks

**Classification:** API mutation with disposable fixture preconditions. This is a separate ordinary functional workflow, not a deadlock test. Requires unblocked app startup, active owner/all-stations session with `sales.write`, tenant/station access, valid existing customer, open business date, positive credit headroom and no conflicting idempotency key. Capture the exact pre-request customer balance with the SELECT-only verifier before POST. Source route `POST /finance/credit-sales` (`FinanceApi.java:17`), handler/permission and body/validation/transaction/return at `FinanceApi.java:273–328`.

Use exact minimal JSON body with real IDs:

```json
{"amount":"1.00","customerId":"<CUSTOMER_ID>","stationId":"<STATION_ID>","reference":"stg09-<RUN_UUID>"}
```

No `productId` is needed when `amount` is provided. `occurredAt` omitted means application-resolved current time. Do not use if day is closed or balance+1.00 exceeds a positive credit limit. Send a fresh `Idempotency-Key: stg09-<RUN_UUID>` so the API stores an idempotency claim. Exact request:

```bash
curl -i -X POST "$BASE/api/v1/finance/credit-sales" \
  -H 'Content-Type: application/json' -b "$SESSION_COOKIE" \
  -H "Idempotency-Key: stg09-$RUN_UUID" \
  --data-binary "$EXACT_BODY"
```

**Expected:** HTTP 201; `data` contains `id,customerId,slipNumber,amount,newBalance`; amount formatted `1.00`. DB verification (source columns in `schema.sql:686–732`, audit columns `836–853`):

```sql
SELECT id,tenant_id,station_id,customer_id,type,amount,slip_number,occurred_at,due_date,status,created_by
FROM petroflow_staging_verify.credit_entries
WHERE id='<RETURNED_ID>' AND tenant_id='<TENANT_ID>' AND station_id='<STATION_ID>'
  AND customer_id='<CUSTOMER_ID>' AND type='CREDIT_SALE' AND status='POSTED';
SELECT COUNT(*) AS exact_rows
FROM petroflow_staging_verify.credit_entries
WHERE id='<RETURNED_ID>' AND tenant_id='<TENANT_ID>' AND station_id='<STATION_ID>'
  AND customer_id='<CUSTOMER_ID>' AND type='CREDIT_SALE' AND status='POSTED'
  AND CAST(amount AS DECIMAL(18,2))=1.00;
SELECT id,balance,credit_limit FROM petroflow_staging_verify.customers
WHERE id='<CUSTOMER_ID>' AND tenant_id='<TENANT_ID>';
SELECT id,tenant_id,station_id,actor_id,action,entity,entity_id,created_at
FROM petroflow_staging_verify.audit_logs
WHERE tenant_id='<TENANT_ID>' AND action='CREDIT_SALE_RECORDED'
  AND entity='CreditEntry' AND entity_id='<RETURNED_ID>';
SELECT tenant_id,scope,`key`,request_hash,status,response_status,response_body
FROM petroflow_staging_verify.idempotency_keys
WHERE tenant_id='<TENANT_ID>' AND scope='POST /finance/credit-sales'
  AND `key`='stg09-<RUN_UUID>';
```

Require exactly one entry and one audit row, customer balance increase matching prior balance + 1.00, idempotency row `COMPLETED`, response status 201, and response ID matches returned ID. Capture customer balance before request through SELECT-only verifier. A second identical request may be sent as a separate replay check; expected 201, header `Idempotent-Replayed: true`, same response ID/body, and unchanged entry count/customer balance. **Cleanup:** no direct delete from business/history tables. Keep fixture and resulting records in the disposable schema; remove entire schema only via separately approved staging teardown after validation. Never run reset/drop against anything but disposable staging.

### STG-10 — actual object inventory, backup privileges, isolated restore

**Classification:** Manual operational verification by DBA/backup operator. Not API-executable. Do not run against production or use production backup material. Restore destination is exclusively `petroflow_staging_restore_verify`.

Before dump, use a read-only verifier/admin and capture actual objects:

```sql
SELECT TABLE_NAME,ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA='petroflow_staging_verify' ORDER BY TABLE_NAME;
SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='petroflow_staging_verify' ORDER BY TABLE_NAME;
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='petroflow_staging_verify';
SELECT ROUTINE_TYPE,ROUTINE_NAME,DEFINER,SECURITY_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='petroflow_staging_verify';
SELECT EVENT_NAME,DEFINER,STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='petroflow_staging_verify';
```

Use a dedicated backup identity, not the app identity. Validate effective privileges **before** dump using DBA `SHOW GRANTS FOR '<BACKUP_USER>'@'<BACKUP_HOST>'` and a staging-only dry run. MySQL 8 `mysqldump` requires appropriate `SELECT` access to dumped tables, `SHOW VIEW` for views, and `TRIGGER` for triggers. `--single-transaction` avoids table locks for consistent InnoDB table data, but nontransactional objects invalidate that consistency guarantee. Depending on MySQL 8 minor release/options, `PROCESS` can be needed for tablespaces (use `--no-tablespaces` where supported); routines/events have version-specific metadata authorization, including `SHOW_ROUTINE` in relevant releases. Check the installed `mysqldump --version` and matching MySQL 8 manual, inspect `SHOW GRANTS`, and perform an actual staging-only dump while capturing warnings. Never add global PROCESS or other global privileges to the app; if a backup operator requires them, use a separately approved operator account and assess least privilege.

Dump command (password prompt; file on protected staging-only storage):

```bash
mysqldump --version
mysqldump -h "$STG_HOST" -P "$STG_PORT" -u "$BACKUP_USER" -p \
  --single-transaction --routines --events --triggers --no-tablespaces \
  petroflow_staging_verify > /secure/staging-verify.sql
```

Check exit status and warnings. **Mandatory gate before any restore:** inspect a copy of the dump for `CREATE DATABASE`, `USE`, fully qualified schema names, `DEFINER`, triggers/routines/events, and references to any schema other than `petroflow_staging_restore_verify`. Do not import until the dump is proven not to select/create/overwrite any other schema. If adjustment is needed, alter only a copy of this disposable staging dump and repeat inspection. Use a restore operator with only necessary rights on the restore destination plus explicitly approved object rights; verify its grants first. Create destination as DBA only after confirming it does not already contain valuable data:

```bash
mysql -h "$STG_HOST" -P "$STG_PORT" -u "$STAGING_DBA" -p \
  -e "CREATE DATABASE petroflow_staging_restore_verify CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
```

After dump inspection, import using destination-qualified client, but abort if dump contains an unsafe `USE`/database DDL as above:

```bash
mysql -h "$STG_HOST" -P "$STG_PORT" -u "$RESTORE_USER" -p \
  petroflow_staging_restore_verify < /secure/staging-verify-reviewed.sql
```

Restore **only** to `petroflow_staging_restore_verify`; never source schema, production, or an unreviewed target. Afterward repeat all object inventory queries substituting restore schema. Compare per-table row counts with source; sample checksums only for deterministic tables/columns, not ordering-dependent aggregate hashes. Verify no table/object appeared outside restore schema by querying `information_schema` for both staging schemas. **Cleanup:** retain evidence/dump according to staging retention; drop only `petroflow_staging_restore_verify` after separate DBA approval and explicit confirmation it is disposable. Never drop source or production.

## 5. Findings-to-corrections mapping

| Independent-review finding | Correction in this revision |
|---|---|
| Application `CREATE DATABASE` versus no-global-privilege policy | §1 documents MySQL 8 global CREATE requirement, forbids widening grants, and identifies separate minimum source change/pre-created schema contract. |
| STG-03 lock wait did not prove target write | STG-03 now requires same target transaction’s `WAITING` and `GRANTED` locks, same-transaction read-after-write record, exact pre-signal query, and post-kill rollback/recovery checks. |
| STG-04 hash was illustrative | STG-04 now invokes repository `Json.parse`, private `Web.canonicalize`, `Json.stringify`, and `Passwords.sha256` using a temporary helper; provides real-body template, manual insert/query/delete SQL and expected 409. |
| STG-05 leases not proven | STG-05 requires same-JVM actual `Db` pool leases, connection IDs and `poolActiveCount`/max evidence before request three, 503 code, latch release and 200 recovery. |
| STG-06 not a genuine deadlock/retry test | STG-06 specifies InnoDB harness-only tables, opposing locks, barriers, required 1213 evidence, outer callback retry and exactly-once markers; explicitly blocks if no real cycle. |
| STG-07…09 underspecified | STG-07 authorization negative, STG-08 catalog read, STG-09 credit-sale mutation now include route, permissions, payload, HTTP, SQL evidence and cleanup constraints. |
| STG-10 privilege/restore ambiguity | STG-10 inventories tables/views/triggers/routines/events, separates backup/restore operator grants, mandates dump inspection before import, and fixes restore target. |
| Bootstrap/seed/check-only conflated | §3 distinguishes DDL bootstrap, opt-in seed, and SELECT-only verification; accurately documents `--check-only` order/side effects. |
| Build artifact/version commands | §2 enforces Node/JDK versions, names exact workspace/Gradle commands, and tests expected artifact paths. |

## 6. Remaining blockers/dependencies and readiness

1. **Critical:** app’s initial MySQL connection issues `CREATE DATABASE IF NOT EXISTS`; this conflicts with the no-global-privilege policy. Separate app change or another source-supported secure connection design is required. Do not grant global CREATE. This documentation-only request does not authorize that change.
2. **STG-03 and STG-05:** current public API has no same-JVM transaction/pool pause hooks. A harness must share the JVM and actual pool, otherwise these tests cannot establish evidence about the API process. If such harness cannot be provided without app instrumentation, report blocked.
3. **STG-04:** manual SQL row fixture and a temporary hash helper are prerequisites; request body and hash must be exact and captured.
4. **STG-06:** requires real MySQL scheduling evidence and a deterministic same-process `Db.tx` harness; no API route guarantees the deadlock or exposes internal retry. No HTTP deadlock PASS should be reported.
5. **STG-07…09:** specified above as source-backed auth-negative, catalog-read, and credit-sale tests. They are blocked until app startup/security requirements are satisfied and staging fixture/permissions/date/credit limit are verified.
6. **STG-10:** operator must validate grants against actual MySQL 8 minor version and inspect dump before import. Restore destination is fixed to `petroflow_staging_restore_verify`.
7. Build verification is not database execution. Confirm actual artifacts before attempting any later staging run.

**Final verdict: NOT EXECUTION-READY.** No tests passed or were run. This document is the only authorized change; no application code, schema/data, seed file, or production configuration may be changed under this task.
