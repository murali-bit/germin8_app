# Tally to Zoho Books Migration Tool: Project Brief for Review

## 1. How to use this brief

Written on 15 Nov 2026 by Claude (an AI coding assistant) for the project owner, from a direct read of the code, docs, tests and audit reports. Every fact is checkable through the file paths given (relative to the project root).
**What we want from you:** ideas to improve the tool and make it reliable: architecture, Zoho Books edge cases, the guided UX, testing, charts. Please respect the product rules in section 12, and answer the questions in section 13 first.

---

## 2. The project in one page

| Item | Summary |
|---|---|
| Purpose | Move one company's accounts from **TallyPrime** to **Zoho Books (India edition)** for a financial year, so that Zoho's trial balance equals Tally's. |
| Users | Accountants and CA-firm staff. Not developers. The tool must talk in plain accounting English. |
| What goes in | Three JSON exports from TallyPrime: **All Masters**, **All Transactions** (full year), **Trial Balance** (detailed, with opening, movement and closing). Optional per-dataset uploads (17 dataset slots). |
| What comes out | A zip of Zoho Books import CSV files in import order (chart of accounts, customers, vendors, items, opening balance journal, bills, invoices, manual journals, journals for receipts/payments/contra/notes), plus reference files that must not be imported (credits to apply, predicted Zoho trial balance, opening balance reference) and two READ_ME files. |
| Before download | A **Zoho check** applies 272 machine-readable rules to every row and predicts which rows Zoho "will refuse", "may refuse" or warns about. A **predicted Zoho trial balance** shows what Zoho should show after import, compared with Tally. |
| After download | An **Import Wizard** walks the person through Zoho set-up and each import, one step per page, with locks so steps cannot be done out of order. Then the person uploads Zoho's trial balance and the tool compares it with Tally. |
| Result so far | Three real test imports into Zoho were done with one real test company (counts: 274 customers, 206 vendors, 30 items, 659 vouchers). Round 1: 467 documents refused. Round 3: every file previewed clean; one customer was silently not created and one journal naming it was refused. After round 3, five fix groups changed the posting logic. The **current files have not been imported into Zoho yet**. Offline today: all 659 vouchers are written to files, 0 rows "will be refused", and the predicted Zoho trial balance shows 0 differences on 63 accounts. |
| Status | Working local tool (one machine, localhost). 295 server tests and 54 frontend logic tests pass; lint and build pass. All six fix groups are done and the real Tally files were rebuilt offline into `final-test-run-2` (see section 8). A 12-cluster UX rebuild is planned but not started. An independent three-reviewer pass over the latest batch has not run yet (network drops stopped it). |

---

## 3. Tech stack and how to run it

| Layer | Choice |
|---|---|
| Server | Node.js (ES modules), **Fastify 5**, built-in **`node:sqlite`** (`DatabaseSync`, synchronous), **decimal.js** for money. Only these two npm dependencies (`server/package.json`). CSV, XLSX, XLS readers and the zip writer are hand-written (`server/src/sheet.js`, `server/src/zipstore.js`). |
| Frontend | **React 19**, **Tailwind 4** (via `@tailwindcss/vite`), **Vite 8**, **lucide-react** icons, oxlint. No router, no state library, no data-fetching library, no chart library, no component kit, no TypeScript (`frontend/package.json`). |
| Data | `server/data/` (or `DATA_DIR`): `migration.db` (SQLite, WAL), `uploads/`, `output/`, `tmp/`. |
| Node version | Needs a Node with `node:sqlite`; the dev machine runs Node 24. `package.json` has no `engines` field. |

**Run (two processes):**
- Server: `cd server && npm install && npm start` (or `npm run dev` for watch mode). Listens on `127.0.0.1:3001` only (`server/src/index.js:3278`).
- Frontend: `cd frontend && npm install && npm run dev`. Vite on port 5173 proxies `/api` to the server (`frontend/vite.config.js`). The server does not serve the built `dist/`.
- Tests: `npm test` in each folder (`node --test`). Large-file test: `npm run test:large` in `server/`.
- Sign-in: test users are created on first start from `server/seed-users.json` (plain text; ask the owner). Not included here.

---

## 4. Backend (`server/`)

### 4.1 Architecture

- **Size:** 43 JS modules (about 20,000 lines) plus `server/src/zohorules.json` (10,583 lines). `index.js` alone is 3,279 lines.
- **Request flow:**
  1. Browser to Vite (5173) to Fastify (3001).
  2. Body parsing (`index.js:2030-2074`): JSON up to 300 MB. Tally uploads (`PUT /api/migrations/:id/uploads/:slot`, `application/octet-stream`) are **streamed to disk** in `data/tmp/`, SHA-256 computed on the fly, cap 4 GB. Other binary bodies (Zoho error files, exports) are held in memory up to 60 MB.
  3. Auth hook (`auth.js:49-59`): every `/api` route needs a session cookie except `/api/health` and `/api/auth/login`. Viewers may only send GET.
  4. `need(req, reply)` loads the migration and returns 404 for another firm's data.
  5. Synchronous SQL on **one shared SQLite connection** opened at module import (`index.js:47`). Changes are written to `audit_logs`. Changes that affect output call `markStale()` so files are marked out of date.
- **Upload reading:** `tallystream.js` is a generator that reads one Tally record at a time (1 MB chunks, UTF-8 or UTF-16 LE/BE with or without BOM, max 64 MB per record). It pauses every 2,000 records so the server keeps answering. All Masters / All Transactions are split in one pass into per-dataset files (`index.js:580-680`, routing in `masters.js` and `transactions.js`). The Trial Balance report has its own reader (`trialbalance.js`).
- **Processing** (`POST /process`, job code `index.js:681-1038`): refuses (409) until every required dataset is uploaded or waived and typed record counts match. One job per migration (in-memory `activeRuns`); `?wait=0` returns 202 and the screen polls `/process-status`. Stores every record as full JSON in `source_records` in batches of 1,000. Flags hidden characters, duplicates, unbalanced vouchers, cancelled/optional vouchers, bad dates. Cross-checks vouchers against masters (`crosscheck.js`) and movements against the Tally Trial Balance. On failure everything stored by the run is deleted; interrupted runs are cleaned at startup (`recoverInterruptedRuns`).
- **Generation** (`POST /generate`, `generate()` at `index.js:1542-1976`): merges the person's decisions with automatic defaults (`decisions.js`, `defaults.js`), builds vouchers (`vouchers.js`, `payments.js`, `tds.js`, `taxposting.js`) and masters (`zoho.js`), applies per-firm column layouts (`columns.js`), writes CSVs, stores everything in **one synchronous transaction**, enforces a **voucher control total** (written + left out + waiting + held must equal stored, else it throws at `index.js:1931`), writes a manifest, then runs the Zoho check.
- **Download gates:** refused (409) while a file is out of date, or while the Zoho check predicts refusals and nobody confirmed "download anyway".
- **Rules engine:** `zohorules.json` v1.10 holds 272 rules (197 `blocks_import`, 75 `warning`) across 14 Zoho modules plus 19 general rules, 26 lists (account types, Zoho default accounts, GST treatments, state codes, TDS table, SAC suggestions, tax account map, opening-balance routing), 22 import-order steps and 21 open questions. Each rule has an **evidence level**: 34 confirmed by a real import, 106 from Zoho sample files, 93 from Zoho docs, 37 assumed, 1 forum, 1 contradicted. `zohocheck.js` compiles rules into functions and checks every file in import order, tracking names each master file will create. `zohocheckapi.js` caches results by file checksums + rules version + settings. The same file drives the Import Wizard, Rejection Manager, defaults, predicted trial balance and TDS model.

### 4.2 Modules (grouped)

