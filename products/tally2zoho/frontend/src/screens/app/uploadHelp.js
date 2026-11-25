// Help text shown when the user points at the "!" icon on an Upload Center card.
// "checks" lists only what the server really checks when the file is uploaded or processed.
// The Tally export steps are general guidance: menu names can differ between Tally versions,
// so the guide tells the user to follow their own Tally version's export option.

export const COMMON_STEPS = [
  'Open the report named below in TallyPrime.',
  'Set the period to the same financial year as this migration.',
  'Choose Export (Ctrl+E) and pick JSON as the format.',
  'Save the file, then choose it here.',
];

// Confirmed on TallyPrime 7.1: how to export every master in one file.
export const ALL_MASTERS_STEPS = [
  'In TallyPrime, open the company and go to Gateway of Tally > E: Export > Masters.',
  'Set Type of Masters to All Masters.',
  'Set File Format to JSON (Data Exchange).',
  'Set Export closing balance as opening to No.',
  'Export, then choose the saved file here.',
];

// Confirmed on TallyPrime 7.1: how to export every voucher of the year in one file.
export const ALL_TRANSACTIONS_STEPS = [
  'In TallyPrime, open the company and go to Gateway of Tally > E: Export > Transactions.',
  'Set the Period to the whole financial year of this migration, from its first day to its last. Tally offers only the last month by default, so change it.',
  'Set File Format to JSON (Data Exchange).',
  'Export, then choose the saved file here.',
];

// Confirmed on TallyPrime 7.1: how to export the Trial Balance with every ledger listed.
export const TRIAL_BALANCE_STEPS = [
  'In TallyPrime, go to Gateway of Tally > Display More Reports > Trial Balance.',
  'Set the period to the full financial year of this migration.',
  'Press Alt+F5 for the detailed view, so that every ledger is listed under its group.',
  'Press Alt+E and choose Current.',
  'Turn on Show Opening Balance, Show Transactions and Show Closing Balance.',
  'Set File Format to JSON (Data Exchange).',
  'Export, then choose the saved file in the Trial Balance slot.',
];

// The "!" help of the "All transactions in one file" card.
export const ALL_TRANSACTIONS_HELP = {
  contains: 'Every voucher of the financial year in one file, with all voucher types mixed: sales, purchases, receipts, payments, journals, contra entries, debit and credit notes, and any voucher types of your own.',
  split: [
    'Each voucher goes to the dataset of its voucher type: Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Notes or Credit Notes.',
    'A voucher type of your own, for example "Sales - Export", is followed up to the Tally voucher type it was created under. For this the platform uses the voucher type list in your All Masters file, so upload that file as well. If you upload it later, the vouchers are sorted again for you.',
    'A voucher type that cannot be traced to one of Tally\'s own types is not guessed. Its vouchers are kept under Other Voucher Types and flagged.',
    'Other Tally voucher types, such as orders, delivery notes, stock journals and payroll, are also kept under Other Voucher Types.',
  ],
  checks: [
    'The file is read whether Tally saved it as UTF-16 (TallyPrime 7.1 does) or as UTF-8.',
    'Each part is then checked exactly like a file uploaded into its own slot: voucher dates against the financial year, the fields the platform needs, and fields not transferred.',
    'A voucher type with no vouchers in the file, for example Purchase when purchases are entered as journals, is marked not applicable for you, with the reason. The file holds every voucher of the year, so it shows there are none. You can undo that in Completeness Check.',
    'Cancelled, optional and deleted vouchers are kept and counted, but they are never written to a Zoho file.',
    'Receipt, Payment and Contra vouchers, Debit Notes and Credit Notes are written as Manual Journals (the journals file of receipts, payments and contra), with the customer or vendor named. Other voucher types are read and kept; no Zoho file is created for them yet.',
  ],
  replace: 'The file you upload last wins for each dataset. This file replaces any voucher dataset you uploaded on its own before. A file you upload into a single slot later replaces only that dataset, and the card says so.',
  tip: 'Check the period before you export. If the file covers only one month, the Trial Balance check will show differences for most ledgers.',
};

