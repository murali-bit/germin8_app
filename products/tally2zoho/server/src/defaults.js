// THE ZERO-DECISION PATH (v2).
//
// Every open decision has an automatic, Zoho-safe default, so a user who uploads the Tally files and presses nothing
// else still gets files Zoho Books accepts. A decision made by a person always wins; a default is used only where no
// decision is stored. Nothing is silent: every default applied raises a flagged item of one of the kinds listed in
// ASSUMPTIONS when the files are created, is counted in the audit log, and is listed for the user as "Assumptions the
// tool made" (GET /api/migrations/:id/assumptions), with the place where it can be changed.
//
// This module holds the RULES, each in one small function so it can be changed in one place when Zoho's real import
// rules are confirmed. The files are built by zoho.js (masters) and vouchers.js (vouchers), which call these rules.
//
//  1. defaultClashDecisions   a ledger named like an account Zoho creates itself -> use Zoho's own account
//  2. openingBalanceViaJournal every ledger that is not a customer or vendor is written without opening balance; the
//                              balance goes to the dated opening balance journal (chooseDateAnchor: the one exception)
//  3. DEFAULT_ITEM_RATE        an item with no selling rate is written with Rate 0.00
//  4. (zoho.js gstTreatment)   a contact with a valid GSTIN is written as registered
//  5. (zoho.js placeOfContact) the state comes from a valid GSTIN when Tally has none, or another one
//  6. defaultMerges            two contacts of one file with the same name -> one party
//  7. nameFailsZohoRule        a name is cleaned by default only when it breaks a Zoho rule
//  8. defaultJournalRoute      journals: the clear suggestion, else Manual Journal; reimbursements -> Manual Journal
//  9. (vouchers.js)            Bill Number: the supplier's invoice number when Tally has one, else the voucher number
// 10. (vouchers.js)            the Bills file has NO Total, SubTotal, Balance or Item Total column (Zoho works the total
//                              out itself; an empty Total is read as 0 and refused)
// 11. hsnForZoho, resolveHsn   an HSN/SAC value that is not 4, 6 or 8 digits is not written; a chosen or suggested code is
// 12. billLineWithoutTax       a bill line of a registered vendor with no GST: Zoho's zero-rate tax (GST0 / IGST0)
// 13. defaultZohoTaxName       tax ledgers with no Zoho tax chosen: Zoho's own tax of the same rate (GST18, IGST18)
// The Zoho rules these follow are in docs/ZOHO_IMPORT_RULES.md (machine-readable: zohorules.json). on it

import fs from 'node:fs';
import { nameKey, GSTIN_FORMAT } from './tally.js';
import { builtinAccount, builtinAccountType, accountNameKey } from './zohocodes.js';

