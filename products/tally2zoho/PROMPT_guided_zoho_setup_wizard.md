# Prompt for a new session: guided Zoho set-up and import wizard

Paste everything below the line into a new session in the `ui` project.

---

We are improving a Tally-to-Zoho Books (India) migration tool at C:\Users\sumit\OneDrive\Desktop\ui (server/ = Fastify, frontend/ = React 19 + Tailwind 4). Work in plain simple English; the users are accountants, not engineers.

READ FIRST
- README.md, docs/ZOHO_IMPORT_RULES.md, server/src/zohorules.json
- real-data/zoho-test-2/TOOL_FEEDBACK_test2.md (everything the real Zoho tests taught us)
- final-test-run/REPORT.md and final-test-run/variant_B_ready_to_import/zip_text/READ_ME_FIRST.txt and READ_ME_IMPORT_ORDER.txt (what the tool generates today)
- zoho-screens/README.md and the PNG files in zoho-screens/ (the latest Zoho Books screens: where each setting really is, and how it is worded)
- server/src/importwizard.js, frontend/src/screens/app/Screen40_ImportWizard.jsx, frontend/src/importWizard.js
- the memory notes in C:\Users\sumit\.claude\projects\C--Users-sumit-OneDrive-Desktop-ui\memory\ (product decisions: pick-and-drop, no name cleaning, zero-decision defaults with an Assumptions list, one step per page, Back button)

THE REQUIREMENT (from our product meeting, near word for word)
"When we create a fresh Zoho in which the Tally data is going to be migrated via our tool, the tool itself should be able to guide, after consuming the Tally data, what kind of configuration or setup is required in Zoho, step by step. For that it needs to know how the latest Zoho interface looks, so we provide screenshots of different Zoho screens, so that when the tool gets Tally data it tells the user what the different tax configurations or other configurations in Zoho should be. For example, if bank accounts are not migrated and have to be created manually in Zoho, then before the migration even starts the tool should say: 'Please create these 3 bank accounts, go to this particular screen, create ICICI Bank, and put this opening balance.' The tool should help with the complete configuration of Zoho. There are not many places where configuration is needed: mostly bank account setup and tax rate setup. Once these are set up and structured, the user will not have to experiment or find their own way. The standardisation happens inside the tool. The CSV upload must follow a particular sequence, and the tool should guide it properly, ideally as a wizard where the user is very comfortable and knows exactly what to do at each step, either in Zoho or in the tool."

WHAT I FOUND WHEN I DEBUGGED THE LAST TEST (verify each point in the code before you rely on it)
1. The wizard already has the right order and locks (set-up, chart of accounts, bank check, Migration Date, customers, vendors, items, opening balances, bills, invoices, journals, compare). Customers and vendors are locked until the Migration Date step is done.
2. In the last test the person did NOT follow the wizard: they skipped the Migration Date step. Result: the opening balances of customers, vendors and the chart rows (equity, loans, fixed assets) were missing from Zoho's trial balance. So the real fix is a guide that is hard to skip and teaches why each step matters.
3. Step 1 "Set up Zoho Books" is one long checklist, not step-by-step by screen. It is not enforced: the chart import is not locked until the set-up is done (a person can skip GST settings and TDS taxes, and then 101 bill rows and 11 bills fail).
4. The set-up list is only partly driven by the data. It knows GSTIN, reverse charge need, overseas parties and the TDS taxes. It does NOT yet list: the bank accounts to create (name, type, opening balance), the exact GST / IGST taxes the files use (which must exist and be active), the HSN/SAC digits, the opening balances to type on the Opening Balances screen, and the place of each tax.
5. The text paths were wrong several times because Zoho's screens changed (examples now corrected: Preferences is under Setup & Configurations > General; HSN is under Module Settings > General > Items; a new TDS tax asks for the tax act first; "GST TDS Settings" is a different page from Income TDS and people open it by mistake). There are no pictures in the wizard, so the person must guess.
6. Zoho behaviours the guide must teach: the Migration Date cannot be saved alone (Zoho wants at least one real balance, then Continue); Zoho creates default taxes and accounts (skipped as duplicates on import); "Long Term Liability" is shown as "Non Current Liability"; TDS taxes made under the Old Income Tax Act show "Expired" and are still fine for past years; a journal with a customer or vendor line and a bank line is refused (needs a payment instead); Zoho's own screen error "Nothing handled the action gotoImportPreview" is fixed by reloading the page.
7. The tool cannot see inside Zoho, so each set-up step needs a way to confirm it (a tick the person gives, plus optionally reading a Zoho export the person uploads: the TDS tax export, the chart of accounts export, the trial balance).

WHAT TO BUILD
A. A data-driven "Zoho set-up plan" generated from the migration's Tally data: organisation profile, GST settings (registration, reverse charge, overseas/SEZ, custom duty account), the GST and IGST taxes the files use, TDS settings and the TDS taxes to create (name, rate, section, tax act, start date), HSN/SAC setting, preferences (adjustments, rounding), transaction locking, the bank accounts to create or check (name, type, opening balance, where in Zoho), the Migration Date and the exact balance to type to save it, and the opening balances to enter.
B. Each set-up item is its own wizard step, one step per page, with: why it matters (one sentence), the exact click path in today's Zoho wording, the exact values to type (with a copy button), a picture of the Zoho screen with the target highlighted (take them from zoho-screens/, or ask me for more), what "done" looks like, what to do if Zoho shows an error.
C. Sequencing: lock each later step until the earlier ones are confirmed, and say plainly why it is locked and what to do. Never let the person import contacts before the Migration Date is saved, or bills before the TDS taxes exist, or invoices before the HSN question is answered.
D. Confirmation: ticks by the person, and optional upload of Zoho's TDS export, chart export and trial balance so the tool can check the set-up instead of trusting it. After the last import, a guided "compare with Tally" step that explains every difference in plain words (use what the existing trial balance code does).
E. UX in the Zoho Books style already in the frontend: a stepper, a pinned Back and Next bar, progress remembered, resume where you left, plain English, no jargon.
F. GENERAL FOR ANY COMPANY: nothing hard-coded to this test company (no names, GSTIN, states, banks, tax rates, section codes). Test with synthetic companies: no bank accounts, many bank accounts, a company with no GST, a composition vendor, an exporter with overseas customers, a services company with TDS on rent and professional fees, a financial year that is not April to March, a state other than Karnataka.

DELIVERABLES
- The code, with tests (server npm test and frontend npm test, npm run build and npm run lint must pass).
- Updated docs/ZOHO_IMPORT_RULES.md and the generated READ_ME files, from the same plan.
- Run the finished tool on the real Tally files (real-data/Master.json, Transactions.json, TrialBal_ledgers.json) into a NEW folder final-test-run-2 (never change real-data/zoho-test-2 or final-test-run), and show me the set-up plan it produced.
- Look at the new wizard in the browser (the preview tools) and show me screenshots of the set-up steps.
- A short report in plain English of what changed and what is still unproven.

RULES
Do not change anything in real-data/. The data is confidential: no party names, GSTINs or amounts in docs or code. Ask me before anything outward-facing. If something about Zoho's screens is unknown, say so and ask me for a screenshot instead of guessing.