| Area | Modules (lines) | Role |
|---|---|---|
| Entry and pipeline | `index.js` (3279) | Schema for most tables, upload streaming, splitting, processing job, `generate()`, 38 routes, wiring |
| Tally reading | `tallystream.js` (207), `tally.js` (238), `masters.js` (201), `transactions.js` (96), `trialbalance.js` (335), `fields.js` (367), `catalogue.js` (45), `crosscheck.js` (205) | Streaming reader, encodings, dates, amounts, group tree, voucher-type routing, TB reader, fields not read, 17 upload slots, voucher-to-master checks |
| Output builders | `vouchers.js` (1719), `zoho.js` (1037), `payments.js` (382), `tds.js` (181), `taxposting.js` (88), `taxaccounts.js` (94), `heldfiles.js` (153), `columns.js` (464), `namefix.js` (146), `zipstore.js` (65) | Invoices/Bills/Journals rows, master rows and opening journals, receipts/payments routing, TDS model, tax account placement, optional Payments files, firm column layouts, single name resolver, zip |
| Decisions and defaults | `decisions.js` (807), `defaults.js` (571), `names.js` (609), `taxes.js` (406), `voucheropts.js` (400), `extras.js` (782), `profiles.js` (501), `journalreview.js` (209), `similar.js` (41) | Accountant decisions, 72 zero-decision defaults, names/duplicates/contact fixes, tax and TDS mapping, voucher settings, mapping profiles, journal review and bulk routing |
| Checks and reconciliation | `zohocheck.js` (997), `zohocheckapi.js` (279), `zohocodes.js` (195), `voucherrecon.js` (511), `completenesstable.js` (318), `predictedtb.js` (413), `zohotb.js` (452), `zohoverify.js` (245), `zohoerrors.js` (517) | Zoho check engine, value lists, voucher reconciliation, completeness table, predicted Zoho TB, Zoho TB comparison, "did it arrive in Zoho" checks, Zoho error-file grouping |
| Guidance and reports | `importwizard.js` (1306), `prepare.js` (251), `heldvouchers.js` (189), `testreport.js` (311) | Import Wizard steps/locks/ticks/zip, Progress checklist, held vouchers and credits-to-apply, test run report |
| Auth and utils | `auth.js` (139), `sheet.js` (296) | Login, sessions, roles, firms; CSV/XLSX/XLS reader |

### 4.3 Data tables

65 tables, created with `CREATE TABLE IF NOT EXISTS` in 14 modules. No foreign keys. Few indexes (`source_records(job_id, slot)`, `generated_rows`, `exceptions`, `held_vouchers`, `voucher_recon`).

| Area | Tables |
|---|---|
| Migration and uploads | `migrations`, `uploads`, `waivers`, `expected_counts`, `master_bundles`, `transaction_bundles` |
| Tally data | `source_records` (full JSON), `exceptions`, `trial_balance_lines`, `trial_balance_summary`, `process_runs` |
| Output | `generated_files`, `generated_rows`, `held_vouchers`, `journal_credits`, `doc_total_differs`, `applied_defaults`, `stale_reasons`, `import_status` |
| Routing | `journal_decisions`, `journal_decisions_kept` (kept by Tally GUID across re-reads) |
| Audit and auth | `audit_logs` (no index), `firms`, `users` (scrypt hash), `sessions` |
| Decisions | `firm_settings`, `item_settings`, `item_accounts`, `business_settings`, `account_clash_decisions`, `name_decisions`, `duplicate_decisions`, `contact_fixes`, `hsn_defaults`, `hsn_corrections`, `step_reviews` |
| Mappings and Zoho feedback | `tax_mappings`, `account_type_overrides`, `unit_mappings`, `rejections`, `corrections`, `rejection_runs`, `verification`, `verification_runs`, `zoho_tax_list`, `tax_usage`, `voucher_settings`, `tds_mappings`, `zoho_tds_taxes(_meta)`, `column_mappings`, `mapping_profiles` |
| Import Wizard and checks | `wizard_state`, `wizard_ticks`, `wizard_results` (latest per file only), `wizard_overrides`, `zoho_existing_accounts(_meta)`, `zoho_arrived(_meta)`, `zoho_checks`, `zoho_check_acks`, `voucher_recon`, `zoho_tb_checks`, `zoho_sample_uploads` |

### 4.4 API by purpose (148 route handlers; migration routes start `/api/migrations/:id`)

| Purpose | Main routes |
|---|---|
| Auth, users | `POST /api/auth/login`, `/logout`, `GET /api/auth/me`, `GET/POST /api/users`, `PUT /api/users/:uid` (role and active only) |
| Migrations | `GET/POST /api/migrations`, `GET/PUT /api/migrations/:id` (no delete) |
| Uploads | `PUT/DELETE …/uploads/:slot`, `…/expected-counts/:slot`, `…/waivers/:slot`, `GET …/completeness(-table)` |
| Processing | `POST …/process?wait=0`, `GET …/process-status`, `…/summary`, `…/records` (max 500), `…/trial-balance` |
| Decisions | `…/names`, `…/duplicates`, `…/contact-fixes`, `…/tax-mappings`, `…/tds-mappings`, `…/account-types`, `…/account-clashes`, `…/item-rates`, `…/hsn-*`, `…/unit-mappings`, `…/voucher-settings`, `/api/templates…`, `/api/profiles…` |
| Journals | `GET …/journals`, `PUT/DELETE …/journals/:recordId`, `…/journals/review`, `…/journals/bulk`, `…/journals/pattern`, `…/journals/accept-suggestions` |
| Generate, download | `POST …/generate`, `GET …/assumptions`, `…/files`, `…/files/:key/download?confirmed=1`, `…/download-all` (zip), `…/trace`, `…/crosswalk` |
| Zoho check | `GET …/zoho-check`, `…/zoho-check/rows`, `…/findings.csv`, `POST …/zoho-check/acknowledge` |
| Import Wizard | `GET …/import-wizard`, `PUT …/import-wizard/current`, `…/ticks`, `…/zoho-opening-date`, `…/results/:key`, `…/overrides/:step`, `…/zoho-accounts`, `…/zoho-export/:kind` (+ `missing.csv`), `…/tds-taxes-to-create`; old tracker `…/imports/:key` |
| Held vouchers, credits | `…/held-vouchers`, `…/zoho-samples/:module`, `…/credits-to-apply(.csv)` |
| Rejections | `PUT …/rejections/:key` (Zoho error file), `…/rejections/groups`, `…/corrections`, `…/retry` |
| Reconciliation | `…/verification/:key`, `…/zoho-trial-balance`, `…/predicted-trial-balance(.csv)`, `…/voucher-reconciliation` |
| Reports | `…/report`, `…/audit`, `…/test-report`, `…/prepare` (Progress checklist) |

Status codes: 400 bad input, 404 not found or another firm, 409 wrong state (stale, locked, busy), 413 too large, 422 unreadable file.

### 4.5 Roles

| Role | Can do |
|---|---|
| `super_admin` | Everything, every firm (`?firmId`) |
| `admin` | User management, column layouts, firm GST code set, plus analyst rights |
| `analyst` | Upload, process, decide, generate, download, use the wizard; open a locked wizard step by typing a reason of 10+ characters (except the Migration Date hard lock) |
| `viewer` | GET only; optionally limited to one company by name text |

Sessions: 64-hex `sid` cookie, HttpOnly, SameSite=Strict, fixed 12 hours (`auth.js:7, 72`). Firm separation in `canSee` (`auth.js:133-138`).

### 4.6 Tests and scripts

- `npm test`: 39 test files in `server/test`; 34 build the full app in-process (`buildApp()` + Fastify `inject`) with a temporary `DATA_DIR`. Fixtures are made up (`server/fixtures/`); 7 official Zoho sample files in `zoho-samples/` check headings. Last reported: **286 pass, 0 fail**.
- `npm run test:large` (`server/scripts/large-file-test.js`): 200,000 sales vouchers uploaded over HTTP; measures time, peak memory and `/api/health` responsiveness during upload and processing. **Does not measure `generate()`.**
- `server/scripts/real-run.mjs <tally-folder> <out>`: full in-process run on a real Tally set; ticks every set-up item automatically and downloads with `confirmed=1`. Regression run on real data; skips human checks.
- `server/scripts/make-samples.js`: writes 20 made-up Tally JSON files (including problem files) to `sample-data/`.
- **Not covered:** any real Zoho import, any browser click-through.

---

## 5. Frontend (`frontend/`)

