# Accounting Migration Platform: Full Project Plan

TallyPrime to Zoho Books, Phase 1 (MVP)

Prepared 12 November 2026. Based on the product plan (version 2.0), the second UI review, and the current prototype. All durations are estimates for planning, not commitments.

---

## 1. What we are building

A web product that moves one company's accounting data for one financial year from TallyPrime into Zoho Books.

The user exports reports from Tally as JSON, uploads them, and the platform prepares Zoho-ready import files. The user imports those files into Zoho Books by hand. The platform then handles rejected rows and proves what reached Zoho.

**In Phase 1**
- Manual Tally JSON export and upload.
- Completeness check, parsing, mapping and voucher routing.
- Zoho import files built from official Zoho templates.
- Import sequence, rejection handling, traceability and verification.
- Multiple firms, multiple clients per firm, and role-based access.

**Not in Phase 1**
- Direct connection to Tally (ODBC) or to Zoho (API).
- Data enrichment, accounting clean-up or GST reconciliation.
- Multi-year migration. The design allows it to be switched on later.
- Advanced inventory (batches, serials, manufacturing) unless the pilot needs it.

## 2. Where the project stands today

| Item | Status |
|---|---|
| Product plan (PDF, version 2.0) | Done |
| UI prototype, 25 screens, sample data | Done, reviewed twice |
| Review 2 feedback applied to the prototype | Done |
| Backend | Not started |
| Real Tally sample exports | Not collected |
| Official Zoho templates | Not collected |
| Accountant sign-off on export catalogue | Not done |

The prototype is a clickable demo. Nothing is uploaded, parsed or generated for real yet.

## 3. Rules the product must follow

**Accounting rules**
1. Source values are transferred as recorded. Nothing is changed silently.
2. Amounts use exact decimal arithmetic.
3. Every voucher keeps all its lines together, and debits equal credits at every stage.
4. Sales, Purchase, Receipt and Payment vouchers route automatically. Journal vouchers are routed one by one to Invoice, Bill or Manual Journal, with user approval.
5. Company and financial year are chosen by the user and never overwritten from file contents.
6. Control totals are checked at each stage: counts and amounts in equal counts and amounts out, plus recorded exceptions.

**Audit rules**
1. Every record is traceable from Tally ID to migration ID to file row to Zoho ID.
2. The audit log is append-only: who, what, when, and which rule version.
3. Parsers, mapping rules and templates are versioned. Each generated file records the versions used.
4. Uploaded files get a checksum.
5. If a value must change for Zoho to accept it, the original value, new value, reason and approver are stored.
6. Each firm's and client's data is isolated.

**Engineering rules**
1. One application with separated modules (modular monolith).
2. Large files are processed as streams in background jobs.
3. Generation and retries are idempotent.
4. No sensitive accounting data in application logs.

## 4. Users and roles

| Role | Can do |
|---|---|
| Super Admin | Manage all firms, platform settings and templates |
| Admin | Manage one firm's clients and team, approve mappings and corrections |
| Migration Analyst | Upload, map, generate and track for assigned clients |
| Client Viewer | See progress and download reports for their own company |

Three ways the product is used: a CA firm migrating many clients, several CA firms on the same platform, and a single company migrating itself.

## 5. Technology

| Layer | Choice | Note |
|---|---|---|
| Frontend | React with Vite, Tailwind | Already built. The PDF says Next.js; keeping Vite is recommended (see section 11) |
| API | Node.js, TypeScript, Fastify | From the PDF |
| Database | PostgreSQL with Prisma | From the PDF |
| Background jobs | Redis with BullMQ | Parsing, generation, matching |
| File storage | Private S3-compatible storage | Temporary uploads and generated packages |
| JSON parsing | stream-json, Ajv | Large files and schema checks |
| Output files | fast-csv, ExcelJS | Only formats verified per Zoho module |
| Money | decimal.js | No floating point |
| Logs and tests | Pino, Vitest | |

## 6. Backend modules

| Module | Responsibility |
|---|---|
| auth and tenancy | Login, firms, clients, roles, data isolation |
| migration-jobs | Job lifecycle, company, financial year, method |
| catalogue | Approved Tally report list and applicability rules |
| uploads | 13 upload slots, checksums, slot validation |
| source-adapters/tally | Parsers per report and per Tally version |
| canonical-engine | Common accounting records with source provenance |
| classification | Automatic routing and the journal routing queue |
| mapping | Field mapping, saved profiles, approvals |
| templates/zoho | Template registry, versions, generators |
| validation | Pre-export checks against template rules |
| dependencies | Import order graph and readiness |
| rejections | Zoho error file parsing, diagnosis, approval, retry files |
| traceability | Source to migration to Zoho identifier crosswalk |
| reconciliation | Zoho report matching and transfer report |
| audit | Append-only action log |

## 7. Delivery phases

