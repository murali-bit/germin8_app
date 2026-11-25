# Self-Test Report: Tally to Zoho Migration Tool

Date: 13 Nov 2026. Data used: the real company export (masters, transactions, three Trial Balance files) for FY 2025-26, plus made-up sample data. Every run used a fresh temporary data folder. No project file was changed and the live data folder (server/data) was never opened.

This report gives counts only. It contains no party names, GSTINs, amounts or voucher numbers.

Six testers took part: end-to-end flow, Zoho import acceptance, accounting tie-out, browser UI, security and robustness, and code quality. A second agent then double-checked every problem against the code and by re-running it.

---

## 1. Summary

**Verdict: ready for a dummy Zoho test import, but not yet ready for a real import.**

- The full flow works on the real data. Every step returned success. The test report reaches 0 blockers once all decisions are made.
- All 659 vouchers and 1,703 lines are accounted for, and all 19 reconciliation checks pass.
- Every import file matches its Zoho sample in headings, column order, formats and allowed values.
- Opening balances tie: 37 of 37 ledgers are written once with the same amount and side.

**Before the dummy import:**
- Do not run processing again after routing journals (problem M1).
- Expect payments and vendor credits to be missing (M4).
- Review the 10 documents whose totals differ from Tally (M3).
- Watch for invoice rejections caused by the empty Item Name (M5).

Problem counts after the double-check:

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 10 |
| Minor | 33 |
| Unconfirmed until a real Zoho import | 11 (1 of them could be major) |
| Checked and not a problem (refuted or corrected) | 7 |

---

## 2. What works

| Area | Evidence |
|---|---|
| End-to-end flow | Two full runs, 0 failures. Create, 3 uploads, waiver, processing, every decision, generate, every download, test report, reconciliation, audit (444 entries) and imports all returned 201 or 200. |
| Uploads | Masters: 882 records. Transactions: 659 vouchers in 6 types. All three Trial Balance files accepted (108, 85 and 52 lines). Completeness: 0 missing, 0 count mismatches. |
| Processing | 2,019 records read and 68 flags raised (66 hidden-character warnings, 2 possible duplicates). A second run gives the same counts. Two processing requests sent at once are stored once. |
| Decisions and Prepare checklist | Open decisions went from 425 (242 blocking) to 88 (0 blocking). Tax, TDS, clash, item, duplicate and contact decisions survive a second processing run. |
| Confirm-first bulk actions | A bulk action sent without a count returns 409 with the count. Resending it with confirmCount applies it. |
| Test report | Blockers go from 1 to 0 after the one vendor without a state is fixed (both runs). |
| Files created | 10 files: chart of accounts 191 rows, customers 274, vendors 206 (207 minus 1 merged), items 29, invoices 32 rows / 28 documents, bills 185 / 166, journals 164 / 40, receipts-payments-contra journals 495 / 234, opening-balance journal 4 / 1, opening-balance reference 37 (not for import). |
| Zoho format | All 9 import files: headings identical to the Zoho samples in text and order. Strict CSV parse with 0 ragged rows. Dates yyyy-MM-dd and inside the FY. Plain decimal numbers. Coded values on the allowed lists. 0 cells over the length limit. |
| Uniqueness and references | Contact, account and item names are unique. One document is written per voucher. Every customer, vendor, account and tax referenced in a voucher file exists. |
| Journals | All 275 journals balance to the paisa. Every line has exactly one of Debit or Credit. |
| GST consistency | Contact GST Treatment and GSTIN match on every invoice and bill. GSTIN and PAN formats are valid. Tax name and tax type agree everywhere. |
| Out-of-date marking | Changing a decision marks exactly the affected files and adds 1 blocking item. Downloads of out-of-date files return 409. Creating the files again clears the mark. |
| Security: access | No sign-in: 102 of 102 protected routes return 401. Viewer: 53 of 53 data-changing routes return 403, with 0 audit rows written. Firm separation: 174 cross-firm calls, 0 leaks. Viewer screens are read-only on all 27 screens. |
| Security: sessions and passwords | Passwords are stored with salt and scrypt. The cookie is HttpOnly and SameSite=Strict. Disabling or demoting a user takes effect at once. |
| Upload robustness | Wrong types, empty files, truncated files and the wrong slot are rejected with clear messages. UTF-8 and UTF-16 (with or without BOM) are both accepted. Path traversal gives 404. No temporary files are left behind. |
| Scale | A synthetic file of 50,000 vouchers (200 MB) uploads in 3.2 s, processes in 4.3 s and generates in 6.3 s, and all 19 reconciliation checks pass. |
| Money and SQL | All money code uses decimal arithmetic. Every SQL user value is a bound parameter. |
| UI | All 27 screens render with the correct heading. No API errors for the admin. The wizard, browser history and routing work. No emoji. Black and white theme. |