// ---------- the kinds of assumption (flagged items raised when the files are created) ----------
// title: shown on the "Assumptions the tool made" card. words: one plain sentence. where: the screen (and section) on
// which it can be changed. check: true when the user should look at it (the default may not be what they want).
// blocking: true when the rows are expected to be rejected by Zoho until someone acts.
const MS = anchor => ({ screen: 'screen-19', anchor });
export const ASSUMPTIONS = {
  company_not_gst_registered: { title: 'Company not registered for GST', where: MS('ms-tax-mapping'), unconfirmed: true, check: true,
    words: 'Nothing in the data says GST (no GSTIN on the migration, no company GST field on any voucher, no GST ledger), so the company is taken as not registered. Invoices and bills carry no tax, no exemption and no supply type, and the Zoho check does not apply the rules about GST on the lines. Create the Zoho Books organisation without GST. Zoho has not confirmed this by an import yet.' },
  company_gst_composition: { title: 'Company registered under the GST Composition scheme', where: MS('ms-tax-mapping'), unconfirmed: true, check: true,
    words: "Tally's registration type is Composition: the invoices charge no GST, so no zero-rate tax is added to an invoice line, and bills from registered vendors are treated as for a regular company. Zoho has not confirmed what a composition organisation accepts by an import yet." },
  company_gst_from_vouchers: { title: "Company GSTIN and state read from Tally's vouchers", where: MS('ms-tax-mapping'),
    words: "No GSTIN is entered on the migration, so the company's GSTIN and GST state are the most common values on Tally's vouchers. They decide the zero-rate tax of a line when a voucher lacks the company state, the default of the HSN/SAC field and the state the Zoho check compares with." },
  business_type_derived: { title: 'Business type goods read from the vouchers', where: MS('ms-item-rates'),
    words: 'The Stock Summary is marked not applicable, but vouchers move stock (inventory lines). The business type is goods, so the stock items are written as goods that can be bought and sold (Item Type "Sales and Purchases" with a purchase account) and the bills naming them are not refused. Choose "services" in Mapping Studio (Rates) if the company only sells services.' },
  ledger_added_from_trial_balance: { title: "Customers, vendors and accounts made from Tally's Trial Balance report", where: MS('ms-fix-contacts'), check: true,
    words: "A voucher names a ledger that is not in the masters export, but Tally's Trial Balance report lists it under its group. The files create it with the name exactly as Tally writes it, the type of that group, the Opening figure of its Trial Balance line and, for a customer or vendor, the GSTIN, registration type, state, country and currency its vouchers carry. Nothing else is taken or guessed. Export the masters again with the ledger to be sure." },
  item_product_type_from_hsn: { title: 'Product Type of service items read from the HSN/SAC', where: MS('ms-item-rates'), check: true,
    words: "Tally gives no type of supply (Goods or Services) for the ledger of an invoice line that is not a stock item, so the item's Product Type is read from its HSN/SAC: a code starting with 99 is a service, any other code is goods. Zoho Books takes the goods or service nature of the line from the item (GSTR-1, e-invoice)." },
  default_zoho_own_account: { title: "Accounts with the name of one of Zoho's own accounts", where: MS('ms-zoho-accounts'), check: true,
    words: "Zoho's own account is used. The Tally ledger is not written in the Chart of Accounts; its opening balance is in the opening balance journal." },
  zoho_own_account_name_renamed: { title: "Accounts named like one of Zoho's own accounts, of another kind: renamed", where: MS('ms-zoho-accounts'), check: true,
    words: "The Tally ledger's type (from its group) is not the kind of Zoho's account of the same name (an asset named like a Zoho equity or expense account, for example), or Zoho's account is the one the Adjustment of invoices or bills posts to. The ledger is written as an account of its own, with \" (Tally)\" added to its name because Zoho does not accept two accounts with one name." },
  migration_date_books_begin: { title: 'Migration Date set to the day before the books begin', where: { screen: 'screen-40', anchor: 'date' },
    words: "Tally's books begin after the first day of the year, so the masters' opening balances are the balances of that day. The Migration Date (and the opening balance journal) is the day before the books begin, not the day before the year starts." },
  opening_journal_split: { title: 'Opening balance journal split: proven lines (OB-1) and new kinds of line (OB-3)', where: { screen: 'screen-25', anchor: 'bank-opening-balances' }, unconfirmed: true, check: true,
    words: "Zoho Books accepted opening balance journal lines on bank accounts and on some of its own accounts (GST Payable, Advance Tax, TDS Receivable) in our imports. Lines on every other kind of account are written in a journal of their own, OB-3, with the same date and its own line on Opening Balance Adjustments, so that if Zoho refuses one of them the proven balances of OB-1 still go in. The totals per account are the same as one journal." },
  opening_journal_on_migration_date: { title: 'Opening balance journal dated on the Migration Date', where: { screen: 'screen-40', anchor: 'date' }, unconfirmed: true,
    words: 'Zoho advises not to date transactions on the Opening Balance Date (rule OB-NO-TRANSACTION-ON-THE-DATE). The journal is dated on it, as two test imports accepted; neither had saved the date first, so it is not proven. Press Sync after the last import and check that Opening Balance Adjustments is zero.' },
  closing_stock_not_carried: { title: 'Closing stock not carried to Zoho Books', where: MS('ms-item-rates'), check: true,
    words: 'The company keeps stock, but the items are written without inventory tracking and no closing stock entry is built, so the stock account keeps its opening value in Zoho Books and the profit differs from Tally by the change in stock. Decide how the stock is carried (a year-end manual journal, or inventory tracking).' },
  opening_balance_in_journal: { title: 'Opening balances written in the dated opening balance journal', where: { screen: 'screen-25', anchor: 'bank-opening-balances' }, unconfirmed: true,
    words: 'The account is written in the Chart of Accounts without its opening balance, and the balance is a line of the opening balance journal (OB-1), which carries its own date. So the balance does not depend on the Opening Balance Date of Zoho Books (and Zoho does not take a balance on a bank account in the Chart of Accounts import). Zoho accepted this journal with bank accounts and its own accounts; lines on other kinds of account are new, so check the first import.' },
  opening_date_anchor: { title: 'One opening balance kept in the Chart of Accounts file (to save the Migration Date)', where: { screen: 'screen-40', anchor: 'date' }, unconfirmed: true,
    words: 'Customers or vendors have opening balances, and Zoho Books dates those with its Opening Balance Date. Zoho does not save that date while every balance is 0. So one balance stays in the Chart of Accounts file: its import creates the opening balance record, and the date is then edited in the Import Wizard step "Save the Migration Date". Nothing is typed. This balance is not in the opening balance journal.' },
  opening_date_balance_to_type: { title: 'One opening balance to type in Zoho Books (to save the Migration Date)', where: { screen: 'screen-40', anchor: 'date' }, check: true,
    words: "Customers or vendors have opening balances, and no ledger with a balance can stay in the Chart of Accounts file (only bank, cash or Zoho's own accounts have one). Zoho does not save the Opening Balance Date while every balance is 0, so this one balance is typed in the Import Wizard step \"Save the Migration Date\". It is left out of the opening balance journal, so it is not counted twice." },
  balance_unusual_side: { title: 'Customers in credit and vendors in debit: balance carried by the opening balance journal', where: MS('ms-fix-contacts'), unconfirmed: true,
    words: "Zoho's Opening Balance column cannot carry an advance (a customer in credit, a vendor in debit). The cell is left empty and the balance is a line of journal OB-2 in the opening balance journal file: Accounts Receivable or Accounts Payable with the Contact Name, against Opening Balance Adjustments. In Zoho Books it becomes a credit that can be applied to invoices or bills. Zoho has not imported such a line yet: check the first import." },
  bank_ledger_as_credit_card: { title: 'Credit card ledgers kept under Bank Accounts', where: MS('ms-account-types'), check: true, unconfirmed: true,
    words: 'Tally has no group for credit cards. A ledger under Bank Accounts whose name says credit card and whose opening balance is a credit is written with the account type Credit Card, so it shows as a liability and not as a negative bank balance. No import has used this type yet: if Zoho refuses the row, add the card in Zoho Books (Banking > Add Bank or Credit Card) before the journals. Choose another type for the group in Mapping Studio (Account types) if it is not a card.' },
  card_ledger_as_liability: { title: 'Credit card ledgers under a group of their own: written as Other Current Liability', where: MS('ms-account-types'), check: true,
    words: 'The ledger name says credit card and its Tally group is not Bank Accounts. The type Credit Card has not been imported through the Chart of Accounts file by any test, so the confirmed type Other Current Liability is written. Add the card under Banking in Zoho Books with the same name if it should be a card account there.' },
  profit_and_loss_balance_in_journal: { title: "Profit & Loss A/c opening balance entered on Retained Earnings", where: { screen: "screen-25", anchor: "bank-opening-balances" },
    words: "Tally keeps the profit or loss of earlier years on its own Profit & Loss A/c ledger. Zoho Books keeps it on Retained Earnings, so the opening balance is a line of the opening balance journal (OB-1) on that account. Nothing is typed." },
  bank_ledger_credit_balance: { title: 'Bank ledgers with a credit opening balance', where: MS('ms-account-types'), check: true,
    words: 'The ledger is written as a Bank account, as its Tally group says, so its credit balance shows as a negative bank balance in Zoho Books. That is right for an overdrawn or cash credit account. If it is a credit card, its type in Zoho Books should be Credit Card: the tool does not guess that from the name alone.' },
  item_rate_zero: { title: 'Items with no selling rate', where: MS('ms-item-rates'), unconfirmed: true,
    words: 'Rate 0.00 is written, because Zoho requires a selling price. Whether Zoho accepts 0 is not confirmed until the next test import. Enter the real rate in Mapping Studio (Rates) or in Zoho Books.' },
  item_purchase_rate_zero: { title: 'Items with no purchase rate', where: MS('ms-item-rates'),
    words: 'Purchase Rate 0.00 is written. Enter the real rate in Mapping Studio (Rates) or in Zoho Books.' },
  gst_registered_from_gstin: { title: 'Contacts written as registered because they have a GSTIN', where: MS('ms-fix-contacts'), check: true,
    words: 'Tally does not say the party is registered, but it has a valid GSTIN, so it is written as registered.' },
  gst_registered_without_gstin: { title: 'Contacts registered in Tally with no GSTIN (Zoho will refuse them)', where: MS('ms-fix-contacts'), check: true, blocking: true,
    words: 'Written as in Tally (registered), with no GSTIN. Zoho refuses these rows (customers, vendors and the bills of such vendors). Add the GSTIN, or choose "treat as unregistered" for the ones that are not registered: in Fix contacts (Mapping Studio) one button treats all of them as unregistered. A bill of a registered vendor that cannot carry a tax is also written as a Manual Journal until that is done.' },
  state_from_gstin: { title: 'Contacts whose state was taken from the GSTIN', where: MS('ms-fix-contacts'),
    words: 'Tally has no usable state for the party, so the state of its GSTIN is written.' },
  pan_from_gstin: { title: 'Contacts whose PAN was taken from the GSTIN', where: MS('ms-fix-contacts'),
    words: 'Tally has no PAN for the party, so characters 3 to 12 of its GSTIN (the PAN) are written.' },
  place_differs_from_gstin: { title: 'Contacts whose state in Tally is not the state of the GSTIN', where: MS('ms-fix-contacts'), check: true,
    words: "The state of the GSTIN is written as place of contact or source of supply. Check which is right." },
  contact_merged_by_default: { title: 'Contacts with the same name written as one party', where: MS('ms-names'), check: true,
    words: 'Two rows with the same Display Name are rejected by Zoho, so they are written as one contact. Opening balances are added and vouchers name the contact kept.' },
  same_gstin_kept_apart: { title: 'Contacts with the same GSTIN and different names', where: MS('ms-names'), check: true,
    words: 'They are kept as separate contacts. Decide in Mapping Studio (Names) if they are one party.' },
  name_cleaned_for_zoho: { title: 'Names cleaned because Zoho does not accept them as written', where: MS('ms-names'),
    words: 'The name is written without the characters Zoho does not accept, the same in every file.' },
  // round 2 (SYN-5): a voucher the export cannot give as it is, written with the value the accountant entered
  voucher_date_corrected: { title: 'Vouchers written with a date the accountant entered', where: { screen: 'screen-20', anchor: 'journal-review' }, check: true,
    words: 'The exported date is not a real calendar day. The voucher is written with the date the accountant entered; the exported text is in the message. Correct it in Tally as well.' },
  voucher_amount_corrected: { title: 'Vouchers written with a line amount the accountant entered', where: { screen: 'screen-20', anchor: 'journal-review' }, check: true,
    words: 'The exported debits and credits differ. One line is written with the amount the accountant entered, so the voucher balances; the exported amount is in the message. Correct it in Tally as well.' },
  journal_default_suggestion: { title: 'Journals routed to the clear suggestion', where: { screen: 'screen-20', anchor: 'journal-review' },
    words: 'The journal is written as the Invoice, Bill or Manual Journal the tool suggests.' },
  journal_default_manual: { title: 'Journals with no clear suggestion', where: { screen: 'screen-20', anchor: 'journal-review' }, check: true,
    words: 'Written as a Manual Journal, which posts exactly what Tally posted.' },
  journal_default_reimbursement: { title: 'Reimbursement journals', where: { screen: 'screen-20', anchor: 'journal-review' }, check: true,
    words: 'An expense reimbursed to a party is written as a Manual Journal, not as a bill.' },
  payments_written_as_journals: { title: 'Customer and vendor payments and notes written as Manual Journals', where: MS('ms-voucher-files'), check: true,
    words: "Money received from customers, money paid to vendors, debit notes to vendors and credit notes to customers are written as Manual Journals: the party on Accounts Receivable or Accounts Payable with the Contact Name, the bank and every other line as in Tally. Zoho Books gives no import sample for its Payments files here, and it accepted these journals in test imports. So no voucher is held and nothing is typed: the trial balance can match Tally. The invoices and bills they pay stay open in Zoho Books until the credits are applied (see \"Credits to apply\"). Debit and credit notes written this way are not Vendor Credit or Credit Note documents in Zoho's GST reports. A two-line journal of a customer and a bank has not been through a test import yet; the same lines inside larger journals have." },
  journal_credits_to_apply: { title: 'Credits to apply to invoices and bills after the import (list given, nothing typed)', where: { screen: 'screen-40', anchor: 'credits' }, check: true,
    words: "A Manual Journal that credits a customer or debits a vendor leaves a credit on that contact in Zoho Books. The balances are right at once. The list credits_to_apply.csv (folder not_for_import of the zip) says, from Tally's bill-wise details, which invoice or bill each amount settles, which amounts belong to the opening balance, and which stay a credit as in Tally. Apply them in Zoho Books on the Import Wizard page \"Apply the credits\" so that invoices and bills show as paid. Not tried yet: applying a journal credit to a contact's opening balance." },
  journal_number_made_unique: { title: 'Journals renumbered because another voucher has the same number', where: MS('ms-voucher-files'),
    words: 'Tally numbers each voucher type on its own. Zoho Books reads rows with one journal number as one journal, so the later journal gets "-2" (or the next free number) after its number. The Tally voucher number is in the Notes.' },
  // TALLY-009 / OB-003: a number Zoho refuses is replaced, never left empty
  journal_number_generated: { title: 'Journals given a generated number (Tally number blank, not ending in digits or too long)', where: MS('ms-voucher-files'),
    words: 'Zoho requires a journal number of at most 16 characters that ends in digits. A voucher whose Tally number is blank, does not end in digits, or with its type code (RCT-, PMT- ...) is longer than 16 characters, is numbered by the tool: the type code and the digits the Tally number ends in when that number is free, else the type code and the next free six-digit number (JRN-000001 for a journal). The Tally voucher number is kept in the Notes.' },
  document_number_generated: { title: 'Invoices and bills given a generated number (no number in Tally, or too long)', where: MS('ms-voucher-files'),
    words: 'Zoho requires an Invoice Number (at most 50 characters) and a Bill Number. A voucher with none in Tally, or an invoice number longer than 50 characters, is numbered INV-000001 or BILL-000001 onwards, never a number another voucher uses. A Tally number that was too long is kept in the notes.' },
  // TALLY-002 / TALLY-003: posting vouchers are written, never skipped
  other_type_written_as_journal: { title: 'Vouchers of other types (Payroll, custom types) written as Manual Journals', where: { screen: 'screen-37', anchor: 'recon' }, check: true,
    words: "A voucher of a type Zoho Books has no document for (Payroll, a note with accounting entries, a type that cannot be traced to one of Tally's own types) that posts amounts to the ledgers in Tally is written as a Manual Journal posting exactly what Tally posted, so the trial balance stays Tally's. Memorandum, Reversing Journal and order vouchers, and vouchers with no ledger amount, post nothing in Tally and have no file." },
  sales_written_as_journal: { title: 'Sales vouchers that cannot be an invoice, written as Manual Journals', where: { screen: 'screen-37', anchor: 'recon' }, check: true,
    words: 'A Sales voucher without exactly one customer line, with the customer credited (a return entered as a sale), with no line besides the customer, or naming a party that is not a customer in the masters (for example Cash) is written as a Manual Journal posting exactly what Tally posted. It is not an invoice in Zoho Books (no GST document).' },
  purchase_written_as_journal: { title: 'Purchase vouchers that cannot be a bill, written as Manual Journals', where: { screen: 'screen-37', anchor: 'recon' }, check: true,
    words: 'A Purchase voucher without exactly one vendor line, with the vendor debited (a return entered as a purchase), with no line besides the vendor, or naming a party that is not a vendor in the masters is written as a Manual Journal posting exactly what Tally posted. It is not a bill in Zoho Books (no GST document).' },
  // TALLY-007
  voucher_status_unverified: { title: 'Vouchers with a Tally status whose effect is not confirmed (on hold, post-dated, opening balance)', where: { screen: 'screen-37', anchor: 'recon' }, check: true, unconfirmed: true,
    words: 'Tally marks the voucher on hold, post-dated or as an opening balance entry. What that means for the books has not been confirmed with a real export, so the voucher is written as Tally holds it. Check each one in Tally and take it out of the file if it is not posted in this period.' },
  bill_number_from_reference: { title: "Bills numbered with the supplier's invoice number", where: MS('ms-voucher-files'),
    words: "The supplier's invoice number from Tally is the Bill Number. Bills without one carry the Tally voucher number." },
  bill_number_collision: { title: 'Bills whose number was already used for the same vendor', where: MS('ms-voucher-files'), check: true,
    words: 'Two bills of one vendor cannot have the same number in Zoho, so the Tally voucher number is written for the later one.' },
  bill_number_shared_by_vendors: { title: 'Bill numbers used by more than one vendor', where: MS('ms-voucher-files'), check: true,
    words: 'Different suppliers use the same invoice number. Each is a separate bill. If Zoho joins or rejects them, switch the Bill Number to the Tally voucher number.' },
  tax_name_default: { title: "Documents taxed with Zoho's own tax names", where: MS('ms-tax-mapping'), check: true, unconfirmed: true,
    words: "No Zoho tax is chosen for the Tally tax ledgers, so Zoho's own tax of the same rate is written (GST18 for CGST and SGST, IGST18 for IGST). Not confirmed until the next test import: choose the tax names in Mapping Studio (Tax mapping) if your organisation uses others." },
  hsn_not_written: { title: 'HSN/SAC values that Zoho does not accept', where: MS('ms-hsn'), check: true,
    words: 'An HSN/SAC value that is not 4, 6 or 8 digits (or is shorter than the organisation takes) is not written as it is. A code chosen or suggested for the line is written instead; with none, the cell is empty. Add a correction (old value to new value) in Mapping Studio to write the right code.' },
  hsn_suggested: { title: 'HSN/SAC codes suggested from the words of the ledger or item name', where: MS('ms-hsn'), check: true, unconfirmed: true,
    words: 'The HSN/SAC field is on in Zoho Books, which refuses an invoice line without a code of at least 6 digits. Tally has no code for these lines, so a usual SAC for the kind of service is written. It is only a suggestion. Zoho Books will accept it even if it is wrong, but a wrong SAC is wrong in your GST returns too: check it with your accountant, or choose the right code for the ledger or item in Mapping Studio (HSN/SAC), which replaces the suggestion.' },
  hsn_from_heading: { title: 'HSN/SAC written from the shorter heading Tally has', where: MS('ms-hsn'), check: true, unconfirmed: true,
    words: 'Tally has a heading shorter than Zoho takes (for example a 5-digit SAC group). A 6-digit code under that heading, the one that fits the words of the item or ledger name, is written. Confirm it, or choose another code under the heading in Mapping Studio (HSN/SAC).' },
  hsn_outside_heading: { title: 'HSN/SAC suggested outside the heading Tally has', where: MS('ms-hsn'), check: true, unconfirmed: true,
    words: 'Tally has a heading shorter than Zoho takes, and no suggested code lies under it, so the code suggested from the words of the name is written although it is under another heading. Choose the right code under Tally\'s heading in Mapping Studio (HSN/SAC).' },
  hsn_suggestion_ambiguous: { title: 'HSN/SAC suggestions where two kinds of service fit the name', where: MS('ms-hsn'), check: true, unconfirmed: true,
    words: 'The words of the item or ledger name fit two kinds of service equally well. The first is written and the other is named in the flagged item. Choose the right code in Mapping Studio (HSN/SAC).' },
  zoho_tax_rounding: { title: 'How Zoho Books rounds the tax', where: MS('ms-voucher-files'), unconfirmed: true,
    words: "The files expect Zoho's item-level tax rounding: each part of the tax (CGST, SGST, IGST) of each line rounded to the paisa, as a test import showed. If your organisation rounds the tax per transaction (Settings > Taxes), choose that in Voucher files, so the rounding Adjustments are worked out the same way." },
  tax_rate_from_amount: { title: "GST rate taken from Tally's amounts, not from the tax ledger", where: MS('ms-tax-mapping'), check: true,
    words: "The rate on the Tally tax ledger does not fit the tax Tally booked, and exactly one standard GST rate does. Zoho works the tax out from the rate, so that rate (and Zoho's own tax of that rate) is written: the tax and the total stay Tally's. Check the rate on the tax ledger in Tally." },
  gst_on_other_duty_line: { title: 'GST put on a duty line of type "Others"', where: MS('ms-tax-mapping'), check: true, unconfirmed: true,
    words: "Tally's GST on the bill is the rate on the lines together with a Duties & Taxes line whose type is neither GST nor TDS, not on the other lines alone. Zoho works the tax out line by line, so that line carries the same GST, with its own account and amount, and the bill total and the GST stay Tally's. Not confirmed until the next test import that Zoho takes GST on a line of that account." },
  adjustment_journal: { title: "Adjustment journals generated (Zoho's adjustment account back to the Tally ledgers)", where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: 'Zoho posts the Adjustment of an invoice to "Other Charges" and of a bill to "Other Expenses" (a test import), accounts Tally does not have. One Manual Journal per month in the Manual Journals file moves each amount back: to the round-off ledger, to the ledger of an invoice line that is not income, or to the tax account whose tax Zoho rounded differently. It is not confirmed until the next test import that Zoho takes a journal line on these accounts. Change the account names in Voucher files if your organisation uses others; leave them empty to generate no journal.' },
  hsn_default_used: { title: 'HSN/SAC codes written from the code chosen for the ledger or item', where: MS('ms-hsn'),
    words: 'Tally has no HSN/SAC on these lines, so the code chosen in Mapping Studio (HSN/SAC) for the item or the income ledger is written.' },
  hsn_missing_required: { title: 'Lines with no HSN/SAC while the field is on in Zoho Books (Zoho will refuse them)', where: MS('ms-hsn'), check: true, blocking: true,
    words: 'Tally has no HSN/SAC for these lines and no code is chosen or suggested. Zoho refuses a line without a code of at least 6 digits when the HSN/SAC field is on. Choose a code in Mapping Studio (HSN/SAC), or switch the field off in Zoho Books and answer "No" in the Import Wizard.' },
  tax_ledger_to_zoho_account: { title: "Tally GST ledgers entered on Zoho's own tax accounts", where: MS('ms-zoho-accounts'), check: true,
    words: "A Tally ledger under Duties & Taxes with a GST duty head is not written to the Chart of Accounts: Zoho's own account (for example Input CGST or Output IGST) is used, because invoices and bills post there and a second account would split the balance. Its opening balance is in the opening balance journal, and journals use Zoho's account. To keep a ledger as an account of its own, rename it in Mapping Studio (Zoho's own accounts)." },
  tds_ledger_to_zoho_account: { title: "Tally TDS ledgers entered on Zoho's own TDS Payable or TDS Receivable", where: MS('ms-zoho-accounts'), check: true,
    words: "The ledger is the TDS ledger of bills (or invoices) in these files. Zoho Books posts the TDS of every bill to its own account TDS Payable, and of every invoice to TDS Receivable, whatever TDS tax is named (a test import showed it). So the ledger is not written to the Chart of Accounts: its opening balance, its journals and its payments use Zoho's account, and the balance is not split. Several TDS ledgers of Tally (one per section) become one Zoho account; the section stays on each bill, in the TDS tax. To keep a ledger as an account of its own, rename it in Mapping Studio (Zoho's own accounts): the tax alignment journal then moves the TDS of the bills to it." },
  rcm_ledger_to_zoho_account: { title: "Tally reverse charge ledgers entered on Zoho's own accounts", where: MS('ms-zoho-accounts'), check: true, unconfirmed: true,
    words: "The reverse charge bills in these files debit one of these ledgers and credit the other. Zoho Books posts the reverse charge of a bill as a debit on its own account Reverse Charge Tax Input but not due and a credit on its Output tax account of the tax written (a test import showed both, for bills that were not paid yet). So the ledgers are not written to the Chart of Accounts: their journals and payments use Zoho's accounts. Not confirmed by an import yet: that Zoho takes a journal line on Reverse Charge Tax Input but not due, where it posts the reverse charge of an overseas vendor's bill, and whether it moves the input to another account when the bill is paid. Check these accounts in Zoho's trial balance after the import." },
  tds_ledger_kept_separate: { title: 'TDS ledgers kept as accounts of their own (no bill or invoice uses them)', where: MS('ms-zoho-accounts'),
    words: "No bill or invoice in these files carries TDS on this ledger (for example TDS on salary, posted by journals and payments only), so Zoho Books posts nothing for it on TDS Payable. It stays an account of its own with Tally's balance." },
  tax_alignment_journal: { title: "Tax alignment journals generated (Zoho's TDS and reverse charge accounts against the Tally ledgers)", where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "Zoho Books posts the TDS and the reverse charge of bills and invoices to its own accounts. Where the Tally ledger is not entered on that same account, or Zoho works the reverse charge out a paisa away from Tally, one Manual Journal per month in the Manual Journals file moves the difference, so every account ends at Tally's figure. It is not confirmed until the next test import that Zoho takes a journal line on these accounts." },
  vendor_overseas_reverse_charge: { title: 'Vendors written as overseas (import of services under reverse charge)', where: MS('ms-fix-contacts'), check: true, unconfirmed: true,
    words: "The vendor has no GSTIN and no state, and Tally booked IGST under reverse charge on its bills: a supplier outside India. The vendor and its bills are written with GST Treatment overseas, IGST under reverse charge and no Source of Supply. Tick SEZ / Overseas Trading in Zoho's GST Settings before the import (the Import Wizard asks for it). If the vendor is in India, give it a state in Fix contacts." },
  tax_ledger_needs_decision: { title: 'Tally tax ledgers that may belong on a Zoho system account (not decided)', where: MS('ms-zoho-accounts'), check: true,
    words: "The ledger looks like a cess, reverse charge or TDS ledger. A Zoho system account may exist for it, but this is not certain, so it is written as an account of its own. Zoho posts such taxes to its own accounts, so the Zoho trial balance will differ from Tally on these ledgers until you choose Zoho's own account for them or accept the difference. Decide in Mapping Studio (Zoho's own accounts) whether to use the suggested Zoho account." },
  hsn_corrected: { title: 'HSN/SAC values corrected', where: MS('ms-hsn'),
    words: 'The value is written as corrected in Mapping Studio (HSN/SAC corrections).' },
  bill_line_zero_tax: { title: 'Bills of a registered vendor with lines that carry no GST', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "Zoho asks for a tax, an exemption or reverse charge on every line of a registered vendor. The zero-rate tax is written: GST0 within the state, IGST0 between states. Not confirmed until the next test import. If these purchases are exempt or under reverse charge, change the setting in Mapping Studio (Voucher files)." },
  bill_line_exemption: { title: 'Bills of a registered vendor with lines written with an exemption', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: 'The tax exemption chosen for this migration is written on lines of a registered vendor that carry no GST. It must exist in Zoho Books (Tax Exemptions). Not confirmed until the next test import.' },
  bill_line_reverse_charge: { title: 'Bills of a registered vendor with lines written under reverse charge', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: 'The reverse charge tax chosen for this migration is written on lines of a registered vendor that carry no GST. Not confirmed until the next test import.' },
  bill_line_needs_tax_or_exemption: { title: 'Bills of a registered vendor with lines Zoho will refuse (no tax could be written)', where: MS('ms-voucher-files'), check: true, blocking: true,
    words: 'Zoho asks for a tax, a tax exemption or reverse charge on these lines, and the tool could not write one: the GST of the bill could not be put on its lines, the bill has the shape of reverse charge, or a state is missing.' },
  account_type_default: { title: 'Accounts whose type was taken from the nature of the Tally group', where: MS('ms-account-types'), check: true,
    words: 'No Zoho account type is decided for the Tally group and it has no standard one, so the type follows the nature Tally records on the group (asset, liability, income or expense). Zoho refuses a row with no type.' },
  account_type_unconfirmed: { title: 'Accounts with an account type no import has confirmed yet', where: MS('ms-account-types'), check: true, unconfirmed: true,
    words: 'Zoho lists the type (for example Non Current Liability for loans, Stock, Other Asset) but none of our imports has used it yet. Watch these rows in the next import; if Zoho refuses one ("Invalid row"), choose another type for the Tally group.' },
  account_type_not_valid_in_india: { title: 'Accounts with an account type Zoho Books India does not have', where: MS('ms-account-types'), check: true, blocking: true,
    words: 'A type that is not in the list of Zoho Books India makes Zoho refuse the row ("Invalid row"), and the vouchers that use the account fail with it. Choose a valid type for the Tally group.' },
  item_sales_only: { title: 'Items written for sales only', where: MS('ms-item-rates'),
    words: 'Zoho requires a Purchase Account and rate for an item that can be bought. None is known, so Item Type "Sales" is written. Choose a purchase account and rate in Mapping Studio (Rates) to write "Sales and Purchases".' },
  item_account_default: { title: "Items on Zoho's default accounts", where: MS('ms-item-rates'),
    words: 'No sales (or purchase) account is chosen for the Items file, so Zoho\'s own "Sales" (and "Cost of Goods Sold") account is written. Choose the accounts in Mapping Studio (Rates) if they should be others.' },
  financial_year_from_data: { title: 'Financial year taken from the Tally data (not 1 April to 31 March)', where: MS('ms-voucher-files'), check: true,
    words: "Tally's books begin on the first day of another month and the vouchers fall in the twelve months from it, so the files follow that year: vouchers outside it are left out and the opening balance journal is dated the day before it starts. Set the year start on New Migration if the company's year is another." },
  left_out_outside_year: { title: 'Vouchers dated outside the financial year', where: MS('ms-voucher-files'), check: true,
    words: 'They are not written to the files. Switch "vouchers outside the financial year" to include them.' },
  voucher_outside_year_included: { title: 'Vouchers dated outside the financial year (included)', where: MS('ms-voucher-files'), check: true,
    words: 'They are written to the files because the switch is set to include them.' },
  tds_name_default: { title: 'TDS written with a suggested Zoho TDS tax', where: MS('ms-tds-mapping'), check: true, unconfirmed: true,
    words: "No Zoho TDS tax is chosen for the Tally TDS ledger, so the one that fits its section is written in the TDS columns (TDS deducted by a customer on a ledger with no section: the section that fits the rate; a rate that fits no section is left for you to choose). Check the tax exists in Zoho Books (Settings > Taxes > Income TDS Rates; the list of TDS taxes to create is in the Import Wizard), or pick another in Mapping Studio (TDS mapping). Zoho posts the TDS to the account linked to the TDS tax (TDS Payable or TDS Receivable unless changed there)." },
  tds_details_filled: { title: 'TDS percentage and section code written on every TDS row', where: MS('ms-tds-mapping'), unconfirmed: true,
    words: "Zoho refuses a row with TDS but no percentage or section code. The percentage is the rate Tally's own TDS amount shows (amount divided by the base), else the ledger's rate, else Zoho's rate for that tax, else the usual rate of the section. The section code is the section number (194J) for dates before 01/04/2026 and the new Income Tax Act code from then on. Change them in Mapping Studio (TDS mapping) or the tax act in Voucher files." },
  tds_details_missing: { title: 'TDS rows with no percentage or section code (Zoho will refuse them)', where: MS('ms-tds-mapping'), check: true, blocking: true,
    words: 'The percentage or the section code of the TDS could not be worked out from Tally, from the TDS mapping or from the table. Zoho refuses such a row ("Enter the required TDS details."). Enter them in Mapping Studio (TDS mapping).' },
  tds_section_ambiguous: { title: 'TDS rate that fits more than one section', where: MS('ms-tds-mapping'), check: true, unconfirmed: true,
    words: "TDS deducted by a customer, on a ledger with no section in Tally, at a rate that fits more than one section (for example 0.1%). The first section that fits is written. Choose the right Zoho TDS tax for the ledger in Mapping Studio (TDS mapping)." },
  tds_tax_name_made_unique: { title: 'TDS taxes written with a name that includes the section and rate', where: MS('ms-tds-mapping'), check: true,
    words: "A TDS tax of the usual name already exists in Zoho, or is created by this tool, with another rate or section (for example Commission or Brokerage at 2%). The tax is written as a new tax, for example Commission or Brokerage 194H 5%, so two taxes never share a name. Create it as listed under TDS taxes to create." },
  tcs_to_adjustment: { title: 'Tax collected at source written in the Adjustment column', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "A Tally ledger whose type of duty/tax is TCS is on the invoice (or bill). It is written in the Adjustment column, never as a GST line or a zero-rated GST0 purchase; the adjustment journal moves it back to the TCS ledger, so the trial balance is Tally's. Zoho's TCS reports stay empty for it: choose TCS columns in Voucher files to write Zoho's TCS columns instead (the TCS taxes must be created in Zoho first)." },
  tcs_in_columns: { title: "Tax collected at source written in Zoho's TCS columns", where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "TCS is written in TCS Tax Name, TCS Percentage, TCS Amount and Nature Of Collection, with a tax named TCS, its section and its rate (for example TCS 206C(1) 1%), to create in Zoho Books before the import. The nature of collection is the 1961 Act section before 01/04/2026 and the code of Zoho's list from then on. Not proven by an import yet." },
  tcs_details_missing: { title: 'TCS that could not be written in the TCS columns', where: MS('ms-voucher-files'), check: true,
    words: "The nature of collection (from Tally's nature of goods) or the rate of the TCS is not known, so it is written in the Adjustment column instead and moved back to the TCS ledger by the adjustment journal." },
  tds_tax_not_valid_on_date: { title: 'TDS taxes of your Zoho export not valid on the date of a document', where: MS('ms-tds-mapping'), check: true, unconfirmed: true,
    words: "Zoho's TDS export has a tax of this section and rate, but it starts after the document's date, ends before it, or is Inactive. It is not used for the document (TDS-003): the tax is listed under TDS taxes to create, with the act and start date the document needs." },
  tds_section_not_known: { title: 'TDS section codes that are not known (Zoho will refuse them)', where: MS('ms-tds-mapping'), check: true, blocking: true,
    words: "The section chosen in TDS mapping is neither a section of the Income Tax Act, 1961 (for example 194J) nor a code of Zoho's list for the Income Tax Act, 2025 (for example professional_fees). Choose a section that is." },
  tds_new_code_on_old_date: { title: 'TDS written with a new-act code on a document before 01/04/2026', where: MS('ms-tds-mapping'), check: true, unconfirmed: true,
    words: "The chosen Zoho TDS tax has a code of the Income Tax Act, 2025 that no section of the 1961 Act is known for, and the document is dated before 01/04/2026. The code is written (the only form known); Zoho may refuse it. Choose the section in Mapping Studio (TDS mapping)." },
  rcm_tax_type_changed: { title: 'Reverse charge written with GST (or IGST) to fit the states', where: MS('ms-tax-mapping'), check: true, unconfirmed: true,
    words: 'Tally booked the reverse charge as IGST for a supply inside one state (or as CGST and SGST for a supply between states). Zoho refuses that ("IGST cannot be applied as this is an intrastate transaction"), so the tax that fits the two states is written. Amounts are unchanged; the tax accounts differ from Tally.' },
  rcm_state_unknown_assumed: { title: 'Reverse charge on a vendor with no state', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "The vendor has no state and Tally booked IGST. With no GSTIN either, the supplier is taken as outside India (an import of services, the default): the vendor and the bill are written as overseas and the reverse charge stays IGST. The other choice for this case is GST (the supply is taken as inside the company's state). If the vendor is in India, give it a state in Fix contacts." },
  zoho_recompute_adjusted: { title: 'Paisa differences written in the Adjustment column', where: MS('ms-voucher-files'), unconfirmed: true,
    words: "Zoho works the tax out from the rate, each part (CGST, SGST, IGST) rounded on its own, and ignores Tally's tax amounts; it keeps Tally's TDS Amount as written. Where the tax still differs from Tally by rounding, the difference is written in the Adjustment column so the document total equals Tally's, and the generated adjustment journal moves it to the tax account. Change the setting in Voucher files to leave it as Zoho works it out." },
  zoho_recompute_differs: { title: 'Documents whose tax or TDS Zoho will work out differently', where: MS('ms-voucher-files'), check: true,
    words: "Zoho works tax and TDS out from the rate and the base, and the result differs from Tally by more than rounding. The document total in Zoho will not equal Tally's. Accept Zoho's figure, or correct the rate or the amount in Tally and export again." },
  service_item_for_account: { title: 'Service items made for invoice lines without a stock item', where: MS('ms-item-rates'), unconfirmed: true,
    words: 'Zoho needs an Item Name on every invoice line. A line that is only a ledger amount carries a service item named after its account, added to the Items file with rate 0.00 and that account.' },
  round_off_adjustment: { title: 'Round-off written in the Adjustment column', where: MS('ms-voucher-files'), unconfirmed: true,
    words: 'A round-off ledger line (Tally type Invoice Rounding) is written in Adjustment, with "Round Off" as description, instead of a line. Check that Adjustments is ticked in Zoho Books (Settings > Setup & Configurations > General; it is ticked by default in a new organisation) before the import.' },
  invoice_line_zero_tax: { title: 'Invoice lines with no GST written with the zero-rate tax', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: 'Zoho asks for a tax, an exemption or a non-GST supply type on every invoice line. A positive income line with no GST in Tally gets GST0 within the state and IGST0 between states (never a negative line, never a line that is not income). If those sales are exempt or outside GST, correct them in Zoho Books.' },
  invoice_line_to_adjustment: { title: 'Invoice lines on accounts that are not income, written in Adjustment', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: 'An invoice line on an expense, asset or tax ledger is written in the Adjustment column, not as a line: Zoho needs an income account and an item on every line, and a zero-rate GST on such a line would be wrong. The invoice total stays Tally\'s. Zoho posts the Adjustment to its own account ("Other Charges" in a test import); the adjustment journal generated in the Manual Journals file moves it back to the ledger.' },
  reverse_charge_written: { title: 'Bills under reverse charge written in the Reverse Charge columns', where: MS('ms-tax-mapping'), check: true, unconfirmed: true,
    words: 'GST debited and credited with the same amount on a purchase is tax under reverse charge. It is written in Reverse Charge Tax Name, Rate and Type (Zoho\'s own GST or IGST tax of the rate), so Zoho posts the input credit and the tax payable itself. Turn on reverse charge in Zoho Books (GST Settings) before the import.' },
  // ---------- foreign currency (tally.js parseTallyAmount; zohocodes.js currencyCode) ----------
  currency_code_from_tally: { title: 'Customers and vendors kept in another currency, written with its code', where: MS('ms-fix-contacts'), check: true, unconfirmed: true,
    words: "Tally keeps the party in another currency, so the contact is written with that Currency Code (read from Tally's Currency master), and its opening balance in that currency at Tally's rate (Opening Balance Exchange Rate). Add the currency in Zoho Books (Settings > Currencies) before importing the contacts. Not confirmed by an import yet." },
  currency_code_assumed: { title: 'Currency codes taken from the currency symbol (no code in the Tally Currency master)', where: MS('ms-fix-contacts'), check: true, unconfirmed: true,
    words: 'The Currency master in Tally gives no three-letter code, so the usual code of the symbol is written ($ as USD, € as EUR, £ as GBP). Check that it is the right currency before the import.' },
  forex_document_in_currency: { title: 'Invoices and bills written in the currency of the party', where: MS('ms-voucher-files'), unconfirmed: true,
    words: "An invoice or bill of a party kept in another currency is written in that currency, each line at Tally's foreign amount, with Currency Code and Exchange Rate (Tally's rate). Zoho Books converts the total to rupees. Not confirmed by an import yet." },
  forex_rounding_difference: { title: 'Paisa differences: Zoho converts a foreign total, Tally each line', where: MS('ms-voucher-files'), check: true,
    words: 'Tally converts each line (or opening bill) to rupees and rounds each; Zoho Books converts the total of the document or balance. The rupee value can differ by a paisa or so: the party and the income or expense differ from Tally by that amount. Accept it, or post it to the exchange gain or loss account after the import.' },
  forex_journal_in_currency: { title: 'Receipts, payments and journals of a foreign-currency party written in its currency', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "A journal naming a contact kept in another currency, whose every line has a foreign amount at one rate of Tally's, is written in that currency (Currency, Exchange Rate = Tally's rate, the foreign amounts). Each line converts to Tally's rupee amount to the paisa. Not confirmed by an import yet." },
  forex_journal_in_rupees: { title: 'Receipts, payments and journals in another currency written in rupees', where: MS('ms-voucher-files'), check: true, unconfirmed: true,
    words: "A receipt, payment, contra or journal with lines in another currency (or naming a party kept in another currency) is written as a Manual Journal in rupees, at Tally's rupee amounts, so every account gets exactly what Tally posted. Zoho Books then holds no foreign amount for it: a payment is not matched to the foreign invoice or bill, and the exchange difference stays as Tally booked it. Not confirmed by an import yet that Zoho takes a rupee journal line naming a contact kept in another currency." },
  forex_document_not_in_contact_currency: { title: 'Invoices and bills of a party in another currency that can only be written in rupees', where: MS('ms-voucher-files'), check: true, blocking: true,
    words: "The party is kept in another currency, but the voucher has no foreign amounts (or has GST, TDS or an adjustment, which Zoho works out in the currency). It is written in rupees, which Zoho Books refuses for such a party: enter it by hand in Zoho Books, or correct it in Tally." },
  foreign_account_in_rupees: { title: 'Bank and other accounts kept in another currency, written as rupee accounts', where: MS('ms-account-types'), check: true, unconfirmed: true,
    words: "The ledger is kept in another currency in Tally (for example an EEFC account in dollars). It is written as a rupee account, its opening balance at Tally's rupee value in the opening balance journal, and its receipts and payments in rupees, so its balance in Zoho Books is Tally's rupee balance. Zoho Books then holds no foreign balance for it: to keep one, create the account in that currency in Zoho Books and enter the balance there." },
  foreign_opening_not_written: { title: 'Opening balances in another currency with no foreign amount (in no file)', where: MS('ms-fix-contacts'), check: true, blocking: true,
    words: "The party is kept in another currency, but its opening balance in Tally has only a rupee figure (or two balances at different rates were treated as one), so it cannot be written in the party's currency. The balance is in no file: enter it in Zoho Books by hand, or correct it in Tally." },
  opening_balance_unreadable: { title: 'Opening balances that cannot be read (in no file)', where: MS('ms-fix-contacts'), check: true, blocking: true,
    words: 'The opening balance is not in a form the tool reads (a plain figure, a figure with Dr or Cr, or a foreign amount with its rate and rupee value). It is never taken as zero: it is in no file, and the opening balance journal does not count it. Correct it in Tally and export again.' },
  unreadable_amount: { title: 'Vouchers with an amount that cannot be read (left out)', where: MS('ms-voucher-files'), check: true, blocking: true,
    words: 'A voucher line carries an amount in a form the tool does not read. It is never taken as zero: the voucher is left out of the files and named in the voucher reconciliation. Correct it in Tally and export again.' },
};
export const isAssumption = kind => Object.prototype.hasOwnProperty.call(ASSUMPTIONS, kind);