### 5.1 Structure

- About 15,000 lines in `src`; `screens/app` about 10,700, `components` about 2,050. Unused leftovers: `src/data/mockData.js` (670 lines), `clsx` and `tailwind-merge` (listed, never imported).
- **Shell** (`src/App.jsx`): checks the session (`GET /auth/me`); any failure shows Login. Every screen is imported up front (no lazy loading) into a `SCREENS` map. Layout: `Sidebar` left, `Navbar` top, scrolling `<main>`. On guided-flow pages it draws `WizardNav` (numbered steps above, Back / Continue below). No error boundary.
- **Navigation** (`src/navigation.js`): hash addresses (`#/upload-center`, `#/import-wizard?step=…`). 29 entries in `SCREEN_LIST`; 3 old addresses redirect to the Import Wizard. Scroll position saved per address in sessionStorage.
- **Data** (`src/api.js`): `request()` wraps `fetch('/api'+url)`. 401 fires `auth-required` and App shows Login. `useJob()` loads the selected migration with a 2-second shared cache. Selected migration id in localStorage. Window events `migration-selected`, `migrations-changed`. `downloadFile` fetches as a blob so a refused download shows a message.
- **Polling** (no websockets): `/process-status` every 1 s while running; `/prepare` every 4 s while processing or creating files.
- **Import Wizard is server-driven:** `GET /import-wizard` returns steps, order (from `zohorules.json` `import_order`), click paths, options, expected counts, locks and display text. The page draws one step at a time; the current step is in `?step=` and saved on the server.

### 5.2 The guided flow (8 steps, one page each, `frontend/src/navigation.js:49-58`)

| Step | Page | Screen file |
|---|---|---|
| 1 | Migration details | `Screen12_NewMigration.jsx` |
| 2 | Upload the Tally files | `Screen15_UploadCenter.jsx` |
| 3 | Completeness Check | `Screen16_CompletenessCheck.jsx` |
| 4 | Read the Tally data | `Screen17_ProcessingStatus.jsx` |
| 5 | Check names, accounts and rates ("Mapping Studio") | `Screen19_SmartMapping.jsx` + `MappingDecisions.jsx`, `NamesAndContacts.jsx`, `VoucherDecisions.jsx` |
| 6 | Decide where each journal goes | `Screen20_TransactionClassification.jsx` |
| 7 | Create and download the files ("Export Center") | `Screen25_ExportCenter.jsx` |
| 8 | Import into Zoho Books | `Screen40_ImportWizard.jsx` (about 990 lines) |

"Progress checklist" (`PrepareMigration.jsx`, formerly "Prepare migration") is an overview, not a step. The step number appears as a badge on the side-menu item.

### 5.3 Other screens

| Screen | File | Purpose |
|---|---|---|
| Dashboard | `Screen11_Dashboard.jsx` | Migrations list, 8-step progress strip, "Your next step", tiles |
| Tally Export Guide / Export Catalogue | `Screen13_…`, `Screen14_…` | Text steps for the three Tally exports; table of reports |
| Data Explorer | `Screen18_DataExplorer.jsx` | Browse records (first 500), trial balance, row detail |
| Template Library / Mapping | `Screen22_…`, `Screen23_…` | Firm-wide Zoho column layouts |
| Validation Center | `Screen24_…` | Flagged items by kind with Fix links |
| Zoho check | `ZohoCheck.jsx` | Rows Zoho will/may refuse, by file and cause |
| Voucher Reconciliation | `VoucherReconciliation.jsx` | Where every Tally voucher went |
| Rejection Manager | `Screen28_…` | Upload Zoho error files, causes, corrections, retry file |
| Identifier Tracker | `Screen29_…` | Follow a record Tally to file to Zoho (first 300) |
| Reconciliation | `Screen30_…`, `ZohoTrialBalance.jsx` | Zoho TB vs Tally; module reports |
| Reports and Audit | `Screen31_…`, `TestRunReport.jsx` | History, audit log, test-run report, Print |
| Settings | `Screen32_…`, `Screen33_MappingProfiles.jsx`, `Screen34_SystemSettings.jsx` | Company, profiles, users and roles |
| Help, Login, NotFound | `Screen35_…`, `Login.jsx`, `NotFound.jsx` | Help text, sign-in |

Side menu: 26 items in 7 groups (`components/layout/Sidebar.jsx:41-103`).

### 5.4 Components and design

- `components/ui.jsx` (360 lines): button class strings, `PageHeader`, `Card`, `Table` (checkbox selection), `StatusChip`, `StatTile`, `Field`, `Stepper`, `ActionBar`, `EmptyState`, `Note`, `FileButton`, `friendlyError`.
- Shared parts: `JobHeader`, `WizardNav`/`PinnedStepBar`, `CreateFiles`, `OutOfDateBanner`, `ProcessingProgress`, `CompletenessTable`, `ExpectedTrialBalance`, `Assumptions`, `HeldNotice`, `HelpTip`, and others.
- Look copies Zoho Books (`src/index.css` `@theme`): white chrome, grey page `#f5f6fa`, Zoho blue `#408dfb`, deeper `#2b6fd4` for text contrast, status colour sets, small corners. Fonts Inter and JetBrains Mono from Google Fonts (needs internet).
- No charts, no pictures (`<img>`), no toasts, no shared confirm dialog, no skeletons, no tour.

### 5.5 Tests, build, lint

- `node --test`: 9 files in `frontend/test`, **52 pass, 0 fail** (run while writing this brief). All test plain logic (navigation, dates, wizard helpers, mapping logic, help wording). **No test renders a React component**; no jsdom or testing library.
- `vite build`: one JS file of about 960 KB, no code splitting.
- oxlint: 0 errors, 78 warnings (41 `set-state-in-effect`, 26 `static-components`, 6 `only-export-components`, 3 `exhaustive-deps`, 2 `no-unused-vars`).
- `frontend/README.md` is stale (describes a 35-screen clickable prototype).

---

## 6. End-to-end workflow

### 6.1 In TallyPrime (three exports)

| Export | Path | Notes |
|---|---|---|
| All Masters | Gateway > E: Export > Masters > All Masters, JSON (Data Exchange), "closing balance as opening" = No | UTF-16 LE with BOM; one `tallymessage` list |
| All Transactions | E: Export > Transactions, period = **full** financial year (Tally defaults to one month), JSON | All voucher types in one list |
| Trial Balance | Display More Reports > Trial Balance, Alt+F5 detailed, opening + transactions + closing, JSON | Report shape; debit is negative |

### 6.2 In the tool (8 steps)

| # | Step | Person | Tool |
|---|---|---|---|
| 1 | Migration details | Company, GSTIN, financial year, start date | Year locks once a file is uploaded |
| 2 | Upload | Three files | Streams, checksums, splits into 6 master + 9 voucher datasets |
| 3 | Completeness | Waive datasets with a reason, type Tally counts | Auto-waives empty voucher types; count mismatch blocks processing |
| 4 | Read | Start processing | Debit = credit per voucher, master cross-checks, TB checks, flagged items |
| 5 | Names, accounts, rates | Optional review of ~10 decision cards | Every card has a default; "Accept as per Tally" records a review |
| 6 | Journals | Route each Tally Journal to Invoice, Bill or Manual Journal | Suggestions with reasons; bulk needs a confirm count |
| 7 | Create files | Create, read Assumptions, Download all | Zoho check, predicted TB, zip; "Download anyway" if refusals predicted |
| 8 | Import Wizard | Follow one Zoho step per page | Locks, arrival checks, TB comparison |

### 6.3 Files produced (counts from the latest offline run on the test company)