---

## 3. Problems

### Blocker

None. No tester found a problem that stops the dummy test import.

### Major

| Id | Area | What happens | Fix |
|---|---|---|---|
| M1 | Processing again / journal routing | Processing again silently deletes every journal routing decision (206 of 206) and all created files. The Prepare screen even says "your decisions are kept", which is false for routing. | Store routing by a stable voucher key (Tally guid) and restore it after processing. At least ask for confirmation and give the count that will be lost. |
| M2 | Test report vs Prepare checklist | Unrouted journals are never blocking in the test report, while the Prepare checklist marks them blocking. 206 vouchers, including every bill, can be missing from the files while the reconciliation still passes. | Make "journals not routed" blocking when the count is above 0. Make the reconciliation warn when vouchers are awaiting routing. |
| M3 | Invoice and bill totals | When GST cannot be put on one line, the document is written without that tax. After full mapping, 10 documents (3 invoices, 7 bills) still differ from Tally. With partial tax mapping there can be up to 35. Vendor payables and input GST come out understated. None of these blocks import, and the reconciliation counts them as "explained". | Add a per-document decision: choose the line that carries the tax, or write the tax as its own line. Make large differences (over 1 rupee) blocking. |
| M4 | Held vouchers | 191 vouchers have no file: 30 payments received, 157 payments made and 4 vendor credits. They wait for the missing Zoho samples. Invoices and bills will show as unpaid, and bank, cash and party balances will not tie. This is by design and documented. | Add the three Zoho samples and build these files. Until then, offer an opt-in to write them as Manual Journals against AR/AP. |
| M5 | invoices.csv Item Name | All 32 invoice lines have an empty Item Name. The Zoho invoice sample marks Item Name as mandatory, so all 28 invoices may be rejected. The tool only gives a non-blocking warning. Bills are the same (185 rows), but the bill sample has no rules sheet to confirm against. | Write an Item Name, for example the account name or one service item per income account. Or block import until a one-invoice test proves Zoho accepts the empty value. |
| M6 | Financial year | Vouchers dated outside the migration's financial year only produce an upload warning. Processing and file creation go ahead, with no flag and nothing in the test report. | Flag out-of-year vouchers at processing. Block file creation, or require an acknowledgement, and list it in the test report. |
| M7 | Zoho file upload (XLSX) | A tiny crafted XLSX with a huge row or column number crashes the whole server (out of memory). Any signed-in analyst can do this through the rejections, verification or Zoho Trial Balance uploads. | Cap the row and column indexes in readXlsx and build rows as a dense list. |
| M8 | Zoho file upload (zip bomb) | Unzipping has no size limit. A 400 KB file expanded to 400 MB in memory, and the process grew to about 1.26 GB. | Pass maxOutputLength to inflateRawSync, check the size before unzipping, and return a friendly error. |
| M9 | Voucher Reconciliation speed | Time grows quadratically and blocks the whole server while it runs: 0.3 s at 5,000 vouchers, 24 to 39 s at 20,000, 184 s at 50,000. The cause is one query on the held-voucher table. The real data takes only 68 ms. | Add an index on held_vouchers(source_record_id), or rewrite the query with EXISTS: this fell from 19 s to 12 ms. Do not add the index on (job_id, source_record_id), which makes it slower. Cache the result per file version. |
| M10 | Mobile layout | At phone width the sidebar stays a fixed 272 px wide, leaving about 103 px for content. 25 of 27 screens scroll sideways. There is no menu button. This is minor if the tool is desktop-only. | Hide the sidebar on small screens and open it from a menu button. |

### Minor