// ---------- 2. where the opening balance of a chart ledger is written ----------
// A balance written in the Chart of Accounts file is dated by Zoho with the organisation's ONE Opening Balance Date,
// which is the day the organisation was made until a person changes it (three test imports: every such balance landed
// after the whole year). A manual journal carries its own date. So EVERY opening balance of a ledger that is not a
// customer or vendor is written once, in the opening balance journal (OB-1), and the chart row is written WITHOUT it.
// (Zoho also refuses a balance on a Bank row of the chart: "Opening Balance cannot be associated with the given account.")
// The exceptions are in zohorules.json lists.opening_balance_route:
//  - stays_in_chart_types: Accounts Receivable / Accounts Payable (those balances belong to contacts). An account with
//    no type stays too. A Stock account goes into the journal (OB-3, round 2): a stock balance in the chart may lock the
//    Opening Balance Date before it is saved (COA-STOCK-OB-LOCKS-DATE).
//  - the date anchor (chooseDateAnchor): ONE balance stays in the chart when a contacts file carries opening balances.
const OB_ROUTE = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists?.opening_balance_route || {}; } catch { return {}; } })();
export const OPENING_BALANCE_STAYS_IN_CHART_TYPES = Array.isArray(OB_ROUTE.stays_in_chart_types) ? OB_ROUTE.stays_in_chart_types : ['Accounts Receivable', 'Accounts Payable'];
export const BANK_LIKE_TYPES = Array.isArray(OB_ROUTE.bank_like_types) ? OB_ROUTE.bank_like_types : ['Bank', 'Credit Card', 'Cash'];
export const DATE_ANCHOR_TYPE_PREFERENCE = Array.isArray(OB_ROUTE.date_anchor_type_preference) ? OB_ROUTE.date_anchor_type_preference : ['Equity', 'Fixed Asset', 'Other Current Liability'];
// OB-007: the kinds of opening balance journal line proven by our imports (zohorules.json, journal_lines_confirmed)
const OB_PROVEN = OB_ROUTE.journal_lines_confirmed || {};
export const OB_PROVEN_TYPES = Array.isArray(OB_PROVEN.account_types) ? OB_PROVEN.account_types : ['Bank'];
export const OB_PROVEN_ZOHO_ACCOUNTS = Array.isArray(OB_PROVEN.zoho_accounts) ? OB_PROVEN.zoho_accounts : [];
export const openingBalanceViaJournal = accountType => { const t = String(accountType ?? ''); return t !== '' && !OPENING_BALANCE_STAYS_IN_CHART_TYPES.includes(t); };