| Zip file | Zoho module | Content | Count |
|---|---|---|---|
| `01_chart_of_accounts.csv` | Chart of Accounts | Ledgers that are not contacts; minus those on Zoho's own accounts and Tally's P&L A/c. No balances except one "date anchor" (and Stock) | 177 rows |
| `02_contacts_customers.csv` | Customers | Opening Balance only for customers who owe money | 274 |
| `03_contacts_vendors.csv` | Vendors | Same for vendors owed money; same-name rows merged | 206 |
| `04_items.csv` | Items | Stock items + one service item per income account used on invoices (Rate 0.00) | 30 |
| `05_opening_balances_for_zoho_accounts.csv` | Manual Journals | OB-1 dated on the Migration Date, balanced on Opening Balance Adjustments; OB-2 for customers in credit / vendors in debit | 20 rows, 1 journal |
| `06_bills.csv` | Bills | Purchases + journals routed to Bill; TDS, Reverse Charge, Adjustment columns; no total columns | 168 rows, 159 bills |
| `07_invoices.csv` | Invoices | Sales + journals routed to Invoice; Item Name on every line | 28 |
| `08_journals.csv` | Manual Journals | Routed journals + generated `ADJ-yyyymm` / `TAX-yyyymm` journals | 215 rows, 50 journals |
| `09_journals_receipts_payments_contra.csv` | Manual Journals | Receipts, payments, contras, debit/credit notes (prefix RCT-, PMT-, CTR-, DN-, CN-) | 881 rows, 425 journals |
| `not_for_import/…` | none | `opening_balances_reference_do_not_import.csv` (37), `credits_to_apply.csv` (225 rows), `predicted_trial_balance.csv` (63 accounts, 0 differences) | |
| `READ_ME_FIRST.txt`, `READ_ME_IMPORT_ORDER.txt` | none | Set-up and import order for this company | |

Voucher control total: 659 of 659 written (Payment 341, Journal 206, Receipt 46, Contra 34, Sales 28, Debit Note 4), 0 "not in any file". All 17 voucher reconciliation checks pass.

### 6.4 Import Wizard in Zoho (14 steps for the test company; `server/src/importwizard.js:271-307`)

| # | Step | Lock / check |
|---|---|---|
| 1 | Set up Zoho Books: ticks for Organisation profile, GST, TDS taxes, Preferences, Tax exemptions, Zoho accounts snapshot (optional upload), Transaction locking; up to 3 questions (HSN field on, digits, vendors with no state = overseas) | Chart waits for every tick |
| 2 | Import Chart of Accounts; upload Zoho's accounts export | Compared name by name |
| 3 | Tick each Bank / Card / Cash account in Banking | Opening journal and bank files wait |
| 4 | Save the Migration Date in Zoho (Opening Balances > Edit, change date, type nothing, Continue, Confirm), type the date Zoho shows | **Hard lock**: no reason can open it |
| 5-7 | Customers, Vendors, Items; upload Zoho's export after each | Missing names give `missing.csv` and lock later steps |
| 8 | Opening balance journal | |
| 9-12 | Bills, Invoices, Manual Journals, receipts/payments journals | Each waits until prerequisites have no refused or missing rows |
| 13 | Apply the credits (optional) using `credits_to_apply.csv` | Nothing depends on it |
| (if held) | "Not in any file yet" | Added in the browser only when vouchers are held |
| 14 | Compare trial balances: Sync, export TB with From date before the Migration Date, Opening Balance Adjustments = 0, compare | Never auto-done |

Every tick, result and lock override goes to the audit log.

---

## 7. Accounting and Zoho rules the tool applies

### 7.1 Core rules

| Topic | Rule |
|---|---|
| Names | **Pick and drop:** every name is written exactly as in Tally (including edge spaces and line breaks), the same in every file, via one resolver (`makeNameResolver`). Cleaning is opt-in. |
| Defaults | **Zero-decision path:** 72 default kinds (`defaults.js:38-183`; 5 blocking, 31 marked unconfirmed). Each default used is logged and listed under "Assumptions the tool made". Latest run: 42 kinds fired, 1,517 items, 721 to check, 0 blocking. |
| Account types | From the Tally group (`lists.account_type_by_tally_group`): Bank/OD/OCC = Bank; Cash-in-Hand = Cash; Sales/Direct Incomes = Income; Indirect Incomes = Other Income; Purchase/Direct Expenses = Cost Of Goods Sold; Indirect Expenses = Expense; Fixed Assets = Fixed Asset; Current Assets/Loans & Advances/Deposits = Other Current Asset; Stock-in-Hand = Stock; Investments = Other Asset; Current Liabilities/Provisions/Duties & Taxes = Other Current Liability; Loans (all kinds) = **Non Current Liability**; Capital/Reserves = Equity. Sub-groups follow the parent. Sundry Debtors/Creditors become contacts. |
| Zoho's own accounts | A ledger named like a Zoho system account (list of 75, read from two new orgs) uses Zoho's account; the org's own export wins if uploaded. |
| GST | Intra-state `GST<rate>` (Tax Group), inter-state `IGST<rate>`. Rate from the line, else the ledger, else from amounts if exactly one standard rate fits. Untaxed registered lines get GST0/IGST0. Tally GST ledgers map to Zoho's Input/Output system accounts. |
| Zoho tax rounding | Zoho recalculates and rounds **each component per line** (setting `zohoTaxRounding`, `vouchers.js:543-573`). Made-up example: 1000.05 at GST18 = 90.00 + 90.00 = 180.00, not 180.01. Up to one rupee per line goes to Adjustment; more is flagged. |
| TDS | A ledger is TDS only if Tally's duty type says so. TDS Name, %, Section Code, Amount written together. Section code: old section (e.g. 194J) before 01/04/2026, new-Act code from then on (`tdsAct`). Zoho keeps the TDS Amount as written, so no recompute. Ledger placement from usage: bills = TDS Payable, invoices = TDS Receivable, journals only = own account, both = own account + `TAX-yyyymm` journal (`taxposting.js:62-88`). |
| Reverse charge | Same GST debited and credited per head = reverse charge columns; tax follows the two states. Vendor with no GSTIN and no state where Tally booked IGST defaults to **import of services** (overseas, IGST RCM, empty Source of Supply), which requires the SEZ/Overseas tick and a Custom Duty Tracking Account. |
| Opening balances | Non-contact ledgers go to OB-1 on the Migration Date; P&L A/c to Retained Earnings; Stock stays in the chart; one "date anchor" (smallest balance of the first suitable type, never a bank) stays in the chart so the chart import creates Zoho's opening-balance record; debtors who owe and creditors owed go in the contact files; reverse-side contacts go in OB-2 on AR/AP with the contact; foreign-currency reverse-side contacts are only flagged. Migration Date defaults to the day before the year starts (`zoho.js:898-908`). |
| Receipts, payments, notes | Default `paymentsRoute = journals` (`payments.js:22-30`): Manual Journals with party on AR/AP + Contact Name; prefixes per type; duplicates get "-2". Tally bill-wise allocations become `credits_to_apply.csv`. Trade-off: notes as journals do not appear as Credit Note / Vendor Credit documents in Zoho GST reports. Alternative route (`module_files`) builds Payments Received/Made only from an uploaded Zoho sample. |
| Adjustments | Round-off and non-income invoice lines go to Adjustment; Zoho posts these to "Other Charges" (invoices) / "Other Expenses" (bills); one `ADJ-yyyymm` journal per month moves them back to the Tally ledger. |
| HSN/SAC | Field on if the wizard says so, else if the migration has a GSTIN. Invoice lines: Tally code (4/6/8 digits), else chosen, else a suggestion; a 5-digit heading becomes a 6-digit child. Bills: never suggested. |
| Other | Bill Number = supplier invoice number, else voucher number; out-of-year vouchers left out; dates `yyyy-MM-dd`; 2 decimals; empty contact columns dropped. |
| Financial year | Fixed April to March (`tally.js:149-154`). |

### 7.2 What three real Zoho imports taught us (counts only)

