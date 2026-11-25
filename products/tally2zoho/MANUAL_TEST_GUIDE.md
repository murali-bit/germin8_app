# Manual test guide: Tally masters into Zoho Books

Goal: upload the real Tally files into the tool, download the four Zoho files (Chart of Accounts, Customers, Vendors, Items), and import them by hand into a **Zoho Books test organisation**. Invoices, Bills and Journals come in Part 2.

Never import into live books.

---

## Part A: prepare (once)

1. **Start the tool.** Both must be running, each in its own terminal:
   - `npm --prefix server start`
   - `npm --prefix frontend run dev`
2. Open **http://localhost:5173** and sign in as **admin@demo.test**. The password is in `server/seed-users.json`.
3. **Zoho Books test organisation:**
   - Country India.
   - Financial year April–March.
   - In **Settings → Taxes**, enable **GST**, and **TDS** if offered.
   - Open **Accountant → Chart of Accounts** and write down whether these already exist: Advance Tax, TDS Receivable, TDS Payable, TCS Receivable, GST Payable.

---

## Part B: create the files in the tool

1. **New Migration**:
   - Company: <your company name, as in Tally>
   - Financial year: **2025-26**
   - Method: Full Migration
2. **Upload Center**, upload three files from the `real-data` folder:
   - `Master.json` into **All masters in one file**
   - `Transactions.json` into **All transactions in one file**
   - `TrialBal_ledgers.json` into **Trial Balance**
3. **Completeness Check**: mark **Stock Summary** "Not applicable" (reason: no stock tracking), then click **Start processing**. Wait until it says finished.
4. **Mapping Studio**: one account group needs a decision (the group of **Suspense A/c**). Choose a type, for example *Other Current Liability*, or leave it, and that one row will be rejected.
   - **Names** are passed exactly as in Tally, in every file (pick and drop). They will be filled in from the GST portal later. Names with a line break are shown as **warnings**, not blockers: do **not** clean them for this first import.
   - **Rates → Business type** should say **Services (default)**, because Stock Summary is marked not applicable. Every item is then written with Product Type **service**. HSN/SAC is written only where Tally has it.
5. **Export Center**: click **Create files**.
   - The four master files say **"matches the official Zoho sample"**.
   - **Opening Balances** says **reference only, do not import**.
6. Download these four files:
   - `chart_of_accounts.csv`
   - `contacts_customers.csv`
   - `contacts_vendors.csv`
   - `items.csv`

---

## Part C: import into Zoho Books (in this order)

For each file, the steps are the same:
1. Open the module.
2. Choose **⋯ → Import**.
3. Choose the file, with **Character Encoding UTF-8**.
4. On **Map Fields**, check every column is matched. The names are Zoho's own, so they should match automatically.
5. Click **Preview**, then **Import**.
6. Write down how many rows were imported and how many were rejected. If any were rejected, **download Zoho's error file**.

| Step | File | Zoho Books module | What to expect |
|---|---|---|---|
| 1 | chart_of_accounts.csv (196 rows) | Accountant → Chart of Accounts | Possible "duplicate" rejections for the built-in names you wrote down in Part A. The Suspense row is rejected if its type was not chosen. |
| 2 | contacts_customers.csv (274 rows) | Sales → Customers | Watch whether GST Treatment codes `business_gst` and `business_none` are accepted. 7 rows have no GST Treatment. |
| 3 | contacts_vendors.csv (207 rows) | Purchases → Vendors | 31 rows have no GST Treatment. 42 rows have no Source Of Supply. 1 pair has the same name once cleaned (a warning: both are written as in Tally, so they are different names in the file). |
| 4 | items.csv (29 rows) | Items → Items → Import Items | Product Type is **service** for every row. **All 29 will probably be rejected**: Tally has no selling rate for them, and Zoho requires one. This is expected. |

**Names with a line break.** Watch whether Zoho accepts names that end in a line break (the CSV keeps the line break inside the quoted cell). If Zoho **rejects** such a name, write down which file and how many rows. Then, in **Mapping Studio → Names**, click **Clean** for that name (or **Clean all**), create the files again and import only the rejected rows. If cleaning makes two names the same, decide them under **Possible duplicates** first.

**Do not import** the Opening Balances reference file. The balances are already in the first three files. Importing it would enter them twice.

---

## Part D: report back

For each of the four files, tell me:
1. **Rows imported and rows rejected.**
2. **Zoho's error file**, if any. Upload it in the tool's **Rejection Manager** (the right card for that file), or save it in the `real-data` folder and tell me its name.
3. **Any screen** where Zoho complained before import (for example on Map Fields). Send a screenshot.

Also check once in Zoho: **Reports → Trial Balance** as of 1-Apr-2025 should show opening balances that agree with Tally.

---

## What the tool already checked (no need to re-check)

- Columns are identical to Zoho's official samples, for all four files.
- All 37 opening balances in the Trial Balance are written exactly once, with the same amount and side. Debits equal credits.
- Customers and vendors are not in the Chart of Accounts. Zoho holds them in Accounts Receivable and Accounts Payable.
- Every coded value (account type, GST treatment, state code, Debit/Credit) is one shown in Zoho's sample files.

## Known open points (decide after the first import)

1. **GST codes.** Zoho's sample files use `business_gst`, `business_none`, `overseas`. Zoho's help page uses `business_registered_regular`, `business_unregistered`, `consumer`. The import shows which is right; changing it is a one-line fix.
2. **33 names with a hidden line break**, passed as in Tally (warnings), and 1 vendor pair that is the same only once cleaned. Clean only if Zoho rejects them.
3. **5 accounts named like Zoho's own built-in accounts.**
4. **26 tax ledgers.** Keep them in Zoho, or use Zoho's own tax accounts?
5. **Item selling rates**, needed before Items can import.