// The date anchor. Zoho Books dates the opening balances of the Customers and Vendors files with its Opening Balance
// Date, does not save that date while every balance is 0 (confirmed by our import), and does not let it be changed once
// contact balances exist (Zoho's help). So when a contacts file carries a balance, ONE chart balance stays in the Chart
// of Accounts file: the chart import creates the opening balance record, and the person only edits its date before
// the contacts are imported. Nothing is typed, and the balance is not in the journal, so it is never counted twice.
// candidates: [{ id, name, type, balance (Decimal, any sign) }], the chart ledgers with a balance that are written in
// the Chart of Accounts file. Returns the chosen one with mode 'chart'; or, when no ledger can stay in the chart
// (only bank-like accounts have a balance), the smallest bank-like one with mode 'typed' (the one balance a person
// types; it is then left out of the journal); or null when no candidate has a balance.
// The choice is fixed by the data: the first type of the preference list, the smallest balance, then the name.
export function chooseDateAnchor(candidates) {
  const live = (candidates || []).filter(c => c && c.balance && !c.balance.isZero() && c.type);
  const smallest = list => [...list].sort((a, b) => a.balance.abs().comparedTo(b.balance.abs()) || String(a.name).localeCompare(String(b.name)))[0];
  // never a Stock account (COA-STOCK-OB-LOCKS-DATE: a stock balance may lock the date it is meant to set)
  const inChart = live.filter(c => !BANK_LIKE_TYPES.includes(c.type) && !OPENING_BALANCE_STAYS_IN_CHART_TYPES.includes(c.type) && c.type !== 'Stock');
  for (const type of DATE_ANCHOR_TYPE_PREFERENCE) { const list = inChart.filter(c => c.type === type); if (list.length) return { ...smallest(list), mode: 'chart' }; }
  if (inChart.length) return { ...smallest(inChart), mode: 'chart' };
  const bank = live.filter(c => BANK_LIKE_TYPES.includes(c.type));
  return bank.length ? { ...smallest(bank), mode: 'typed' } : null;
}