| Zoho behaviour | Round | Tool now |
|---|---|---|
| "Long Term Liability" is not valid in Zoho India; Non Current Liability works | 1-3 | Loans written as Non Current Liability |
| "Row already exists" for Zoho system accounts; the row's balance is lost | 1 | Use Zoho's account; balance into OB-1 |
| A Bank row with an opening balance is refused and the bank not created; 234 journals then failed in cascade | 1 | No bank balances in chart; wizard locks later steps |
| One error per row; a bad line refuses the whole document; error file is ROWNUMBER + ERRORMESSAGE | 1 | Zoho check + Rejection Manager |
| Empty Total column read as 0 | 1 | No total columns |
| Registered vendor line with no tax refused | 1 | GST0/IGST0 |
| Empty item Rate refused | 1 | Rate 0.00 (unconfirmed) |
| Duplicate Display Name refused | 1 | Merge |
| 5-digit HSN refused; with HSN field ON, empty/short codes refused | 1, 2 | Question + 6-digit code |
| TDS Name needs % and Section Code | 2 | All TDS columns together |
| New TDS tax asks for the Income Tax Act first; "expired" taxes still work for past dates; name clashes | 2 | Set-up text; unique names |
| IGST reverse charge on a supply Zoho reads as intra-state refused; empty Source of Supply = home state | 2, 3 | Tax follows states; overseas default |
| Heading must be "Place Of Contact" exactly | 2 | Map-field spelling list |
| Migration Date cannot be saved alone; unsaved it stays the org creation date, so balances fall outside the year | 2, 3 | Date anchor + hard-locked date step |
| Zoho posts invoice/bill GST to its own system accounts | 2 | GST ledgers mapped to system accounts |
| Zoho TB for a date range shows only activity in the range | 2 | Period read from title, warning |
| SEZ/Overseas tick requires a Custom Duty Tracking Account | 2 | Extra tick |
| TDS posting, RCM posting, TDS amount kept, per-line rounding (read back from Zoho) | 3 | `taxposting.js`, tax model |
| Invoice/bill Adjustments post to Other Charges / Other Expenses | 3 | ADJ journals |
| Preview said 274/274 ready, Zoho created 273 with no message; a later journal naming that customer refused | 3 | Upload Zoho export after each master; missing-rows file; locks |
| AR/AP + bank in one journal accepted (10 cases) | 3 | No rule against it |
| Contact names kept exactly, including line breaks | 3 | Warning only |
| "Nothing handled the action gotoImportPreview" page error; reload fixes it | 3 | Tip |

Round 3 previews: chart 181/181, customers 274/274, vendors 206/206, items 30/30, opening 1/1, bills 157/157, invoices 28/28, journals 49/49, receipts/payments 233/234. A replay of the Zoho check on round-1 files predicted 465 of the 467 refused documents. Full notes: `docs/ZOHO_IMPORT_RULES.md`.

---

## 8. What was fixed in the latest batch (fix groups 1-6, plus three bugs found while writing this brief)

| Problem | Fix | Proof (offline counts) |
|---|---|---|
| Bill/invoice totals differed from Tally after Zoho recalculated tax | Per-component per-line tax model, TDS amount from file, GST on "Others" duty lines, rate from amounts, monthly ADJ journals | 159 bills, 28 invoices; predicted TB 0 differences |
| TDS and RCM ledgers split balances against Zoho system accounts | Placement decided from document usage (`taxposting.js`), TAX alignment journals | TDS Payable/Receivable/RCM accounts match in predicted TB |
| Opening balances lost or dated on the import day | OB-1/OB-2 journal on the Migration Date, date anchor, hard Migration Date gate | 1 journal, 20 rows; chart carries no balances except anchor |
| 191 vouchers held with no Zoho file | Written as Manual Journals in file 09; `credits_to_apply.csv`; "Apply the credits" step | 659/659 written; file 09 now 425 journals (was 234); 146 credits to apply |
| Customer silently not created (round 3) | Upload Zoho export after each master; `missing_rows` file; locks | Rules `GEN-RECORD-ARRIVED-IN-ZOHO`, `JRN-CONTACT-EXISTS` |
| Rejection Manager blamed the account, not the contact | Root cause names the contact | Tests |
| No view of Zoho's result before import | Predicted Zoho trial balance (card, wizard, zip) | 63 accounts, 0 differences; 45 contacts compared |
| Default Zoho account list guessed | Rebuilt from two live new orgs | 75 accounts |
| "Prepare migration" was a flow step | Became "Progress checklist" overview; 8 steps, one page each | `navigation.js:49-58` |
| Wizard screen missed server steps; stale texts ("receipts get no Zoho file"); READ_ME lacked the assumptions (group 6) | Every server step reachable on the wizard screen; READ_ME_FIRST lists "Assumptions the tool made"; wording fixed; `general.while_importing` lessons in `zohorules.json`; README section for `scripts/real-run.mjs` | 7 new server tests, 5 new frontend tests |
| C1 Mapping Studio white page | `NamesAndContacts.jsx` reads the list only after it loads | `frontend/test/apiUrl.test.js` |
| C2 Wizard answers sent to `/api/api/...` | One helper `frontend/src/apiUrl.js` used by every request; a whole `/api/` route from the server is accepted | `frontend/test/apiUrl.test.js` |
| B1 Old route `PUT /imports/:key` bypassed the Migration Date lock | The route now applies the Import Wizard's locks (`server/src/index.js`); older tests complete the wizard steps first (`server/test/wizardready.js`) | New test in `server/test/wizardcheck.test.js` |

**Offline rebuild of the real Tally files (`final-test-run-2`), measured with independent scripts:** 659 of 659 Tally vouchers are in an import file (0 held, 0 left out, 0 matched twice). Zoho check: 1,999 rows, 1,890 ready, 109 may be refused, **0 will be refused**; every "may" has one cause: the three TDS tax names are not yet confirmed to exist in Zoho. Predicted Zoho trial balance: 63 accounts, 0 differences. 655 vouchers post exactly what Tally posted; 4 differ by 0.01 to 0.04 and three generated ADJ journals move those paise back. Files: chart 177, customers 274, vendors 206, items 30, opening journal 20 rows, bills 159, invoices 28, manual journals 50, receipts/payments/contra/notes 425 journals; `credits_to_apply.csv` 225 rows.

All of this is proven only by tests and offline simulation, **not** by a real Zoho import.

---

## 9. Open bugs, problems and risks

Priority: **P1** = before the next real import or before an accountant uses it; **P2** = before release; **P3** = later. Effort: S = hours, M = 1-3 days, L = a week+.

### Top 10

| # | Item | Pri | Effort |
|---|---|---|---|
| 1 | ~~C1 Mapping Studio crashes to a white page~~ (fixed 15 Nov) | done | S |
| 2 | ~~C2 Wizard set-up answers call `/api/api/...`~~ (fixed 15 Nov) | done | S |
| 3 | C3/B2 "Read again" / "Create again" run on one click and delete import records | P1 | S/M |
| 4 | ~~B1 Old route bypasses the Migration Date lock~~ (fixed 15 Nov) | done | S |
| 5 | A0 Run a Round-4 real import (section 10) | P1 | M |
| 6 | E3/C10 No error boundary, no screen-render tests (C1 and C2 passed every test) | P1 | S/M |
| 7 | E1/E5 No git; confidential data in an OneDrive-synced project folder | P1 | S |
| 8 | C8 Wizard Next never disabled; locked step still downloadable | P2 | M |
| 9 | C4 Saving one row wipes typing in other rows | P2 | M |
| 10 | D1/D2 Picture-guided Zoho set-up pages not built | P2 | L |

### A) Data correctness

Everything about Zoho acceptance is in section 10 (A1-A13).

### B) Backend bugs and gaps

