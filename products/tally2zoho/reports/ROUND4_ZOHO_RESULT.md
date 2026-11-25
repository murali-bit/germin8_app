# Tally to Zoho Books: Round 4 result (15 Nov 2026)

## 1. In one line
The tool took the company's Tally data and made Zoho import files. All files went into Zoho with **no refused rows**, and **every balance in Zoho now equals Tally**.

## 2. What was done
1. **Fixed the tool's code.** The data files were never edited by hand. The fixes were tested on 10 made-up companies and on the real company.
2. **Built new Zoho files** from the real Tally data (folder `final-test-run-3`).
3. **Cleaned the Zoho test organisation** (Lessonboard Test Round 4) and set it up:
   - Migration Date 31/03/2025
   - 3 TDS taxes
   - SEZ / Overseas and Reverse Charge switched on
4. **Imported all files** through the Zoho screens, one by one.
5. **Compared Zoho with Tally**, account by account and party by party.

## 3. Import result

| File | Records | Refused |
|---|---|---|
| Customers | 274 | 0 |
| Vendors | 206 | 0 |
| Items | 30 | 0 |
| Opening balance journals | 2 | 0 |
| Bills | 160 | 0 |
| Invoices | 28 | 0 |
| Journals | 49 | 0 |
| Receipts, payments and contra journals | 425 | 0 |

Every Tally voucher (659 of 659) is in Zoho, each exactly once.

Before the fixes (test 2), Zoho refused 140 rows:
- bills: 101 rows for TDS details, 11 for IGST on bills from Adobe and Vega AI
- invoices: 26 for HSN codes, 2 for TDS details

## 4. Zoho compared with Tally

| Check | Compared | Same | Different |
|---|---|---|---|
| Accounts (closing balance 31/03/2026) | 63 | 63 | 0 |
| Customer and vendor balances | 480 | 480 | 0 |
| Tally ledgers missing in Zoho | – | – | none |

The comparison used Tally's own trial balance file, not the tool's own prediction.

## 5. Pros
- **No refused rows.** Every file was accepted the first time, once the setup was right.
- **Books match exactly.** Every account and every customer and vendor balance equals Tally to the paisa.
- **Nothing missing or doubled.** All 659 vouchers are in, each once.
- **Code fixes, not file edits.** The same tool works for the next company without hand work.
- **Tested beyond one company.** 10 made-up companies cover services, stock, no GST, foreign currency, TDS/TCS, SEZ and complex opening balances. 548 automatic tests: 546 pass, 0 fail, 2 known gaps.
- **Guides itself.** Each file comes with plain-English import steps and the exact numbers Zoho should show.
- **Predicts the result.** Before importing, the tool predicted Zoho's trial balance, and the real Zoho matched that prediction exactly.

## 6. Cons and open points
- **Invoices and bills still show as unpaid or overdue.** Payments came in as journals, so they sit as credits on each party. Balances are right, but to mark documents as paid, the credits must be applied by hand in Zoho (list: `credits_to_apply.csv`, 225 rows).
- **Zoho setup is manual.** TDS taxes, GST settings (SEZ/Overseas, Reverse Charge) and the Migration Date must be set in Zoho before importing. If one is missed, rows get refused.
- **The accountant should confirm a few choices the tool made:**
  - TDS 194H at Tally's 5% (the legal rate is 2%)
  - SAC code 999293 on the invoices
  - Adobe and Vega AI treated as foreign suppliers under reverse charge
- **Only one real company proven so far.** Other companies are tested on made-up data only. A real Zoho import of a second company is the next proof.
- **2 known gaps in the tool:**
  - A payment with an impossible date (29 Feb 2026) is left out until a correct date is entered.
  - Two almost identical party names are merged into one on purpose.
- **Easy to mix up files.** Old test folders use the same file names. In this round the old files were imported once by mistake. Delete or rename old folders before the next import.
- **Small leftovers in the test org:** 4 unused accounts at zero, and "Accounting Charges" chosen as the Custom Duty account. Harmless.
- **Zoho limits:** the account cannot create more organisations, and organisations could not be deleted. A test org must be cleaned by hand to reuse it.

## 7. Next steps (suggested)
1. Apply the journal credits so paid invoices and bills show as paid (optional).
2. Ask the accountant to confirm the 3 choices in section 6.
3. Run the tool on a second real company and import it into Zoho to prove "any company".
4. Remove old file folders so only the newest files can be picked.