| Id | Area | What happens | Fix |
|---|---|---|---|
| m1 | Flag kinds | 29 "stock item has no unit" flags and the journal "not routed" flags are stored with no kind, so they can be filtered only by matching the message text. | Store a kind when the flag is inserted. |
| m2 | Journal suggestions | 115 bills stay in "needs check" even after the TDS ledgers are mapped. 102 of them only carry mapped TDS. | Work out "needs check" from the current TDS mapping. |
| m3 | Out-of-date marking | Changing an account type or tax mapping and then changing it back still leaves the files marked out of date. | Compare the current settings with those recorded when the files were created, as is already done for GST codes. |
| m4 | Fix contacts | 88 to 90 contacts stay open (about 79 with no state and no GSTIN, 11 whose place differs from the GSTIN state). No bulk action covers them, so the Decisions step never shows done. | Add a bulk "use the GSTIN state" action and an "acknowledge, leave empty" option. |
| m5 | Detailed Trial Balance | The detailed file has 2 group lines at the lowest level, so the opening-balances reference file is not created. The message gives a count but not the names of those lines. | Name the group lines and explain which Tally option expands them. |
| m6 | items.csv | All 29 items lack a rate, accounts and tax preference, so all 29 would be rejected. No voucher uses any item. The tool already blocks this. | Leave Items out of the import order when no voucher uses an item. |
| m7 | TDS mapping | 102 bills carry a TDS name with no section or percentage. TDS names are not checked against any list of Zoho TDS taxes. | Keep a saved Zoho TDS list, check names against it, and ask for section and percent. |
| m8 | Zoho TB comparison | Differences caused by held vouchers get no note. TDS ledgers get the GST note. | Explain each difference by cause, and give TDS ledgers their own note. |
| m9 | Reverse charge | 11 reverse-charge bills are written without reverse-charge GST. The vendor total is correct and the two RCM legs cancel each other. | Add a reverse-charge decision that fills the RCM columns, or write the two legs as a journal. |
| m10 | IGST in one state | 2 bills carry IGST while source and destination are the same state, probably because the vendor's state is wrong in Tally. The flag does not block. | Offer the GSTIN state in one click. Consider making the flag blocking. |
| m11 | Mapping Studio | The account dropdown lists 5 Zoho account names twice, and React logs duplicate-key errors. | Remove duplicates before rendering. |
| m12 | Dashboard | The "files uploaded" total uses the selected migration's total (or a fixed 13) for every row. | Return each migration's own total. |
| m13 | Dashboard | The status column can say "Files ready to import" while the progress strip says that journals still need decisions. | Derive the status from the same step logic. |
| m14 | Login page | The Google and Microsoft buttons do nothing. "Need help" names the seed-users file location. | Hide the SSO buttons. Show the hint only in development builds. |
| m15 | New Migration (viewer) | A viewer sees the title "New migration" with blank read-only fields. | Treat the page as details view for read-only users. |
| m16 | Stale selection | The selected migration id is never cleared on sign-out or on a 404, so a request is repeated that is bound to fail. | Clear it on logout and on a 404. |
| m17 | Login | There is no rate limit or lockout. An unknown email is answered about 37 times faster than a known one, which reveals which emails have accounts. | Add rate limiting, and run a dummy hash when the user does not exist. |
| m18 | Requests before sign-in | Upload and JSON bodies are read in full before the 401 is sent: up to 4 GB for uploads, 300 MB for JSON. Only localhost can reach the server. | Check the session in onRequest, before the body is read. |
| m19 | Error messages | Some 500 errors return raw internal messages, including the absolute data folder path. | Add a global error handler that returns a friendly message. |
| m20 | Key lookups | `__proto__` and `constructor` are treated as valid slot names. Deleting an unknown slot returns 200. | Use Object.hasOwn or a Map, and return 404 for unknown keys. |
| m21 | Formulas in the Zoho CSVs | Tally text that starts with = + or @ is written as it is (documented). The real data has 0 such cells. | Flag such names at processing, and warn the user not to open the CSVs in Excel before import. |
| m22 | Wrong slot | The customers file in the Vendors slot is accepted with only a warning. The same file uploaded twice gives no note. | Flag group mismatches and duplicate checksums. |
| m23 | Other company | Files naming another company are accepted with warnings, and file creation is not blocked. | Require an explicit confirmation. |
| m24 | Sessions | The cookie has no Secure flag (fine on localhost). Expired sessions are never deleted. There is no password-change route. | Add the Secure flag under HTTPS, clean up expired sessions, and add password change. |
| m25 | Seed accounts | 4 test accounts, including a super admin, are created from a plaintext file on first start. | Seed them only when a flag is set, or force a password change at first login. |
| m26 | Migration ids | Ids count across all firms, which reveals how many migrations other firms have. | Number per firm, or use random ids. |
| m27 | Invalid UTF-8 | Bad bytes silently become replacement characters, with no warning. | Decode in strict mode, or warn with a count. |
| m28 | Records API | `limit=-1` removes the 500-row cap. | Clamp the limit to the range 1 to 500. |
| m29 | tally.js | A regex contains raw control bytes, so tools treat the file as binary. | Use \u escapes instead. |
| m30 | Frontend code | Lint gives 64 warnings (0 errors), and the JS bundle is 787 kB. | Fix the static-components warnings and code-split the screens. |
| m31 | Test coverage | Not covered by tests: the real-data pipeline, routing across a second processing run, out-of-year vouchers, the records limit, 3 auth routes, and frontend screens (only 10 frontend tests). | Add regression tests and an opt-in real-data smoke test that asserts counts only. |
| m32 | Encoding | No file starts with a UTF-8 BOM. Only 1 character in all files is non-ASCII. | Optional: write a BOM, or keep the UTF-8 instruction in the import steps. |
| m33 | Item tax rounding note | Invoices carry only the tax name and %, so Zoho recalculates the tax. 3 invoices already differ by 1 rupee or less. See also U7. | Confirm with a test import, then add round-off rows if needed. |