// The "!" help of the "All masters in one file" card.
export const ALL_MASTERS_HELP = {
  contains: 'Every master in your company in one file: groups, ledgers, stock items and units, and also lists the platform does not use, such as currencies and godowns. The list of voucher types is used to sort vouchers of your own voucher types.',
  split: [
    'Customer Master: every ledger under Sundry Debtors, including ledgers in your own sub-groups of Sundry Debtors.',
    'Vendor Master: every ledger under Sundry Creditors, including your own sub-groups.',
    'Tax Configuration: every ledger under Duties & Taxes, including your own sub-groups.',
    'Chart of Accounts: every ledger (the customers, vendors and tax ledgers too, as in a List of Ledgers for all groups) and every group, so that your own sub-groups get the account type of the group above them.',
    'Stock Items: every stock item. Units of Measurement: every unit.',
  ],
  checks: [
    'The file is read whether Tally saved it as UTF-16 (TallyPrime 7.1 does) or as UTF-8.',
    'Each part is then checked exactly like a file uploaded into its own slot: record counts, the fields the platform needs, and fields not transferred.',
    'Records the platform does not use, such as currencies, godowns and income tax lists, are counted and kept for reference. They are not an error.',
    'If the file has no units, Units of Measurement is marked not applicable for you, with the reason. You can undo that in Completeness Check.',
  ],
  replace: 'The file you upload last wins for each dataset. This file replaces any dataset you uploaded on its own before. A file you upload into a single slot later replaces only that dataset, and the card says so.',
  tip: 'Vouchers and the Trial Balance are not in this file. Upload the vouchers with "All transactions in one file", and the Trial Balance into its own slot.',
};