| Phase | Work | Done when | Estimate |
|---|---|---|---|
| 0. Research | Collect real Tally exports (service and trading business). Test export settings. Download official Zoho templates. Build the export catalogue | Accountant signs off the catalogue and template matrix | 2 weeks |
| 1. Foundation | Project setup, database, login, firms, clients, roles, audit log, migration job. Connect New Migration and Dashboard screens to the API | A user can log in, create a job, and every action is logged | 2 weeks |
| 2. Source intake | 13 upload slots, validation, checksums, completeness check, streaming parsers, overall progress and time estimate. Connect Upload Center, Completeness Check, Processing Status, Data Explorer | Real Tally files parse with no unexplained record loss | 3 to 4 weeks |
| 3. Mapping | Canonical records, automatic routing, journal routing queue, field mapping, saved profiles. Connect Mapping Studio and Voucher Classification | Masters and sample vouchers map with full traceability | 3 to 4 weeks |
| 4. Output | Template registry, validation, CSV/XLS generation, package manifest, dependency order, import instructions. Connect Template Library, Validation Center, Export Center, Dependency Manager | Files import cleanly into a Zoho test organisation | 3 weeks |
| 5. Rejections | Zoho error file upload, link to source rows, diagnosis rules, approval, retry file. Connect Import Tracker and Rejection Manager | A rejected sample is fixed and re-imported without regenerating other files | 2 to 3 weeks |
| 6. Verification | Identifier crosswalk, Zoho report upload, matching, transfer report. Connect Identifier Tracker, Reconciliation, Reports and Audit | Destination records are matched or exceptions documented | 2 to 3 weeks |
| 7. Pilot | Full migration of one real company into a Zoho test organisation. Fix issues. Security review. Deploy | The MVP demonstration checklist (section 9) passes end to end | 2 to 3 weeks |

Total: roughly 19 to 24 weeks. Phase 0 can run alongside Phase 1.

## 8. Testing

**Test companies**
- Service business: no stock, core masters and vouchers.
- Trading business: stock items, units, taxes, stock summary.
- Complex business: custom voucher types, partial payments, multiple tax setups.

**Test types**
- Unit tests for parsers, routing rules and generators.
- Control-total tests: counts and amounts match at every stage.
- Template tests: generated files match the official Zoho headers.
- Import tests: files are imported into a Zoho test organisation by hand.
- Regression tests: every resolved rejection pattern becomes a test.
- Access tests: one firm cannot see another firm's data.

## 9. MVP acceptance checklist

1. User selects company and financial year manually.
2. User follows the Tally export guide.
3. User uploads each required JSON report into its own slot.
4. Completeness check identifies missing and conditional datasets.
5. Platform extracts customers, vendors, accounts, items, taxes and vouchers.
6. Platform applies approved mapping and journal routing.
7. Platform generates files from verified Zoho templates.
8. Platform shows the required import sequence.
9. User imports the files into Zoho Books.
10. User uploads a Zoho rejection report and receives a traceable retry file.
11. Platform links source records to Zoho references.
12. Platform compares uploaded Zoho reports and produces a transfer report.

## 10. Team

Suggested minimum, to be confirmed:
- 2 backend developers
- 1 frontend developer
- 1 accountant or CA as subject expert, part time, for catalogue, routing rules and sign-offs
- 1 tester, part time, with access to Tally and a Zoho test organisation
- 1 product owner for decisions and reviews

## 11. Decisions needed before coding starts

| Decision | Recommendation |
|---|---|
| Frontend: Next.js (PDF) or Vite (current) | Keep Vite. Rebuilding adds work with no benefit for this product |
| Voucher exports | Confirm with real Tally exports whether Sales, Purchase, Receipt, Payment and Journal come as separate files or one Daybook file the platform must split |
| Zoho modules in the first pilot | Start with Contacts, Chart of Accounts, Items, Invoices, Bills, Payments, Journals |
| Opening balances and open invoices | Accountant to define handling per migration method |
| Source identifiers | Confirm the stable ID available for each Tally master and voucher type |
| Zoho IDs | Confirm which Zoho reports provide record IDs for the crosswalk |
| File retention | Set how long uploads and rejection logs are kept |
| Hosting and data location | Choose provider and region. Indian data residency may matter |

## 12. Main risks

| Risk | Response |
|---|---|
| Export catalogue incomplete | Validate on two real companies and get accountant sign-off first |
| Tally export settings vary | Publish tested, version-specific instructions |
| Journal routing is ambiguous | Approval queue first, automation only for reviewed rules |
| Zoho formats differ by module | Maintain a template matrix by module, region and version |
| Rejection files lack stable IDs | Add a row key to every generated row |
| Source data has accounting errors | Preserve values and flag them. Correction stays out of scope |

## 13. Next steps

1. Approve this plan and the decisions in section 11.
2. Collect real Tally exports from a service business and a trading business.
3. Download the current Zoho sample templates for each module.
4. Accountant reviews and signs off the export catalogue.
5. Start Phase 1.

## 14. After Phase 1

- Automated Tally extraction (ODBC or similar).
- Direct Zoho integration, if approved.
- Multi-year migration.
- Data enrichment and GST reconciliation.
- Other accounting systems.