### Unconfirmed until a real Zoho import

These cannot be settled without importing into a real Zoho organisation. The dummy test import should check each one.

| Id | Question to settle in the test import | Count affected |
|---|---|---|
| U1 (could be major) | Does Zoho accept a bill with no GST and no Source of Supply? | 90 of 166 bills, 69 of 207 vendors |
| U2 | Does Zoho accept an invoice line with no Item Name (see M5)? | 28 invoices |
| U3 | Does Zoho accept contacts with an empty GST Treatment? A bulk fix already exists. | 7 customers, 31 vendors |
| U4 | Does Zoho accept negative line rates? | 4 invoices, 2 bills |
| U5 | Does Zoho trim names that end in a line break? Affected names are not used by any voucher. | 33 contacts, 1 possible duplicate pair |
| U6 | Do Zoho's own accounts exist and accept postings, especially GST Payable? | 6 accounts, 47 rows |
| U7 | How does Zoho round invoice tax (per line or per document)? | a few paise on 1 customer |
| U8 | Which account does Zoho post TDS to? The total ties either way. | 102 bills |
| U9 | Does the chart-of-accounts import create Bank accounts with no account number? | 4 bank accounts (3 with opening balances) |
| U10 | Does Zoho reject or recalculate IGST within one state (see m10)? | 2 bills |
| U11 | Does a Zoho Trial Balance export contain float noise that would cause false differences? Also: are large screens slow? | not measured |

### Checked and not a problem

| Claim | Result of the double-check |
|---|---|
| Kind-less flags cannot be grouped in the test report | Refuted. The test report groups them by message text. Only the stored kind is missing (kept as m1). |
| An unmapped tax ledger is an import blocker | Refuted. The document imports with a different total. It is not rejected (covered by M3). |
| 6 invoices have no Place of Supply | Not a problem. All 6 are overseas customers, and the field is left empty on purpose. |
| 5 to 10 401 errors on every sign-out | Refuted. Screens wait for the sign-in check. Only the stale-selection 404 is real (m16). |
| The Zoho TB comparison gives no reason for differences | Corrected. A general reason is shown. The per-account notes are missing (m8). |
| The detailed Trial Balance message says Alt+F1 | Corrected. It says Alt+F5. |
| An index on held_vouchers(job_id, source_record_id) fixes the slow reconciliation | Refuted. It made the query slower (19 s to 83 s). The right fix is in M9. |

---

## 4. Voucher reconciliation and trial balance tie-out

### Voucher reconciliation (real data, all decisions made)

| Check | Result |
|---|---|
| Vouchers in = out | 659 = 659 (659 distinct GUIDs) |
| Lines in = out | 1,703 = 1,703, also per type |
| Per type | sales 28, receipt 46, payment 341, journal 206, contra 34, debit note 4 |
| Written to files | 468: invoices 28, bills 166, manual journals 40, receipt/payment/contra journals 234 |
| Held (no Zoho sample) | 191: payments received 30, payments made 157, vendor credits 4 |
| Left out / awaiting routing | 0 / 0 |
| Voucher in two files | 0 |
| Tool checks | 19 of 19 pass |
| Independent check | Counts, lines, debit and credit per type agree. Every source voucher balances. Downloaded CSVs give 28 distinct invoices, 166 distinct bills, and 40 + 234 + 1 journals, all balanced. |