export const UPLOAD_HELP = {
  customers: {
    contains: 'Your customers: every ledger under the group Sundry Debtors, with GSTIN, address and opening balance.',
    checks: ['The file must contain ledger records only.', 'You get a warning if some ledgers are not directly under Sundry Debtors.'],
    tip: 'Customers who are in a sub-group of Sundry Debtors may trigger the warning. Check they are meant to be here. With the "All masters in one file" option, sub-groups are followed for you and give no warning.',
  },
  vendors: {
    contains: 'Your vendors: every ledger under the group Sundry Creditors, with GSTIN, address and opening balance.',
    checks: ['The file must contain ledger records only.', 'You get a warning if some ledgers are not directly under Sundry Creditors.'],
    tip: 'Do not put customers in this file. They go in Customer Master.',
  },
  accounts: {
    contains: 'All other ledgers: income, expenses, bank, cash, assets, liabilities and capital.',
    checks: [
      'The file must contain ledger records. It may also contain Tally group records, which is the only dataset where two kinds of record are accepted.',
      'Group records are used only to see which main group a sub-group belongs to. They are not written to the Zoho file and are not counted as ledgers.',
      'Each Tally group is matched to a Zoho account type in Mapping Studio. A sub-group takes the type of the group above it. Groups that still have no type ask for your decision.',
    ],
    tip: 'If you use your own sub-groups, export the groups along with the ledgers. Customers, vendors and tax ledgers may also appear, which is fine.',
  },
  stock_items: {
    contains: 'Items you buy or sell, with unit, HSN code and opening quantity and value.',
    checks: ['The file must contain stock item records only.', 'Items without a unit are flagged.', 'When the data is processed, each item\'s unit is looked up in the Units file, and items named on vouchers are looked up here. Anything missing is flagged.'],
    tip: 'If the company keeps no inventory, mark this dataset "Not applicable" in Completeness Check instead.',
  },
  units: {
    contains: 'The units your stock items use, such as nos, kgs and mtr.',
    checks: ['The file must contain unit records only.'],
    tip: 'If the company keeps no inventory, mark this dataset "Not applicable" in Completeness Check.',
  },
  taxes: {
    contains: 'Your tax ledgers: every ledger under Duties and Taxes, such as CGST, SGST and IGST.',
    checks: ['The file must contain ledger records only.', 'You get a warning if some ledgers are not under Duties and Taxes.', 'Each tax ledger must be matched to a Zoho tax name in Mapping Studio.'],
    tip: 'Create the taxes in Zoho Books first, so you can type their exact names later.',
  },
  sales: {
    contains: 'Every sales voucher for the year, with party, item lines, tax lines and voucher number.',
    checks: ['The file must contain Sales vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'Debits must equal credits on every voucher. Any that do not are flagged and left out of the output.', 'When the data is processed, every ledger, stock item and customer named on the vouchers is looked up in your master files. Anything missing is flagged.'],
    tip: 'Export from the Day Book with voucher type Sales, for the whole year.',
  },
  purchase: {
    contains: 'Every purchase voucher for the year, with vendor, item lines and tax lines.',
    checks: ['The file must contain Purchase vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'Debits must equal credits on every voucher.', 'When the data is processed, every ledger, stock item and vendor named on the vouchers is looked up in your master files. Anything missing is flagged.'],
    tip: 'Export from the Day Book with voucher type Purchase, for the whole year.',
  },
  receipt: {
    contains: 'Money received from customers, with the bank or cash ledger used.',
    checks: ['The file must contain Receipt vouchers only.', 'Vouchers dated outside the financial year give a warning.'],
    tip: 'Written to Zoho Books as Manual Journals (the journals file of receipts, payments and contra): money from a customer is on Accounts Receivable with the customer named, so the balances match Tally. With "All transactions in one file" you do not need to export this file on its own.',
  },
  payment: {
    contains: 'Money paid to vendors and for expenses, with the bank or cash ledger used.',
    checks: ['The file must contain Payment vouchers only.', 'Vouchers dated outside the financial year give a warning.'],
    tip: 'Written to Zoho Books as Manual Journals (the journals file of receipts, payments and contra): money to a vendor is on Accounts Payable with the vendor named, so the balances match Tally. With "All transactions in one file" you do not need to export this file on its own.',
  },
  journal: {
    contains: 'Journal entries. Some are real adjustments, and some are sales or purchases that were entered as journals.',
    checks: ['The file must contain Journal vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'You decide each journal in Voucher Classification: Invoice, Bill or Manual Journal.', 'Cancelled and optional journals are kept and counted, but need no decision: they are never written to a Zoho file.'],
    tip: 'Nothing is routed automatically. Every suggestion comes with its reason, and you approve every journal.',
  },
  contra: {
    contains: 'Contra vouchers: transfers between bank accounts and cash, such as cash deposited or withdrawn.',
    checks: ['The file must contain Contra vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'When the data is processed, every ledger named on the vouchers is looked up in your master files, and the vouchers are part of the Trial Balance check.'],
    tip: 'Written to Zoho Books as Manual Journals (the journals file of receipts, payments and contra), debit and credit as in Tally. This dataset is optional and never blocks processing. "All transactions in one file" fills it for you.',
  },
  debit_note: {
    contains: 'Debit notes, for example goods returned to a vendor.',
    checks: ['The file must contain Debit Note vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'When the data is processed, every ledger named on the vouchers is looked up in your master files, and the vouchers are part of the Trial Balance check.'],
    tip: 'Written to Zoho Books as Manual Journals (the journals file of receipts, payments and contra), with the vendor or customer named (Accounts Payable or Accounts Receivable). This dataset is optional and never blocks processing.',
  },
  credit_note: {
    contains: 'Credit notes, for example goods returned by a customer.',
    checks: ['The file must contain Credit Note vouchers only.', 'Vouchers dated outside the financial year give a warning.', 'When the data is processed, every ledger named on the vouchers is looked up in your master files, and the vouchers are part of the Trial Balance check.'],
    tip: 'Written to Zoho Books as Manual Journals (the journals file of receipts, payments and contra), with the customer or vendor named (Accounts Receivable or Accounts Payable). This dataset is optional and never blocks processing.',
  },
  other_vouchers: {
    contains: 'Vouchers of a type that has no dataset of its own, or of a type the platform could not trace to one of Tally\'s own voucher types.',
    checks: ['The file may contain only vouchers whose type is not Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Note or Credit Note.', 'Each voucher type found here is listed as a flagged item, with the number of vouchers.'],
    tip: 'Read and kept; no Zoho file is created for these yet. They are not checked against the masters and are not part of the Trial Balance check. Normally this dataset is filled by "All transactions in one file".',
  },
  stock_summary: {
    contains: 'Opening and closing quantity and value of each stock item.',
    checks: ['The file must contain stock summary lines only.'],
    tip: 'If the company keeps no inventory, mark this dataset "Not applicable" in Completeness Check.',
  },
  trial_balance: {
    contains: 'The Trial Balance report from Tally: for every ledger its opening balance, the debits and credits of the year, and its closing balance.',
    checks: [
      'The report is read as Tally exports it, with groups and the ledgers under them to any depth.',
      'Each line is matched by name to a ledger or a group in your master files. The upload says how many lines are ledgers, how many are groups, and whether every ledger is listed.',
      'Opening debits must equal opening credits, and closing debits must equal closing credits.',
      'When the data is processed, the debits and credits of each line are compared with the vouchers you uploaded, and opening balance plus the year\'s movement must give the closing balance. Every difference is flagged with the figures.',
      'The Opening Balances file is created only when every ledger is listed, from the Opening Balance column. If the report shows groups only, no Opening Balances file is created and the reason is shown.',
    ],
    tip: 'Press Alt+F5 in Tally before you export, so that every ledger is listed. A report that shows only groups can be checked, but it cannot give opening balances.',
  },
};

export const FILE_DETAIL_HELP = [
  ['Records', 'How many Tally records were found in the file. You can enter the count Tally shows in Completeness Check, and the two are then compared for you.'],
  ['Fields not transferred', 'Fields that are in the Tally file but are not used by the platform, so they will not reach Zoho Books. Some other fields are used only for checks and are also not written to Zoho Books. This is information, not an error.'],
  ['Checksum', 'A fingerprint of the file. If the file changes by even one character, the checksum changes. It is kept as proof of what was uploaded. For a dataset taken from the All Masters or All Transactions file, it is the checksum of that file.'],
];

// How far the uploads are, counting only what is needed: a dataset marked not applicable is not needed, and an
// optional one is needed only once a file is in. c: the migration's completeness (GET /migrations/:id).
// Returns { uploaded, needed, notApplicable, optionalMissing, percent }.
export function uploadProgress(c) {
  const slots = Array.isArray(c?.slots) ? c.slots : [];
  const uploaded = slots.filter(s => s.status === 'uploaded').length;
  const notApplicable = slots.filter(s => s.status === 'not_applicable').length;
  const optionalMissing = slots.filter(s => s.status === 'missing' && s.requirement === 'optional').length;
  const needed = slots.length - notApplicable - optionalMissing;
  return { uploaded, needed, notApplicable, optionalMissing, percent: needed > 0 ? Math.min(100, Math.round((uploaded / needed) * 100)) : 0 };
}
// "12 of 12 needed are uploaded (5 not applicable, 2 optional not uploaded)"
export function uploadProgressWords(p) {
  const extra = [p.notApplicable ? `${p.notApplicable} not applicable` : '', p.optionalMissing ? `${p.optionalMissing} optional not uploaded` : ''].filter(Boolean).join(', ');
  return `${p.uploaded} of ${p.needed} needed ${p.uploaded === 1 ? 'is' : 'are'} uploaded${extra ? ` (${extra})` : ''}`;
}

// "Goes to Zoho" for a dataset whose Zoho module has no import file yet: said in words, not "(sample needed)".
export const zohoTargetWords = text => String(text || '').replace(/\s*\(sample needed\)/gi, " (no file yet: waiting for Zoho's import sample)");

// Marking a dataset not applicable: a reason in a full sentence, offered for each dataset that can be marked, or typed.
export const NOT_APPLICABLE_REASONS = {
  stock_items: 'The company keeps no stock items in Tally.',
  units: 'The company uses no units of measure in Tally.',
  stock_summary: 'The company keeps no stock in Tally, so there is no Stock Summary.',
};
export const notApplicableReason = key => NOT_APPLICABLE_REASONS[key] || 'The company has no records of this kind in Tally.';
export const MIN_REASON = 10;
// '' when the typed reason can be saved, else what is wrong with it
export const reasonProblem = text => (String(text || '').trim().length < MIN_REASON ? `Write the reason as a short sentence (at least ${MIN_REASON} characters).` : '');