// ---------- 3. items with no selling rate ----------
// Zoho: "Enter the selling price of the item." The rate written when neither Tally nor the accountant has one.
export const DEFAULT_ITEM_RATE = '0.00';
// The accounts written in the Items file when none is chosen in Mapping Studio (Rates): accounts Zoho Books creates
// itself (docs/ZOHO_IMPORT_RULES.md 9.1). Zoho requires a Purchase Account for an item that can be bought.
export const ZOHO_DEFAULT_SALES_ACCOUNT = 'Sales';
export const ZOHO_DEFAULT_PURCHASE_ACCOUNT = 'Cost of Goods Sold';

// ---------- 1. accounts named like one of Zoho's own ----------
// ledgers: the names of the Chart of Accounts ledgers that are not customers or vendors. explicit: the decisions stored
// ({ ledger: { decision: 'rename' | 'zoho', newName } }). Returns the decisions to use: the stored ones, and for every
// other ledger whose name is the name of one of Zoho's own accounts, { decision: 'zoho', byDefault: true }.
// A decision "leave as it is" stored by an earlier version is no longer a choice: it is read as no decision.
// known: the account names of Zoho's own Chart of Accounts export of the organisation, when the accountant gave it to
// the tool; it is then used instead of the researched list (zohocodes.js), so a ledger is put on a Zoho account only when
// the organisation really has it. zohoName: the Zoho account, spelled as Zoho has it.
export function defaultClashDecisions(ledgers, explicit = {}, known = null, opts = {}) {
  const out = {};
  for (const [ledger, d] of Object.entries(explicit)) if (d?.decision === 'rename' || d?.decision === 'zoho') out[ledger] = d;
  // OB-004: the type of the Tally ledger and the type of Zoho's account must be of the same kind (asset, liability, equity,
  // income, expense: zohorules.json lists.account_types category), and an account the Adjustment of invoices or bills
  // posts to is never taken over by a ledger (the ADJ journals are expected to clear it to zero). Otherwise the ledger
  // keeps an account of its own, renamed so that Zoho accepts it (the Tally name with " (Tally)" added), and the rename
  // is listed as an assumption. opts: { typeOf(name) -> the ledger's Zoho type, categoryOf(type), never: [account] }.
  const categoryOf = opts.categoryOf || (() => null);
  const never = new Set((opts.never || []).filter(Boolean).map(n => accountNameKey(n)));
  for (const name of ledgers) {
    const zohoName = builtinAccount(name, known);
    if (out[name] || !zohoName) continue;
    const ledgerType = opts.typeOf ? opts.typeOf(name) || '' : '';
    const zohoType = builtinAccountType(zohoName) || '';
    const ca = categoryOf(ledgerType), cb = categoryOf(zohoType);
    const adjustment = never.has(accountNameKey(zohoName));
    if (adjustment || (ca && cb && ca !== cb)) {
      out[name] = { decision: 'rename', newName: suggestedRename(name), by: null, at: null, byDefault: true, zohoName, ledgerType, zohoType,
        why: adjustment ? 'adjustment_account' : 'type_differs' };
      continue;
    }
    out[name] = { decision: 'zoho', newName: '', by: null, at: null, byDefault: true, zohoName };
  }
  return out;
}
// The name suggested when such a ledger is renamed instead.
export const suggestedRename = name => `${String(name ?? '').replace(/[\u0000-\u001f\u007f​﻿]+/g, ' ').replace(/\s+/g, ' ').trim()} (Tally)`;