### Trial balance tie-out (simulated Zoho ledger vs Tally closing TB)

| Check | Result |
|---|---|
| Tally TB (ledger-level file) | 108 lines, all matched. Opening, closing and movement agree 108 of 108. |
| Tally TB (detailed file) | 85 lines (63 ledgers, 22 groups). Totals agree, but it is not at ledger level (m5). |
| Ledgers mapped to a Zoho name | 108 of 108 |
| Opening balances | 37 of 37 ledgers written exactly once with the same amount and side. Opening Balance Adjustments nets to zero. |
| Simulated Zoho TB | Balances (116 accounts) |
| Ledger match | 55 of 108 match to the paisa. 50 of the other 53 are fully explained (held vouchers, reverse charge, TDS columns, Zoho tax accounts). |
| Not explained | 2 vendors (tax not written, M3) and 1 customer differing by a few paise (rounding, U7) |
| GST | Total GST written equals Zoho's GST accounts, apart from a few paise of rounding |
| TDS | The Zoho TDS account equals Tally's TDS lines exactly (102 bills) |
| Tool's own Zoho TB comparison | 48 matched, 17 differing, 0 only in Tally, 7 only in Zoho (all are Zoho's own tax accounts) |
| Journals left unrouted (second scenario) | Tool reports 8 awaiting. 10 more ledgers then differ, all explained by those 8 vouchers. |

---

## 5. Test commands run and results

| Command / run | Result |
|---|---|
| `cd server && npm test` | 109 tests, 109 pass, 0 fail (about 25.6 s) |
| `cd frontend && npm test` | 10 tests, 10 pass, 0 fail |
| `npx vite build` (to a scratch folder) | Success, 2,129 modules. One warning: the bundle is 787 kB, over the 500 kB limit. |
| `npx oxlint` (frontend) | 0 errors, 64 warnings |
| End-to-end on real data (2 runs, app.inject) | 0 failures. Test report blockers reach 0. All 19 reconciliation checks pass. |
| Zoho acceptance check on 9 files | Headings, formats, coded values and references all pass. Issues are listed under M5, m6 and U1 to U10. |
| Accounting tie-out | See section 4 |
| Browser UI, 27 screens, admin and viewer, desktop and 375 px | All screens render. Issues: M10 and m11 to m16. |
| Security scan, 104 routes, 4 roles, 2 firms | 0 access leaks. Issues: M7, M8 and m17 to m27. |
| Synthetic scale run, 5k / 10k / 20k / 50k vouchers | Processing and file creation are fast. Reconciliation is slow (M9). |

Scratch scripts and outputs are in:
C:/Users/sumit/AppData/Local/Temp/claude/faf74b8c3823bc43/11f6d273-968a-4d96-8ae7-952d2a2d4069/scratchpad/selftest/
(subfolders e2e_x7, zoho_accept, tieout, tieout2). Some detail files there contain real names. They were never printed and should stay private.

---

## 6. Recommended next steps, in order

1. Fix M1: keep journal routing across a second processing run, or at least warn first. Also fix the false "your decisions are kept" text.
2. Fix M2: make unrouted journals blocking in the test report and in the reconciliation.
3. Fix M7 and M8: limit XLSX row and column indexes and the unzip size.
4. Fix M6: flag and block vouchers outside the financial year.
5. Decide on M5: write an Item Name on invoice and bill lines, or confirm in the test import that Zoho accepts an empty one.
6. Accountant review: decide the tax line for the 10 documents in M3 (or add a per-document action). Check the reverse-charge (m9) and IGST in one state (m10) bills.
7. Run the dummy Zoho test import in this order: chart of accounts, contacts, opening balances, then 1 invoice, 1 bill and 1 journal first. Record the answers to U1 to U11.
8. Fix M9 (reconciliation query) before using companies with more than about 10,000 vouchers.
9. Add the Zoho samples for Customer Payments, Vendor Payments and Vendor Credits so the 191 held vouchers can be written (M4).
10. Clean up the minor items, starting with m2, m4, m7 and the security minors m17 to m20, then add the regression tests (m31).