| ID | Problem | Evidence | Suggested fix | Pri |
|---|---|---|---|---|
| B1 | **FIXED 15 Nov (kept for history).** Old route marks a file imported after checking only staleness and file dependencies, not wizard locks; the wizard then counts it as imported | `server/src/index.js:3131-3152`; `importwizard.js:562, 569-573` | Apply wizard lock check or remove the route (frontend no longer calls it) | P1 |
| B2 | Re-reading deletes generated files, import status, wizard results, rejections, retry files; creating files deletes all `import_status` | `index.js:760-775, 1586` | Dry-run answer ("removes N results") + `confirm=true`; keep an `import_attempts` history | P1 |
| B3 | Downloads ignore wizard locks | `index.js:3110-3124` | Return lock reason; "download anyway" for locked steps | P2 |
| B4 | No connection to Zoho; checks rely on uploaded exports or typed numbers | `zohoverify.js` | Optional read-only Zoho Books API | P2 |
| B5 | 107 bill rows + 2 invoice rows "may be refused" until Zoho's TDS export is uploaded | fix-group 5 notFixed | Make the TDS export part of the TDS set-up page | P2 |
| B6 | Predicted TB differences do not block | `predictedtb.js:46-54` | Optional block or typed reason | P3 |
| B7 | Org settings guessed (rounding mode, adjustment account names, part of default accounts) | fix groups 1, 5 | Ask in set-up pages | P2 |
| B8 | Stock opening balance stays in chart file | `defaults.js:197` | Move to journal or item opening stock | P3 |
| B9 | No per-ledger account type override (card ledgers not named "credit card" stay Bank) | fix group 2 | Override in Mapping Studio | P3 |
| B10 | No Vendor Credit / Credit Note documents | fix group 3 | Build once Zoho's columns are known | P3 |
| B11-B14 | Foreign-currency reverse-side contacts only flagged; overseas vendor country stays India; RCM input on paid bills unproven; SAC heading children list missing | fix groups 1-3 | Small additions | P3 |
| B15 | Financial year fixed April-March | `tally.js:149-154` | Start month per migration (if needed) | P3 |
| B16 | Home state only from the migration's GSTIN field | `zohocheckapi.js:96` | Fall back to company GSTIN from All Masters | P3 |
| B17 | No password change/reset, no login rate limit, plain-text seed file, fixed 12-hour session | `auth.js:7, 26-28, 112-131` | Admin reset + change own; rate limit; session warning | P2 |
| B18 | No error handler, no logger, no input schemas, varying error shapes; a bad `x-filename` header gives 500 | `index.js:2030, 2184`; no `setErrorHandler` | One error shape, schemas on writes, plain messages | P2 |
| B19 | Migration id = row count + 1 | `index.js:2109-2110` | Sequence or random ids | P3 |
| B20 | Heavy work blocks the server: `generate()` and the Zoho check run synchronously without pausing; not measured at scale | `index.js:1952, 1968` | Worker thread or chunking; add to large-file test | P2 |
| B21 | Expensive GETs recomputed each call (`/voucher-reconciliation`, `/completeness-table`, `/payments`, `/import-wizard`, `/predicted-trial-balance`); cache key is SQLite `total_changes()`, so any write anywhere (even a login) drops it | `index.js:200, 3099`; `importwizard.js:928-945` | Per-migration version counter; "quiet" writes | P2 |
| B22 | Output folder deleted before the transaction; a failed build leaves DB rows pointing to missing files | `index.js:1548, 1931` | Build in temp folder, swap on success | P2 |
| B23 | Schema: 65 tables, ~24 `ALTER TABLE` in try/catch that swallow every error, modules alter tables they do not own, no FKs, DB opened at import | `decisions.js:60`, `extras.js:89` | Versioned migrations | P2 |
| B24 | GETs that write (download marks "downloaded", `?confirmed=1` records a confirmation; `/zoho-check` writes cache) | `index.js:3110-3123`; `importwizard.js:1172-1177` | Make confirmations POST | P2 |
| B25 | Two import status systems (`import_status` vs `wizard_results`, latest only) | `index.js:1253`; `importwizard.js:160` | One system with history | P2 |
| B26 | `zohorules.json` parsed in 12 places; 6 fall back silently to `{}` on error | `defaults.js:196, 337, 453`; `tds.js:21`; `zoho.js:439` | Load once, fail loudly | P2 |
| B27 | Duplicate helpers (3 CSV writers, only 2 guard spreadsheet formulas; module report reads CSV only while others read XLSX) | `zoho.js:28`, `zohocheckapi.js:60`, `extras.js:629` | Shared CSV module | P3 |
| B28 | Lists unbounded or silently capped (`/summary`, `/report`, `/audit` no paging; `/records` 500; `/crosswalk` 300) | `index.js:2801, 2819, 3156, 3200`; `extras.js:777` | Paging + "first N of M" | P2 |
| B29 | Global `currentActor` for audit lines; wrong if a handler awaits | `index.js:169, 2077` | Pass actor per request | P3 |
| B30 | Data kept forever (no migration delete, no retention, DB ~163 MB, Zoho samples stored outside `DATA_DIR`) | `heldvouchers.js:28, 158` | Retention/delete design | P3 |
| B31 | User-facing English built in server handlers and wizard code | `index.js:842-855`, `importwizard.js` | Move wording to data | P3 |

### C) Frontend and UX bugs

| ID | Problem | Evidence | Suggested fix | Pri |
|---|---|---|---|---|
| C1 | **FIXED 15 Nov.** **Mapping Studio white page:** `FixContactsCard` reads `view.rows` while `view` is `null`; no error boundary | `frontend/src/screens/app/NamesAndContacts.jsx:443` (guard at `:465`) | `view?.rows ?? []` + error boundary | P1 |
| C2 | **FIXED 15 Nov.** **Double `/api`:** server sends `settingsRoute` starting with `/api`; wizard passes it to `api.put`, which adds `/api`. HSN on/off, HSN digits, reverse-charge question and "Use this date" fail with an "older server" message | `server/src/importwizard.js:643`; `Screen40_ImportWizard.jsx:215, 249` (`:253` and `:520` strip it correctly) | Normalise in `api.js` + contract test | P1 |
| C3 | One-click destructive buttons ("Read the files again", "Create the files again") | `PrepareMigration.jsx:161, 241-244, 298-300`; `CreateFiles.jsx:20-30`; `OutOfDateBanner.jsx:28-31` | Shared ConfirmDialog naming what is lost | P1 |
| C4 | Typing lost when another row is saved (effect resets draft on row change) | `MappingDecisions.jsx:141`; `NamesAndContacts.jsx:69`; `VoucherDecisions.jsx:45` | Drafts keyed by row | P2 |
| C5 | Voucher Classification clears its own errors | `Screen20_TransactionClassification.jsx:64, 84` | Per-row errors | P2 |
| C6 | Mapping Studio says "Nothing needs you" when only part was counted or load failed | `Screen19_SmartMapping.jsx:244, 257-279` | One `/decisions` answer; load error | P2 |
| C7 | Stepper ticks by position, not by what is done; Continue only navigates, never does the main action, never disabled (step 4 cannot start reading) | `components/ui.jsx:292`; `WizardNav.jsx:29-40`; `Screen17:117-121` | Flow state from `/prepare`; per-page main action | P2 |
| C8 | Wizard: Next never disabled; Download on a locked step works; errors shown at the top; last Next leaves to Reconciliation | `Screen40` (`PinnedStepBar` without `nextDisabled`); `CreateFiles.jsx:90` | Lock with reason; errors at control; finish inside wizard | P2 |
| C9 | Loading or failure looks like "nothing here"; 14 calls swallow errors | `Screen25:159`; `Screen28:305`; `Screen32:14`; `Screen14:12`; `Navbar.jsx:145` | `loaded` flag, Skeleton, LoadError + retry | P2 |
| C10 | No error boundary; any `/auth/me` failure (even server down) shows Login; 401 mid-work loses typing | `main.jsx:6-10`; `App.jsx:123-131` | Boundary per route; reason on login | P1 |
| C11 | Developer messages ("Start it with npm start…"); any 5xx says "cannot reach" | `api.js:5, 25-28` | Plain sentences | P2 |
| C12 | Stale wording: Help says Zoho error-file layout is "assumed" and reset = new account; Reconciliation still calls the Zoho report format assumed (re-check after Round 4); Login has dead Google/Microsoft/"Forgot password" buttons and mentions `seed-users.json`. (Group 6 fixed the receipts/payments wording during this review.) | `Screen35_HelpSupport.jsx:162, 202, 212`; `Screen30:118`; `Login.jsx:12-16, 126-139` | Finish text pass; test for phrases | P2 |
| C13 | Data Explorer 500 rows, Identifier Tracker 300, no paging, no "of N" | `Screen18:248`; `extras.js:777` | Server paging and search | P2 |
| C14 | Side menu: 26 items, jargon, two numbering systems (groups 1-5 and steps 1-8), one page with two names | `Sidebar.jsx:51-93` | Steps / More tools / Settings | P2 |
| C15 | Progress checklist still repeats upload, read and create actions | `PrepareMigration.jsx:203-356` | Read-only overview | P3 |
| C16-C18 | Users screen acts on one click; Company Settings says "Locked" but is editable and hides Migration Date; firm-wide GST change on one click | `Screen34:56, 63`; `Screen32:29` | Confirms, edit button | P2/P3 |
| C19 | Rejection Manager retry link is a raw `<a href>`; retry row lost after reload; approve needs no reason | `Screen28:86, 333` | `downloadFile`, server-side retry list | P3 |
| C20 | Voucher Classification filters shared across companies | `Screen20:23-40` | Key by migration id | P3 |
| C21 | Print prints one clipped screen with menu; no print CSS | `Screen31:80` | Print styles; PDF/CSV | P3 |
| C22 | Accessibility: no `document.title`, no focus move, no skip link, hint/error not linked, focus ring hidden in grids | grep | Fix basics | P3 |
| C23 | Speed: one ~960 KB bundle; `/migrations` fetched many times; two pollers at once; no `AbortController` | `App.jsx:7-34`; `Navbar.jsx:146, 201` | Overview endpoint; later code split | P3 |
| C24 | Consistency: five page widths, `toLocaleString()` 71 times vs `'en-IN'` 81 times, HelpTip opens on hover with a warning icon and mis-positions, hand-made tables next to shared `Table`, `window.confirm` in 5 places, `Table` select-all drops filtered-out rows (`ui.jsx:239`), Upload Center defines `Section` 3 times inside components | ux survey (72 findings, about 30 still present) | Covered by the roadmap | P3 |

