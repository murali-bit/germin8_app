// Approved Tally export catalogue: one upload slot per dataset.
// NOTE: working list from the product plan and review 2. Not yet signed off by an accountant.

export const CATALOGUE = [
  { key: 'customers', name: 'Customer Master', category: 'Masters', expects: 'Ledger', group: 'Sundry Debtors', requirement: 'required', zoho: 'Customers',
    desc: 'Ledgers under Sundry Debtors.', report: 'List of Ledgers (group: Sundry Debtors)' },
  { key: 'vendors', name: 'Vendor Master', category: 'Masters', expects: 'Ledger', group: 'Sundry Creditors', requirement: 'required', zoho: 'Vendors',
    desc: 'Ledgers under Sundry Creditors.', report: 'List of Ledgers (group: Sundry Creditors)' },
  // alsoAccepts: Group records may be mixed in. They are used only to find a ledger's main group; they are never written to the output.
  { key: 'accounts', name: 'Chart of Accounts', category: 'Masters', expects: 'Ledger', alsoAccepts: ['Group'], requirement: 'required', zoho: 'Chart of Accounts',
    desc: 'All other ledgers: income, expense, bank, assets and liabilities. The list of groups can be included in the same file.', report: 'List of Ledgers (all groups)' },
  { key: 'stock_items', name: 'Stock Items', category: 'Masters', expects: 'StockItem', requirement: 'conditional', zoho: 'Items',
    desc: 'Items sold or purchased. Needed for inventory businesses.', report: 'List of Stock Items' },
  { key: 'units', name: 'Units of Measurement', category: 'Masters', expects: 'Unit', requirement: 'conditional', zoho: 'Items (unit)',
    desc: 'Units referenced by stock items.', report: 'List of Units' },
  { key: 'taxes', name: 'Tax Configuration', category: 'Masters', expects: 'Ledger', group: 'Duties & Taxes', requirement: 'required', zoho: 'Taxes',
    desc: 'Ledgers under Duties and Taxes.', report: 'List of Ledgers (group: Duties & Taxes)' },
  { key: 'sales', name: 'Sales Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Sales', requirement: 'required', zoho: 'Invoices',
    desc: 'All sales vouchers for the financial year.', report: 'Day Book (voucher type: Sales)' },
  { key: 'purchase', name: 'Purchase Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Purchase', requirement: 'required', zoho: 'Bills',
    desc: 'All purchase vouchers for the financial year.', report: 'Day Book (voucher type: Purchase)' },
  { key: 'receipt', name: 'Receipt Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Receipt', requirement: 'required', zoho: 'Manual Journals (money from a customer on Accounts Receivable with the customer named; Payments Received only if chosen in Voucher files, from Zoho\'s sample)',
    desc: 'Money received from customers.', report: 'Day Book (voucher type: Receipt)' },
  { key: 'payment', name: 'Payment Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Payment', requirement: 'required', zoho: 'Manual Journals (money to a vendor on Accounts Payable with the vendor named; Payments Made only if chosen in Voucher files, from Zoho\'s sample)',
    desc: 'Money paid to vendors.', report: 'Day Book (voucher type: Payment)' },
  { key: 'journal', name: 'Journal Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Journal', requirement: 'required', zoho: 'Invoices, Bills or Manual Journals',
    desc: 'Journal entries. Each one is routed after review.', report: 'Day Book (voucher type: Journal)' },
  // requirement 'optional': never blocks processing. These voucher types are written as Manual Journals (the journals
  // file of receipts, payments and contra). An "All transactions" file fills them (or confirms there are none).
  { key: 'contra', name: 'Contra Vouchers', category: 'Vouchers', expects: 'Voucher', vchtype: 'Contra', requirement: 'optional', zoho: 'Manual Journals',
    desc: 'Transfers between bank and cash accounts.', report: 'Day Book (voucher type: Contra)' },
  { key: 'debit_note', name: 'Debit Notes', category: 'Vouchers', expects: 'Voucher', vchtype: 'Debit Note', requirement: 'optional', zoho: 'Manual Journals (a debit note to a vendor on Accounts Payable with the vendor named)',
    desc: 'Debit notes, for example purchase returns.', report: 'Day Book (voucher type: Debit Note)' },
  { key: 'credit_note', name: 'Credit Notes', category: 'Vouchers', expects: 'Voucher', vchtype: 'Credit Note', requirement: 'optional', zoho: 'Manual Journals (a credit note to a customer on Accounts Receivable with the customer named)',
    desc: 'Credit notes, for example sales returns.', report: 'Day Book (voucher type: Credit Note)' },
  // otherTypes: vouchers of any type that is not one of the eight above (after following a custom type up to Tally's own type).
  { key: 'other_vouchers', name: 'Other Voucher Types', category: 'Vouchers', expects: 'Voucher', otherTypes: true, requirement: 'optional', zoho: 'No Zoho file yet',
    desc: 'Vouchers of a type the platform has no dataset for, or of a type it could not trace to one of Tally\'s own types. Kept and flagged.', report: 'Day Book (any other voucher type)' },
  { key: 'stock_summary', name: 'Stock Summary', category: 'Inventory', expects: 'StockSummaryLine', requirement: 'conditional', zoho: 'Opening Stock',
    desc: 'Opening and closing stock quantities and values.', report: 'Stock Summary' },
  { key: 'trial_balance', name: 'Trial Balance', category: 'Balances', expects: 'TrialBalanceLine', requirement: 'required', zoho: 'Opening Balances',
    desc: 'Opening balance, debits, credits and closing balance of every ledger (the detailed Trial Balance report).', report: 'Trial Balance' },
];

export const slotByKey = Object.fromEntries(CATALOGUE.map(s => [s.key, s]));