// ---------- 7. names ----------
// Pick and drop: a name is written exactly as in Tally unless it breaks a rule of Zoho's import. Then it is cleaned by
// default (the same cleaned name in every file), and flagged.
// TODO(zoho-rules): the exact rules are being confirmed. Until then the only rule is: a control character that is not
// a line break or a tab (it cannot be typed in Zoho Books and is not safe in a CSV cell). A line break, a tab or a space
// at the ends is NOT a failure here: those names stay as in Tally, and "Clean all" cleans them in one click.
export function nameFailsZohoRule(name) {
  const s = String(name ?? '');
  if (/[\u0000-\u0003\u0005-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return 'it has a control character that Zoho Books cannot hold';
  return null;
}

// ---------- 6. two contacts with the same name ----------
// records: [{ section: 'customers' | 'vendors', name, gstin (as written, '' when none or not valid) }] in file order.
// written(name): the name the ledger is written with by the decisions stored (a cleaned or new name), before any merge.
// decided: the ledgers that belong to a group of possible duplicates a person decided, or that a person merged.
// Two or more contacts of ONE file whose written names are the same once line breaks, spaces around the name and
// capital letters are ignored are one party by default: Zoho rejects the second row ("Duplicate row found in your
// CSV/TSV file"). The contact kept is the first whose name needs no cleaning, else the first in the file. Contacts
// with two different valid GSTINs are NOT merged (they may be two registrations): they stay flagged.
// Returns [{ section, kept, merged: [name] }].
export function defaultMerges(records, written = n => n, decided = new Set()) {
  const out = [];
  for (const section of ['customers', 'vendors']) {
    const clusters = new Map();
    for (const r of records.filter(x => x.section === section)) {
      const k = nameKey(written(r.name));
      if (!k) continue;
      if (!clusters.has(k)) clusters.set(k, []);
      if (!clusters.get(k).some(x => x.name === r.name)) clusters.get(k).push(r);
    }
    for (const members of clusters.values()) {
      if (members.length < 2 || members.some(m => decided.has(m.name))) continue;
      const gstins = new Set(members.map(m => m.gstin).filter(g => g && GSTIN_FORMAT.test(g)));
      if (gstins.size > 1) continue;
      const clean = n => n === String(n).trim() && !/[\u0000-\u001f\u007f​﻿]/.test(n);
      const kept = members.find(m => clean(m.name)) || members[0];
      out.push({ section, kept: kept.name, merged: members.filter(m => m !== kept).map(m => m.name) });
    }
  }
  return out;
}

// ---------- 8. journal routing ----------
// A journal that pays back an expense to a party (for example travel paid by an employee) is not a purchase bill.
// lines: [{ ledger, kind, debit: bool }], narration: the voucher's narration.
// TODO(reviewer): the reviewer named "expense reimbursed to a party, e.g. travel". Tally has no field that says a
// journal is a reimbursement, so this reads the words: "reimburse..." in the narration or in a ledger name; or every
// expense ledger debited is a travel or conveyance ledger and no tax ledger is on the voucher.
const REIMBURSE = /reimburs|reimb\b/i;
const TRAVEL = /\b(travel|travelling|traveling|conveyance|lodging|boarding)\b/i;
export function isReimbursementJournal(lines, narration = '') {
  if (REIMBURSE.test(String(narration ?? '')) || lines.some(l => REIMBURSE.test(l.ledger))) return true;
  const expenses = lines.filter(l => l.debit && l.kind === 'expense');
  return expenses.length > 0 && expenses.every(l => TRAVEL.test(l.ledger)) && !lines.some(l => l.kind === 'tax');
}
// The routing used for a journal with no decision. suggestion: { suggested, clear, needsCheck } (suggestJournal).
// usable(decision): false when the journal cannot be written that way (the party is on the wrong side, is not in the
// masters, ...). Returns { decision, kind }: kind is the assumption kind raised for it.
//  - a clear suggestion with no warning -> that suggestion (the same group "Accept the clear suggestions" approves);
//  - a reimbursement -> Manual Journal;
//  - anything else (no clear pattern, or a Bill or Invoice that would carry a negative row) -> Manual Journal, which
//    posts exactly what Tally posted. A journal is never left out for want of a decision.
export function defaultJournalRoute(suggestion, { reimbursement = false, usable = () => true } = {}) {
  if (reimbursement && suggestion?.suggested !== 'Manual Journal') return { decision: 'Manual Journal', kind: 'journal_default_reimbursement' };
  if (suggestion?.clear && !suggestion.needsCheck && usable(suggestion.suggested)) return { decision: suggestion.suggested, kind: 'journal_default_suggestion' };
  return { decision: 'Manual Journal', kind: 'journal_default_manual' };
}

// ---------- 11. HSN/SAC ----------
// A new Zoho Books (India) organisation has "Enable the HSN Code or SAC field" ON. Zoho then refuses an invoice line
// with an empty HSN/SAC or one shorter than 6 digits ("Please ensure that the length of the HSN code is a minimum of 6
// digits and it has only numbers."; test 2). GST codes have 4, 6 or 8 digits. The organisation answers whether the field
// is on (voucher setting hsnEnabled, default on) and the shortest code it takes (hsnMinDigits, default 6).
export const hsnAccepted = (value, minDigits = 4) => /^(\d{4}|\d{6}|\d{8})$/.test(String(value ?? '')) && String(value).length >= minDigits;
// The value written for an HSN/SAC value read from Tally. corrections: { old value: new value } (per migration).
// Returns { value, status: 'empty' | 'ok' | 'corrected' | 'not_written', from }.
export function hsnForZoho(raw, corrections = {}, minDigits = 4) {
  const from = String(raw ?? '').trim();
  if (!from) return { value: '', status: 'empty', from };
  if (Object.prototype.hasOwnProperty.call(corrections, from)) {
    const to = String(corrections[from] ?? '').trim();
    return to === '' ? { value: '', status: 'corrected', from } : hsnAccepted(to, minDigits) ? { value: to, status: 'corrected', from } : { value: '', status: 'not_written', from };
  }
  return hsnAccepted(from, minDigits) ? { value: from, status: 'ok', from } : { value: '', status: 'not_written', from };
}
const HSN_RULES_TABLE = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists?.sac_suggestions || null; } catch { return null; } })();
// A SAC code suggested from the words of an account or item name (zohorules.json lists.sac_suggestions). Only a
// suggestion: the caller writes it and flags it for confirmation, it is never silent. A keyword matches whole words only
// ("class" matches "classes" but not "classic"): a plural ending s/es is allowed, a keyword ending in "*" is a word start
// ("advertis*" matches "advertising"), a keyword of several words is a phrase. Every entry is scored by the number of its
// keywords found (the longest keyword breaks a tie); the best wins. Two codes with the same score: the first listed is
// returned with ambiguous naming the other. prefix: only codes that start with it (Tally's shorter heading).
// Returns { code, label, ambiguous?: [{ code, label }] } or null.
const escapeRe = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordRe = k => { const stem = k.endsWith('*'); const w = escapeRe(stem ? k.slice(0, -1) : k).replace(/ +/g, '\\s+'); return new RegExp(`(^|[^a-z0-9])${w}${stem ? '' : '(?:es|s)?(?=$|[^a-z0-9])'}`); };
export function sacSuggestion(name, table = HSN_RULES_TABLE, prefix = '') {
  const s = String(name ?? '').toLowerCase().replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const scored = [];
  for (const [i, e] of (table?.entries || []).entries()) {
    if (prefix && !String(e.code).startsWith(prefix)) continue;
    const hits = e.keywords.filter(k => keywordRe(String(k).toLowerCase()).test(s));
    if (hits.length) scored.push({ e, i, n: hits.length, len: Math.max(...hits.map(k => k.replace('*', '').length)) });
  }
  if (!scored.length) return null;
  scored.sort((x, y) => y.n - x.n || y.len - x.len || x.i - y.i);
  const best = scored[0], tied = scored.filter(x => x !== best && x.n === best.n && x.len === best.len && x.e.code !== best.e.code);
  return { code: best.e.code, label: best.e.label, ...(tied.length ? { ambiguous: tied.map(x => ({ code: x.e.code, label: x.e.label })) } : {}) };
}
// The HSN/SAC of one line, with where it comes from. line: { raw, account, item }; org: { enabled, minDigits,
// corrections, defaults: { account: { name: code }, item: { name: code } } }.
// Order: Tally's value (after the corrections), the code chosen for the item, the code chosen for the account, the
// suggestion from the words of the item or account (a suggestion: flagged), else nothing.
// When Tally has a value of digits shorter than Zoho takes (a heading, for example a 5-digit SAC group), it is the
// prefix of the code: a chosen code is used as it is, a suggestion is taken from under that heading first
// (source 'heading'); only when none lies under it is the suggestion from the words written (source 'suggested',
// outsideHeading true), so the cell is never empty while the field is on.
// source: 'tally' | 'corrected' | 'chosen_item' | 'chosen_account' | 'heading' | 'suggested' | 'off' | 'missing'.
// When the field is off in Zoho the cell is written empty and nothing is flagged.
export function resolveHsn(line, org = {}) {
  const minDigits = org.minDigits || 4;
  const base = hsnForZoho(line.raw, org.corrections || {}, minDigits);
  if (org.enabled === false) return { value: '', source: 'off', status: base.status, from: base.from };
  if (base.value) return { value: base.value, source: base.status === 'corrected' ? 'corrected' : 'tally', status: base.status, from: base.from };
  const pick = (kind, name) => { const m = org.defaults?.[kind]; if (!m || name == null) return ''; const k = String(name).trim(); return Object.prototype.hasOwnProperty.call(m, k) && hsnAccepted(m[k], minDigits) ? m[k] : ''; };
  const item = pick('item', line.item); if (item) return { value: item, source: 'chosen_item', status: base.status, from: base.from };
  const account = pick('account', line.account); if (account) return { value: account, source: 'chosen_account', status: base.status, from: base.from };
  // a correction that says "write empty" is the accountant's decision: nothing is invented over it
  if (base.status === 'corrected') return { value: '', source: 'missing', status: base.status, from: base.from };
  const table = org.sacTable === undefined ? HSN_RULES_TABLE : org.sacTable;
  const words = [line.item, line.account].filter(Boolean).join(' ');
  const heading = base.status === 'not_written' && /^\d+$/.test(base.from) && base.from.length < Math.max(minDigits, 6) ? base.from : '';
  if (heading) {
    const h = sacSuggestion(words, table, heading);
    if (h && hsnAccepted(h.code, minDigits)) return { value: h.code, source: 'heading', status: base.status, from: base.from, suggestion: h };
  }
  // headingOnly (stock items): a code is suggested only under a heading Tally itself has, never from the words alone
  // and never a service code (99..) outside a goods heading Tally has (GST-014)
  const s = org.headingOnly || (heading && !heading.startsWith('99')) ? null : sacSuggestion(words, table);
  if (s && hsnAccepted(s.code, minDigits)) return { value: s.code, source: 'suggested', status: base.status, from: base.from, suggestion: s, ...(heading ? { outsideHeading: true } : {}) };
  return { value: '', source: 'missing', status: base.status, from: base.from };
}