### D) Missing features the owner asked for

| ID | Feature | Evidence | Pri |
|---|---|---|---|
| D1 | Picture-guided Zoho set-up: one item per page with why, click path, values with Copy, a picture with the target ringed, what "done" looks like, error help | Set-up is one checklist step (`importwizard.js:274`); owner spec `PROMPT_guided_zoho_setup_wizard.md` | P2 |
| D2 | Cropped and masked screenshots (raw ones show the test company's data and cannot ship) | `zoho-screens/` 60 raw files; `frontend/public` has only icons | P2 |
| D3 | 69 missing pictures and 26 Zoho screens not yet seen; no Tally pictures at all | ux survey | P2 |
| D4 | First-time walkthrough | none in code | P2 |
| D5 | Searchable help + generated user guide | `Screen35` static | P2 |
| D6 | Charts (46 ideas in the survey; none built) | no chart component | P3 |
| D7 | Guide backend: resume, per-user tour state, one overview call, import attempts, plain activity feed | survey backend gaps | P3 |

The survey planned 27 guide pages, shown only when they apply: set-up plan overview, new empty org, organisation profile, GST settings, GST/IGST taxes, Income TDS settings, create TDS taxes, tax exemptions, adjustments and rounding, HSN/SAC, same name as customer and vendor, transaction locking, give Zoho's account list, then one page per import (chart, banks, Migration Date, customers, vendors, items, opening journal, bills, invoices, each journal file), apply credits, held vouchers, Sync and export TB, compare TB.

### E) Engineering risks

| ID | Risk | Evidence | Suggested fix | Pri |
|---|---|---|---|---|
| E1 | No git; about 498 MB of manual copies in `backups/` | not a repo | `git init` + `.gitignore` for `real-data/`, `zoho-screens/`, `server/data/`, `backups/`, `dist/`, `seed-users.json` | P1 |
| E2 | Very large files (`index.js` 3,279 lines; `zohorules.json` 10,583; `vouchers.js` 1,719; `importwizard.js` 1,306; `Screen40` ~990) | file sizes | Split routes, rules, wizard step components | P2 |
| E3 | No component or browser tests; every fix group says "browser check not done" | `frontend/test/*.js` | Render-every-screen smoke test; route contract test | P1 |
| E4 | No CI | none | Server tests, frontend tests, lint, build on each change | P2 |
| E5 | Real Tally files, screenshots, uploads, DB and plain-text test passwords in an OneDrive-synced folder | `real-data/`, `zoho-screens/`, `server/data/` (~308 MB) | Move outside project and OneDrive; masking pipeline with leak tests | P1 |
| E6 | Docs partly stale (group 6 is updating `README.md`): e.g. `README.md:205` still describes TDS worked out from the percentage; the two real party names around `README.md:225` were removed on 15 Nov | `README.md` | Rewrite around current flow | P2 |
| E7 | Dead code (`_old_screens/`, `mockData.js`, stored `dist/`) | files | Delete after git | P3 |
| E8 | `api.*` adds `/api` but `downloadFile` does not (root cause of C2) | `api.js:31` vs `:67-69` | One helper accepting both | P2 |
| E9 | Raw control characters inside a regex make tools treat `tally.js` as binary | `server/src/tally.js:164` | `\u` escapes | P3 |
| E10 | Fonts fetched from Google at each start | `frontend/index.html:7-9` | Ship fonts locally | P3 |

### Owner decisions still open

Draw Zoho preview pages instead of shipping screenshots? Income TDS "Apply TDS" at line or transaction level? Is "Enable Reverse Charge in Sales transactions" needed for RCM bills? "Tax Exclusive" right? Which locks hard vs soft; may an admin open a hard lock? Replace jargon menu names with step names? Remove social sign-in buttons; admin reset with no email? Any client with a non-April year? How is the tool run in real use (dev servers or a built copy)?

---

## 10. What only a real Zoho import can prove

| ID | Not yet proven | Exact test |
|---|---|---|
| A1 | OB-1 (lines on equity, fixed asset, liability, renamed tax, Retained Earnings) and OB-2 (AR/AP with contact, no bank line) are accepted; OB-2 becomes an applicable credit | Fresh org: chart, save Migration Date, import opening journal; 0 skipped; open an OB-2 customer and see "credits available" |
| A2 | Migration Date sequence: chart import creates one anchor balance; Edit/Continue/Confirm work with nothing typed; contacts imported later take that date; whether Sync is needed | Screenshot Opening Balances after chart; change date; import customers; TB "From" a day before the date: Opening Balance Adjustments = 0 |
| A3 | File 09 with the 191 formerly held vouchers, especially the 30 two-line receipts (customer on AR, bank); "-2" numbers import separately | Import file 09; skipped = 0; Zoho journal count = wizard's expected count |
| A4 | The 146 credits can be applied, bills with the same number from different vendors picked by contact; whether a journal credit can be applied to a contact's opening balance (17 rows) | Apply 3-5 of each kind; document turns Paid; contact balance unchanged |
| A5 | GST18 on a bill line whose account is a Duties & Taxes ledger; IGST5 exists by that name; TDS amount kept on invoices and non-whole-rupee TDS; org rounds per line | Compare 10 document totals with Tally; read Zoho's rounding preference |
| A6 | ADJ journals accepted on Other Charges / Other Expenses / Input CGST-SGST and those accounts end at zero | TB after journal imports |
| A7 | RCM and TDS postings: lines on "Reverse Charge Tax Input but not due" and TDS Payable accepted; overseas IGST RCM bill posting; overseas vendor rows import with SEZ/Overseas on; TDS lands on TDS Payable when taxes are made by hand | Compare those accounts in Zoho TB with `predicted_trial_balance.csv` |
| A8 | Predicted TB equals Zoho's; two posting rules still `assumed` (invoice TDS to TDS Receivable; Output IGST on overseas RCM) | Upload Zoho TB to Reconciliation; every difference 0 or explained (`predictedtb.js:46-54`) |
| A9 | Real Zoho export headings for Customers, Vendors, Items, Chart; importing `missing_rows_<file>.csv` creates the missing contact with its balance and clears the lock | Export after each master import; in a demo org delete one customer and test |
| A10 | Cash account, Bank-typed OD/OCC, Credit Card type; Stock opening in chart (not in the test company) | Made-up company in a demo org |
| A11 | Payments Received/Made module route (off by default) column names | Only if the route is kept |
| A12 | Unknowns: Income TDS line vs transaction level; RCM sales setting for bills; Tax Exclusive; trailing-space references; Zoho silently stores Journal Type "both" as "accrual" on AR/AP journals (`vouchers.js:1326, 1358, 1434`); blank Place of Contact stored as home state | Check each in Round 4 with a screenshot |
| A13 | The round-3 org cannot be repaired by code (old adjustments) | Use a fresh org |

**Round-4 script (A0):** fresh demo org. Do every wizard step in order without skipping. Upload Zoho's export after each master step (A9). Check the date step (A2). Import files 08 and 09 (A1, A3). Apply sample credits (A4). Sync, export the TB with a From date before the Migration Date, upload it (A8). Check the named accounts (A5-A7). Record results in `docs/ZOHO_IMPORT_RULES.md`, then change each rule's `evidence` in `zohorules.json` and `POSTING_RULES` from `assumed` to `confirmed` or `refuted`.

---

## 11. Roadmap: UX build plan (12 clusters, not started)

Plan rules: each cluster backs up its files first (no git yet), edits only its own files, and test counts must only go up. Round-1 clusters can run in parallel.

| Cluster | Round | What it does |
|---|---|---|
| ui-kit | 1 | Skeleton, Loading, LoadError, Stepper with states, Copy, Tabs; one number format (en-IN); six hand-made SVG chart parts; `Figure` for pictures with ringed boxes; HelpTip on click; print CSS |
| app-shell | 1 | Mapping Studio crash fix; ConfirmDialog and toasts; ErrorBoundary per route; plain errors in `api.js`; real step states; bar does each page's main action; one glossary; confirms on destructive actions |
| guide-pictures | 1 | `node:zlib` crop/mask script with manifest; shippable PNGs; review page; leak tests (no SHA match with originals, no GSTIN pattern) |
| server-foundation | 1 | Routes folder; quiet writes; one error shape; per-user guide state; Zoho error help routes |
| wizard-backend | 1 | Fix double `/api`; set-up plan as data (12 set-up pages) filled from company facts; locks from the plan with plain reasons; 8 made-up test companies |
| wizard-pages | 2 | Set-up plan overview; GuidePage per item; LockBox with "Go to"; feedback at the control; file steps with a tool-drawn preview and expected numbers; finish verdict inside the wizard |
| walkthrough-help | 2 | Hand-made tour; "What do I do here?"; searchable Help; three-block menu; sign-in clean-up; generated `docs/USER_GUIDE.md` |
| start-screens | 2 | `GET /overview`; Dashboard from one call with charts; Tally guide as three pages; Upload Center with three drop zones; reading page with stages |
| data-backend | 2 | Close `PUT /imports/:key`; import attempts history; password reset/change; plain activity feed |
| review-screens | 3 | No lost typing; row-level errors; truthful Mapping Studio banner; paged searchable grids |
| results-screens | 3 | No false "nothing here"; one main button in Export Center; retry file survives reload; full-page print |
| settings-screens | 3 | Company "Edit details" + Migration Date; Users row menu with confirm; profiles ask before replacing |

Dropped on purpose: new packages (chart, tour, router libraries), shipping Zoho preview screenshots, full Rejection Manager redesign, delete/archive of migrations, email password reset, code splitting, dark mode. You may challenge these.

---

## 12. Product rules and constraints (please respect)

| Rule | Meaning |
|---|---|
| Pick and drop | The tool takes data from Tally and drops it into Zoho files as it is. Names are never cleaned unless the accountant chooses to. No silent changes to data. |
| Zero-decision defaults + Assumptions | Every decision has a safe default so the person can finish without deciding anything; every default used is listed under "Assumptions the tool made" and logged. A person's decision always wins. |
| One step per page, with Back | The guided flow and the Zoho guide show one step per page, with Back and Continue. Hard to skip a step by mistake. |
| Plain English for accountants | No developer words. Short sentences. Explain why, not only what. |
| General for any company | Nothing may be tuned to the test company. Rules come from Tally structure (group, duty type, usage), never from names. |
| Confidentiality | Real client data never appears in code, tests, docs, screenshots or pictures. Use made-up data. |
| Code-only fixes | Never hand-edit an output CSV. Every fix goes into the code or rules so it repeats for the next company. |
| Evidence levels | A Zoho rule is "confirmed" only after a real import or read-back; otherwise "sample", "docs" or "assumed". |
| India context | Zoho Books India edition; GST (CGST/SGST/IGST, reverse charge, HSN/SAC, GST treatments), TDS (old Act before 01/04/2026, new Act codes after), April-March year. |
| Local first | Runs on one machine today; few dependencies (the plan avoids new packages). |

---

## 13. Questions for you

1. **Splitting the server:** `index.js` (3,279 lines) mixes schema, uploads, processing, `generate()` and routes. What split (routes / services / data access) gives the most safety for the least risk, and in what order, given there is no git yet?
2. **Schema migrations without new packages:** 65 tables, `CREATE IF NOT EXISTS` plus `ALTER` in try/catch, no foreign keys. What lightweight versioned-migration pattern fits `node:sqlite`? How should deleting or archiving a migration work?
3. **Blocking work:** `node:sqlite` is synchronous and `generate()` plus the Zoho check run in one go. Worker thread, child process, or chunked yields? How would you benchmark it for 200,000 vouchers?
4. **Caching:** the cache key is SQLite `total_changes()`, so any write drops every cache. What invalidation design (per-migration version, dependency tags) would you use?
5. **Receipts and payments in Zoho India:** we write them as Manual Journals with AR/AP contact lines plus a credits-to-apply list. Compared with importing Customer Payments / Vendor Payments / Credit Notes, what are the real trade-offs for GST reports, ageing and audit? Can a journal credit be applied to a contact's opening balance?
6. **Opening balances:** is there a more robust way than "date anchor in chart + edit Migration Date + dated OB journal" to get Zoho's opening position right? Any known Zoho behaviour we are missing?
7. **Zoho API:** is a read-only Zoho Books API connection (OAuth, India data centre) worth adding for checks (contacts arrived, TDS taxes, opening-balance date, trial balance), while imports stay manual? Risks and scopes?
8. **Tax rounding and adjustments:** we model Zoho's per-component per-line rounding and move differences back with monthly ADJ journals. Is this sound for an auditor? How can the org's rounding setting be detected reliably?
9. **TDS across the 2026 Act change:** old section codes before 01/04/2026 and new-Act codes after. Any edge cases (lower deduction certificates, 194Q, TCS) we should plan for?
10. **Testing strategy:** two P1 bugs (since fixed) had passed 286 + 52 tests, lint and build. With minimal new dependencies, what gives the most value: a render-every-screen smoke test, Playwright click-through, a server/client route contract test, or golden-file CSV tests on made-up companies?
11. **Made-up test companies:** what 8-10 company profiles (services, trading with stock, exporter, RCM-heavy, multi-state, foreign currency, no GSTIN) best cover Tally-to-Zoho edge cases?
12. **Guided UX for a long, risky flow:** should Continue perform the page's main action? How to make steps hard to skip without annoying experts? When should a lock be hard versus soft-with-reason?
13. **Zoho set-up guide with pictures:** is drawing Zoho-like preview panels from the company's own numbers better than masked screenshots? How do we keep pictures current when Zoho's UI changes?
14. **Charts for accountants:** which 5-6 charts give the most confidence (voucher reconciliation, trial-balance differences, refusal causes, progress)? Is hand-made SVG reasonable versus a small library?
15. **Rules file:** `zohorules.json` is 10,583 lines with evidence levels. How would you structure, split and version it, and feed real-import results back into evidence automatically?
16. **API contract without TypeScript:** errors and answers have varying shapes. Would you use JSDoc types, a shared schema file used by Fastify and the client, or something else?
17. **Data security and deployment:** client books sit in a local SQLite file in a synced folder, kept forever. What retention, encryption-at-rest and packaging (single process serving `dist`, desktop wrapper, installer) would you recommend for CA firms?
18. **Biggest blind spot:** from this brief, what is the single biggest risk you see that we have not listed?