// ---------- 12. a bill line of a registered vendor with no GST ----------
// Zoho: "Specify either a Tax or Tax Exemption or Reverse Charge." for every bill line of a vendor written as
// registered that carries no tax.
// docs/ZOHO_IMPORT_RULES.md (3.5, rule BIL-TAX-REQUIRED-REGISTERED) gives three things Zoho takes. The setting
// billNoTaxMode of the migration (voucher settings) says which one is written; NONE IS CONFIRMED BY AN IMPORT YET:
//  - 'zero_tax' (the default): Zoho's zero-rate tax. GST0 with Tax Type "Tax Group" when the vendor's state (Source of
//    Supply) is the company's (Destination of Supply), IGST0 with "ItemAmount" otherwise; Tax Percentage 0.
//  - 'exemption': Item Exemption Code = billExemptionCode, the NAME of a tax exemption that exists in the Zoho
//    organisation (Settings > Taxes > Tax Exemptions). Nothing can be invented here.
//  - 'reverse_charge': Reverse Charge Tax Name, Rate and Type from billReverseChargeName / Rate / Type.
// This is only ever applied to a vendor written as registered: an exemption on a bill of an unregistered vendor
// (business_none) is refused by Zoho, and such a bill needs nothing.
// When the chosen way cannot be written (a state is missing, or the exemption or reverse charge tax is not filled in)
// the cells stay empty and the kind is the BLOCKING flag, so such rows are never exported unnoticed.
// Returns { cells: { heading: value }, kind, why? } where kind is the flagged item to raise.
export const BILL_NO_TAX_MODES = ['zero_tax', 'exemption', 'reverse_charge'];
export const ZERO_RATE_TAX = { intra: { name: 'GST0', type: 'Tax Group' }, inter: { name: 'IGST0', type: 'ItemAmount' } };
export const TAX_TYPES = ['Tax Group', 'ItemAmount'];
export function billLineWithoutTax(settings = {}, { source = '', destination = '', interState = false } = {}) {
  const blocked = why => ({ cells: {}, kind: 'bill_line_needs_tax_or_exemption', why });
  const mode = BILL_NO_TAX_MODES.includes(settings.billNoTaxMode) ? settings.billNoTaxMode : 'zero_tax';
  if (mode === 'exemption') {
    const code = String(settings.billExemptionCode ?? '').trim();
    return code ? { cells: { 'Item Exemption Code': code }, kind: 'bill_line_exemption' } : blocked('"exemption" is chosen for lines without GST, but no exemption name is entered');
  }
  if (mode === 'reverse_charge') {
    const name = String(settings.billReverseChargeName ?? '').trim(), rate = String(settings.billReverseChargeRate ?? '').trim(), type = String(settings.billReverseChargeType ?? '').trim();
    return name && rate && TAX_TYPES.includes(type)
      ? { cells: { 'Reverse Charge Tax Name': name, 'Reverse Charge Tax Rate': rate, 'Reverse Charge Tax Type': type }, kind: 'bill_line_reverse_charge' }
      : blocked('"reverse charge" is chosen for lines without GST, but its tax name, rate and type are not all entered');
  }
  // an SEZ or overseas vendor: a supply between states whatever the two states say (GST-008): IGST0, never GST0
  if (interState) return { cells: { 'Tax Name': ZERO_RATE_TAX.inter.name, 'Tax Percentage': '0', 'Tax Amount': '0.00', 'Tax Type': ZERO_RATE_TAX.inter.type }, kind: 'bill_line_zero_tax' };
  if (!source || !destination) return blocked(`the ${!source ? "vendor's state (Source of Supply)" : "company's state (Destination of Supply)"} is not known, so GST0 cannot be told from IGST0`);
  const z = source === destination ? ZERO_RATE_TAX.intra : ZERO_RATE_TAX.inter;
  return { cells: { 'Tax Name': z.name, 'Tax Percentage': '0', 'Tax Amount': '0.00', 'Tax Type': z.type }, kind: 'bill_line_zero_tax' };
}

// ---------- 13. tax names when no Zoho tax is chosen for the Tally tax ledgers ----------
// Zoho Books (India) creates GST0, GST5, GST12, GST18, GST28 (tax groups of CGST and SGST) and IGST0 ... IGST28 itself
// (docs/ZOHO_IMPORT_RULES.md 9.2). When NONE of the tax ledgers of a line is mapped in Mapping Studio, the line is
// written with Zoho's own tax of the line's rate; any mapping made there wins. heads: the GST duty heads of the tax
// ledgers of the line (CGST, SGST, IGST); rate: the total rate of the line (a Decimal or a number).
// Returns the tax name, or null when Zoho has no tax of its own for it (another rate, a cess, a mix of heads).
export const ZOHO_OWN_GST_RATES = ['0', '5', '12', '18', '28'];
// GST-011: a rate Zoho does not create by itself (3, 1.5, 0.25, 40 ...) gets the same kind of name (GST3, IGST40) only
// when that name is in the saved list of the organisation's taxes (savedNames), that is the accountant created it there.
export function defaultZohoTaxName(heads, rate, savedNames = null) {
  const r = String(rate ?? '');
  const own = ZOHO_OWN_GST_RATES.includes(r);
  if (!own && !(savedNames?.length && /^\d+(\.\d+)?$/.test(r))) return null;
  const set = new Set(heads);
  const name = set.size === 1 && set.has('IGST') && heads.length === 1 ? `IGST${r}` : set.size === 2 && set.has('CGST') && set.has('SGST') && heads.length === 2 ? `GST${r}` : null;
  if (!name || own) return name;
  return savedNames.some(n => String(n).trim().toLowerCase() === name.toLowerCase()) ? name : null;
}
// The Zoho tax name a GST line of this rate needs but Zoho Books does not create by itself (GSTnn for CGST + SGST,
// IGSTnn for IGST), or null when Zoho has it or the heads are not one of those two sets.
export function zohoTaxToCreate(heads, rate) {
  const r = String(rate ?? '');
  if (ZOHO_OWN_GST_RATES.includes(r) || !/^\d+(\.\d+)?$/.test(r)) return null;
  const set = new Set(heads);
  return set.size === 1 && set.has('IGST') && heads.length === 1 ? `IGST${r}` : set.size === 2 && set.has('CGST') && set.has('SGST') && heads.length === 2 ? `GST${r}` : null;
}

// ---------- 14. TDS: the Zoho TDS tax suggested for a Tally TDS ledger ----------
// Zoho does not publish the names of the TDS taxes a new organisation has (docs/ZOHO_IMPORT_RULES.md 9.2). The pick
// list is what is known: the names in Zoho's sample files (Dividend, Commission or Brokerage, Professional Fees) and the
// descriptions of the TDS section codes Zoho documents (zohorules.json lists.tds). A Tally TDS ledger is matched by the
// section of its nature of payment (Tally's tdsratename, else a section number in the ledger's name, for example
// "194J"). The suggestion is written in the files when nothing is chosen (tds_name_default, unconfirmed until the
// next test import). tds.js then adds the percentage and the section code of every TDS row (Zoho refuses a row without).
const RULES_LISTS = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists; } catch { return {}; } })();
const RULES_TDS = RULES_LISTS.tds || null;
// Zoho's own GST taxes (zohorules.json lists.default_taxes): the dropdown of Tax mapping, never typed.
export const ZOHO_DEFAULT_TAXES = {
  gst: (RULES_LISTS.default_taxes?.intra_state_tax_groups || []).map(t => ({ name: t.name, rate: t.rate })),
  igst: (RULES_LISTS.default_taxes?.inter_state_taxes || []).map(t => ({ name: t.name, rate: t.rate })),
};
// old section (Income Tax Act, 1961) -> the code of Zoho's list
const SECTION_CODES = {
  193: 'interest_on_securities', 194: 'dividend', '194A': 'income_other_interest_on_securities', '194B': 'lotteries_winnings', '194BA': 'winnings_online_games',
  '194BB': 'winnings_horse_races', '194C': 'contract_payments_other_individual_or_huf', '194D': 'insurance_commission', '194DA': 'lic_maturity_proceeds',
  '194E': 'payment_non_resident_sportsmen_or_sports_association', '194EE': 'deposits_in_nss', '194G': 'commission_prize_lottery', '194H': 'commission_or_brokerage',
  '194I': 'rent_land_furniture', '194IA': 'immovable_property_sale', '194IB': 'rent_individual_or_huf', '194IC': 'specified_agreement_payment',
  '194J': 'professional_fees', '194JA': 'technical_services', '194JB': 'professional_fees', '194K': 'income_from_mutual_fund', '194LA': 'compensation_on_acquisition',
  '194M': 'payment_contractors_and_professionals', '194N': 'payment_cooperative_society', '194O': 'ecommerce_participant', '194P': 'tax_deduction_specified_senior_citizen',
  '194Q': 'purchase_of_goods', '194R': 'benefit_or_perquisite', '194S': 'virtual_asset_other_individual_or_huf', '194T': 'payment_to_partners',
  // TDS-008: salary, provident fund, business trusts, investment funds, foreign currency bonds and non-residents
  192: 'payment_to_non_govt_employee', '192A': 'accumulated_balance_payment', '194LBA': 'interest_business_unit', '194LBB': 'income_from_investment_fund',
  '194LBC': 'income_from_securitization_trust', '194LC': 'interset_on_foreign_currency', 195: 'other_sums_payable_non_resident',
  '196A': 'income_respect_of_units_mutual_funds', '196B': 'income_respect_of_units_section_208', '196C': 'income_interset_dividend_section_209',
  '196D': 'income_securities_section_210_foreign_investor',
};
// Codes of Zoho's new-act list that are a second code of one old section (the section SECTION_CODES gives another code
// for): the old section a tax with this code is written with on a document before the cutover (TDS-001, TDS-008).
// Evidence: assumed, from the sections of the Income Tax Act, 1961 the descriptions of Zoho's codes name.
const EXTRA_CODE_SECTIONS = {
  rent_plant_machinery: '194I', contract_payments_individual_or_huf: '194C', technical_services: '194JA', director_remuneration: '194J',
  benefit_or_perquisite_not_wholly: '194R', virtual_asset_non_audit_individual_or_huf: '194S', virtua_asset_not_wholly: '194S',
  dividend_business_unit: '194LBA', rental_income_unit_holder: '194LBA', income_other_interest_on_securities_senior_citizen: '194A',
  income_other_interest_on_securities_specified_person: '194A', lotteries_winnings_not_wholly: '194B', winnings_online_games_not_wholly: '194BA',
  payment_other_cooperative_society: '194N', payment_to_non_union_employee: '192', payment_to_indian_govt_employee: '192',
  interest_on_rupees_denominated_bonds: '194LC', interest_on_listed_bonds_before_june: '194LC', interest_on_listed_bonds_after_june: '194LC',
  income_transfer_of_units_section_208: '196B', income_long_term_capital_gains_section_209: '196C', income_securities_section_210_specified_fund: '196D',
  income_respect_of_units_investment_funds: '194LBB', income_respect_of_investment_securitisation_trust: '194LBC',
};
// THE old-act sections of a new-act code (the first is the one written), and the code of an old section.
export const tdsSectionsOfCode = code => [...Object.entries(SECTION_CODES).filter(([, c]) => c === code).map(([s]) => String(s)), ...(EXTRA_CODE_SECTIONS[code] ? [EXTRA_CODE_SECTIONS[code]] : [])]
  .filter((x, i, a) => a.indexOf(x) === i);
export const tdsCodeOfSection = section => SECTION_CODES[section] || null;
// every code of Zoho's new-act list (zohorules.json), lower case
export const TDS_NEW_CODES = new Set((RULES_TDS?.section_codes_income_tax_act_2025?.codes || []).map(c => String(c.code).toLowerCase()));
// The names in Zoho's sample files, spelled as there.
const SAMPLE_TDS_NAMES = Object.fromEntries((RULES_TDS?.default_names_seen_in_samples || []).map(s => [s.name.toLowerCase(), s]));
// The pick list: [{ name, code, sections }], sample names first.
export const TDS_CHOICES = (() => {
  const codes = RULES_TDS?.section_codes_income_tax_act_2025?.codes || [];
  const sectionsOf = code => tdsSectionsOfCode(code);
  const out = [], seen = new Set();
  const add = (name, code) => { const k = name.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push({ name, code, sections: code ? sectionsOf(code) : [] }); };
  for (const s of RULES_TDS?.default_names_seen_in_samples || []) add(s.name, codes.find(c => c.description.toLowerCase() === s.name.toLowerCase())?.code || null);
  for (const c of codes) add(SAMPLE_TDS_NAMES[c.description.toLowerCase()]?.name || c.description, c.code);
  return out;
})();
export const isTdsChoice = name => TDS_CHOICES.some(c => c.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
// The section number in a text ("194J", "194 JB", "Sec 194C", "Sec 194-J", "u/s 194(C)", "194.I", "194LBA", "195"), or ''.
// TDS-007: a separator between the number and its letters is allowed. The bare number (194: dividend, 192, 195) is read
// only when no letters follow it, or a whole word follows after a space ("194 Contractors"); letters after a separator
// that are no section ("194-XY") give '', so a person decides instead of the tool guessing dividend.
export function tdsSectionOf(text) {
  const t = String(text ?? '').toUpperCase().replace(/[\u0000-\u001f]/g, ' ');
  const re = /(?:^|[^0-9A-Z])(19[2-6])(?![0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    const rest = t.slice(m.index + m[0].length);
    const lm = /^(\s*)([-./(]?)\s*([A-Z]+)(\)?)/.exec(rest);
    if (!lm) { if (SECTION_CODES[m[1]]) return m[1]; continue; }
    const letters = lm[3];
    if (letters.length <= 3 && SECTION_CODES[`${m[1]}${letters}`]) return `${m[1]}${letters}`;
    // letters glued to the number or after a separator that are no section: not the bare number
    if (lm[2] || !lm[1]) return '';
    // a word after a space ("194 Contractors"): the bare number, when it is a section
    if (SECTION_CODES[m[1]]) return m[1];
  }
  return '';
}
// info: taxLedgerInfo of the ledger (nature, rate); ledger: its name. Returns { tdsName, section, percent, why } or null.
// TDS deducted by a CUSTOMER on a ledger whose section Tally does not give (often a ledger named "TDS Receivable"):
// the invoice still carries it in its TDS columns (never as a negative line), with the TDS tax a customer most often
// deducts from a supplier of services, Professional Fees (section 194J). Flagged (tds_name_default); the accountant can
// choose another in Mapping Studio (TDS mapping). The amount is always Tally's.
export const CUSTOMER_TDS_DEFAULT = (() => {
  const c = TDS_CHOICES.find(x => x.sections.includes('194J')) || { name: 'Professional Fees' };
  return { tdsName: c.name, section: '', percent: '', why: 'Tally gives no section for this ledger; the default for tax deducted by a customer from a supplier of services is section 194J' };
})();
// The section a plain-words nature of payment stands for ("Fees for Professional Services", "Rent of Land, Building or
// Furniture"), from the table lists.tds.nature_words. Only the nature of payment is read, never a ledger name. '' when no
// entry fits. Always an assumption: tdsSuggestion says so in its text.
export function tdsSectionFromWords(text) {
  // letters and digits only, one space between words: a term matches from the start of a word ("contract" fits "contractors")
  const norm = s => ' ' + String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = norm(text) + ' ';
  if (!t.trim()) return '';
  const has = w => t.includes(norm(w));
  for (const e of RULES_TDS?.nature_words || []) {
    if (e.none && e.none.some(has)) continue;
    if ((e.all && e.all.every(has)) || (e.any && e.any.some(has))) return SECTION_CODES[e.section] || EXTRA_CODE_SECTIONS[TDS_CHOICES.find(c => c.sections.includes(e.section))?.code] ? e.section : '';
  }
  return '';
}
export function tdsSuggestion(info, ledger = '') {
  let fromNature = tdsSectionOf(info?.nature), fromWords = false;
  if (!fromNature) { fromNature = tdsSectionFromWords(info?.nature); fromWords = !!fromNature; }
  const fromName = fromNature ? '' : tdsSectionOf(ledger);
  const section = fromNature || fromName;
  if (!section) return null;
  const choice = TDS_CHOICES.find(c => c.code === SECTION_CODES[section]) || TDS_CHOICES.find(c => c.sections.includes(section));
  if (!choice) return null;
  return { tdsName: choice.name, section, percent: info?.rate ? String(info.rate) : '',
    why: `Section ${section} ${fromWords ? "assumed from the words of the ledger's nature of payment in Tally (please confirm it)" : fromNature ? "from the ledger's nature of payment in Tally" : "from the ledger's name"}` };
}

// ---------- 15. invoices: Item Name, round-off, lines without GST ----------
// Zoho's invoice sample marks Item Name as mandatory (INV-ITEM-NAME-REQUIRED). A stock item line carries its Tally item;
// every other line carries a SERVICE ITEM named after its account, which is added to the Items file (Rate 0.00, Item
// Type "Sales", Product Type "service", Account = that account), so the name exists in Zoho before the invoices.
// The name is the account name as written, without line breaks or hidden characters, at most 100 characters (Zoho's
// limit for an item name); when a stock item already has that name, " (service)" is added.
export const ITEM_NAME_MAX = 100;
export function serviceItemName(account, taken = new Set()) {
  let base = String(account ?? '').replace(/[\u0000-\u001f\u007f ​﻿]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Account line';
  if (base.length > ITEM_NAME_MAX) base = base.slice(0, ITEM_NAME_MAX).trim();
  if (!taken.has(base.toLowerCase())) return base;
  const tail = ' (service)';
  return `${base.slice(0, ITEM_NAME_MAX - tail.length).trim()}${tail}`;
}
// A round-off ledger: Tally's "Type of ledger: Invoice Rounding" (roundingmethod set to a method, not Tally's "Not
// Applicable" marker). Its line goes to Zoho's Adjustment column instead of a line of its own.
export function isRoundOffLedger(d) {
  const m = String(d?.roundingmethod ?? '').replace(/[\u0000-\u001f]/g, '').trim();
  return !!m && !/not applicable/i.test(m);
}
export const ROUND_OFF_DESCRIPTION = 'Round Off';
// An invoice line with no GST in Tally: Zoho asks every invoice line for a tax, an exemption or a non-GST supply type
// (INV-TAX-OR-EXEMPTION). Zoho's zero-rate tax is written: GST0 when the place of supply is the company's state, IGST0
// otherwise (the bill rule, billLineWithoutTax). An export (overseas customer, no place of supply) is a supply outside
// the state: IGST0 (Zoho: "Other state or export: IGST"). Nothing when a state of a supply in India is unknown.
// A supply to an SEZ is between states even when the SEZ is in the company's own state (IGST Act s.7(5)(b)): IGST0 too,
// never GST0 (GST-008).
export function invoiceLineWithoutTax({ from = '', to = '', overseas = false, sez = false } = {}) {
  if (overseas || sez) return { 'Item Tax': ZERO_RATE_TAX.inter.name, 'Item Tax Type': ZERO_RATE_TAX.inter.type, 'Item Tax %': '0' };
  if (!from || !to) return null;
  const z = from === to ? ZERO_RATE_TAX.intra : ZERO_RATE_TAX.inter;
  return { 'Item Tax': z.name, 'Item Tax Type': z.type, 'Item Tax %': '0' };
}

// ---------- the assumptions of a migration, from the flagged items of a (dry) run ----------
// flags: [{ kind, slot, sourceId, uses }]. Returns one entry per kind met, in the order of ASSUMPTIONS.
export function summariseAssumptions(flags, examples = 5) {
  const by = new Map();
  for (const f of flags) {
    if (!isAssumption(f.kind)) continue;
    if (!by.has(f.kind)) by.set(f.kind, { count: 0, examples: [] });
    const g = by.get(f.kind);
    g.count += f.uses != null && f.sourceId == null ? Number(f.uses) || 0 : 1;
    if (f.sourceId != null && g.examples.length < examples) g.examples.push({ dataset: f.slot ?? null, id: f.sourceId });
  }
  return Object.entries(ASSUMPTIONS).filter(([kind]) => by.has(kind)).map(([kind, a]) => ({
    // unconfirmed: the value written is the best reading of Zoho's rules, not yet proved by a test import
    kind, title: a.title, words: a.words, count: by.get(kind).count, check: !!a.check, blocking: !!a.blocking, unconfirmed: !!a.unconfirmed, where: a.where || null, examples: by.get(kind).examples }));
}
