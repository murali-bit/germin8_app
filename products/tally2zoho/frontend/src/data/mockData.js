// Realistic Enterprise Accounting Data for TallyPrime -> Zoho Books Migration Platform
// All data is clearly identified as Demonstration Data

export const DEMO_COMPANY = {
  id: "CMP-2024-089",
  name: "Apex Engineering Technologies Pvt. Ltd.",
  legalName: "Apex Engineering Technologies Private Limited",
  gstin: "27AAACA9823P1ZQ",
  pan: "AAACA9823P",
  state: "Maharashtra (27)",
  booksBeginningDate: "01-Apr-2024",
  tallyRelease: "TallyPrime 4.1 (Build 1204)",
  tallySerialNumber: "763290123",
  financialYear: "2024–25",
  cutOffDate: "2024-03-31",
  currency: "INR (₹)",
  booksStartingFrom: "2024-04-01"
};

export const MIGRATION_PROJECTS = [
  {
    id: "MIG-2024-01",
    company: "Apex Engineering Technologies Pvt. Ltd.",
    source: "TallyPrime 4.1",
    destination: "Zoho Books (India Edition)",
    financialYear: "2024–25",
    totalRecords: "14,820",
    status: "In Progress",
    stage: "Smart Mapping & Validation",
    lastUpdated: "12 Nov 2026, 14:40 IST",
    progressPercent: 68
  },
  {
    id: "MIG-2024-02",
    company: "Zenith Agro Exports LLP",
    source: "TallyPrime 3.0",
    destination: "Zoho Books (India Edition)",
    financialYear: "2024–25",
    totalRecords: "28,450",
    status: "Completed",
    stage: "Final Reconciled",
    lastUpdated: "08 Nov 2026, 18:22 IST",
    progressPercent: 100
  },
  {
    id: "MIG-2024-03",
    company: "Kaveri Precision Components",
    source: "TallyPrime 4.0",
    destination: "Zoho Books (India Edition)",
    financialYear: "2024–25",
    totalRecords: "9,640",
    status: "Requires Attention",
    stage: "Zoho Rejection Handling",
    lastUpdated: "11 Nov 2026, 11:15 IST",
    progressPercent: 82
  },
  {
    id: "MIG-2024-04",
    company: "BlueOcean Logistics India",
    source: "TallyPrime 4.1",
    destination: "Zoho Books (India Edition)",
    financialYear: "2025–26",
    totalRecords: "5,120",
    status: "Draft",
    stage: "Awaiting Uploads",
    lastUpdated: "12 Nov 2026, 09:30 IST",
    progressPercent: 20
  }
];

export const EXPORT_CATALOGUE = [
  {
    id: "CAT-01",
    dataset: "Customer Master (Sundry Debtors)",
    category: "Master Data",
    description: "All customer accounts under Sundry Debtors including GSTIN, billing address, shipping addresses and contact details.",
    requiredFor: "Sales Invoices, Receipt Vouchers, Debtor Balances",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "4.8 MB",
    recordsCount: 1240
  },
  {
    id: "CAT-02",
    dataset: "Vendor Master (Sundry Creditors)",
    category: "Master Data",
    description: "All vendor accounts under Sundry Creditors with PAN, GSTIN, bank IFSC/account, and payment terms.",
    requiredFor: "Purchase Bills, Payment Vouchers, Vendor Balances",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "3.2 MB",
    recordsCount: 890
  },
  {
    id: "CAT-03",
    dataset: "Chart of Accounts (Ledgers & Groups)",
    category: "Master Data",
    description: "Complete hierarchy of Primary Groups, Subgroups, and Ledgers with parent-child relationships.",
    requiredFor: "All transactions, Opening Balances, Trial Balance",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "1.9 MB",
    recordsCount: 462
  },
  {
    id: "CAT-04",
    dataset: "Stock Items & Groups",
    category: "Inventory Masters",
    description: "Item descriptions, HSN/SAC codes, Tax applicability, Base and alternate units, Costing method.",
    requiredFor: "Itemized Invoices, Inventory Valuation",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "6.1 MB",
    recordsCount: 3150
  },
  {
    id: "CAT-05",
    dataset: "Units of Measurement (UOM)",
    category: "Inventory Masters",
    description: "Simple and compound units (e.g., KGS, NOS, BOX of 12, MTS) with formal UQC codes.",
    requiredFor: "Stock Item mappings, GST Compliant Invoices",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "120 KB",
    recordsCount: 38
  },
  {
    id: "CAT-06",
    dataset: "Tax Configuration & Duty Ledgers",
    category: "Statutory Masters",
    description: "CGST, SGST, IGST duty ledgers, cess rates, RCM flags, and GST classification rules.",
    requiredFor: "Tax engine mapping in Zoho Books",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "340 KB",
    recordsCount: 44
  },
  {
    id: "CAT-07",
    dataset: "Sales Vouchers",
    category: "Transactional Data",
    description: "All sales vouchers with party, item lines, tax and voucher numbers.",
    requiredFor: "Zoho Invoices",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "18.6 MB",
    recordsCount: 3420
  },
  {
    id: "CAT-07B",
    dataset: "Purchase Vouchers",
    category: "Transactional Data",
    description: "All purchase vouchers with vendor, item lines and tax.",
    requiredFor: "Zoho Bills",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "12.4 MB",
    recordsCount: 2100
  },
  {
    id: "CAT-07C",
    dataset: "Receipt Vouchers",
    category: "Transactional Data",
    description: "Money received, with references to customer invoices.",
    requiredFor: "Zoho Payments Received",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "8.1 MB",
    recordsCount: 1800
  },
  {
    id: "CAT-07D",
    dataset: "Payment Vouchers",
    category: "Transactional Data",
    description: "Money paid, with references to vendor bills.",
    requiredFor: "Zoho Payments Made",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "5.9 MB",
    recordsCount: 920
  },
  {
    id: "CAT-07E",
    dataset: "Journal Vouchers",
    category: "Transactional Data",
    description: "Adjustment and other journal entries that need routing to Invoice, Bill or Manual Journal.",
    requiredFor: "Zoho Invoices, Bills or Manual Journals",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "3.2 MB",
    recordsCount: 400
  },
  {
    id: "CAT-08",
    dataset: "Stock Summary & Batch Valuation",
    category: "Inventory Balances",
    description: "Opening quantity, rate, value, inward/outward movement, and closing stock per warehouse/godown.",
    requiredFor: "Zoho Opening Stock & Inventory reconciliation",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "5.4 MB",
    recordsCount: 3150
  },
  {
    id: "CAT-09",
    dataset: "Trial Balance as on Cut-off Date",
    category: "Financial Control",
    description: "Detailed closing balances for all asset, liability, capital, revenue and expense ledgers.",
    requiredFor: "Financial Reconciliation & Zoho Opening Balances",
    exportFormat: "JSON",
    exportStatus: "Uploaded",
    approvalStatus: "Approved by CA",
    isMandatory: true,
    fileSize: "840 KB",
    recordsCount: 462
  },
  {
    id: "CAT-10",
    dataset: "Bill-by-Bill Outstanding (Debtors/Creditors)",
    category: "Sub-Ledger Control",
    description: "Individual pending reference numbers, bill dates, overdue days and allocated amounts.",
    requiredFor: "Open Invoice & Bill matching in Zoho Books",
    exportFormat: "JSON",
    exportStatus: "Missing",
    approvalStatus: "Pending Upload",
    isMandatory: false,
    fileSize: "-",
    recordsCount: 0
  }
];

export const SMART_MAPPINGS_SAMPLE = [
  {
    id: "MAP-001",
    sourceObject: "STOCKITEM",
    sourceField: "NAME",
    canonicalField: "item.name",
    destinationModule: "Zoho Items",
    destinationField: "Item Name",
    transformation: "Trim & TitleCase",
    matchScore: 99,
    status: "Verified",
    sampleSource: "Stainless Steel Hex Bolt M12x50",
    sampleTarget: "Stainless Steel Hex Bolt M12x50"
  },
  {
    id: "MAP-002",
    sourceObject: "STOCKITEM",
    sourceField: "BASEUNITS",
    canonicalField: "item.unit",
    destinationModule: "Zoho Items",
    destinationField: "Usage Unit",
    transformation: "Lookup UOM Code (NOS -> pcs)",
    matchScore: 94,
    status: "Verified",
    sampleSource: "NOS",
    sampleTarget: "pcs"
  },
  {
    id: "MAP-003",
    sourceObject: "LEDGER (Sundry Debtors)",
    sourceField: "PARENT",
    canonicalField: "contact.contact_type",
    destinationModule: "Zoho Contacts",
    destinationField: "Customer Type",
    transformation: "Static Value ('customer')",
    matchScore: 100,
    status: "Verified",
    sampleSource: "Sundry Debtors - West Zone",
    sampleTarget: "customer"
  },
  {
    id: "MAP-004",
    sourceObject: "LEDGER (Sundry Creditors)",
    sourceField: "PARENT",
    canonicalField: "contact.contact_type",
    destinationModule: "Zoho Contacts",
    destinationField: "Vendor Type",
    transformation: "Static Value ('vendor')",
    matchScore: 100,
    status: "Verified",
    sampleSource: "Sundry Creditors - Raw Materials",
    sampleTarget: "vendor"
  },
  {
    id: "MAP-005",
    sourceObject: "VOUCHER (Sales)",
    sourceField: "VOUCHERNUMBER",
    canonicalField: "invoice.document_number",
    destinationModule: "Zoho Invoices",
    destinationField: "Invoice Number",
    transformation: "Clean Non-Standard Slash Characters",
    matchScore: 98,
    status: "Verified",
    sampleSource: "INV/24-25/0842",
    sampleTarget: "INV/24-25/0842"
  },
  {
    id: "MAP-006",
    sourceObject: "LEDGER",
    sourceField: "NARRATION",
    canonicalField: "journal.description",
    destinationModule: "Zoho Manual Journals",
    destinationField: "Notes / Description",
    transformation: "Truncate to 500 chars",
    matchScore: 88,
    status: "Needs Review",
    sampleSource: "Being depreciation charged on plant machinery for Q3",
    sampleTarget: "Being depreciation charged on plant machinery for Q3"
  },
  {
    id: "MAP-007",
    sourceObject: "STOCKITEM",
    sourceField: "TAXCLASSIFICATION",
    canonicalField: "item.tax_rate",
    destinationModule: "Zoho Items",
    destinationField: "Intra-state Tax Name",
    transformation: "Map GST18 -> GST 18% (9% CGST + 9% SGST)",
    matchScore: 91,
    status: "Verified",
    sampleSource: "GST 18%",
    sampleTarget: "GST 18%"
  },
  {
    id: "MAP-008",
    sourceObject: "LEDGER",
    sourceField: "BILLCREDITPERIOD",
    canonicalField: "contact.payment_terms",
    destinationModule: "Zoho Contacts",
    destinationField: "Payment Terms (Days)",
    transformation: "Extract Integer Days ('30 Days' -> 30)",
    matchScore: 82,
    status: "Needs Review",
    sampleSource: "30 Days Net",
    sampleTarget: "30"
  }
];

export const RECONCILIATION_METRICS = [
  {
    metric: "Customer Master Accounts",
    sourceValue: "1,240 records",
    destValue: "1,240 records",
    difference: "0",
    status: "Exact Match",
    verifiedBy: "System Hash Verification"
  },
  {
    metric: "Vendor Master Accounts",
    sourceValue: "890 records",
    destValue: "890 records",
    difference: "0",
    status: "Exact Match",
    verifiedBy: "System Hash Verification"
  },
  {
    metric: "Active Stock Items",
    sourceValue: "3,150 items",
    destValue: "3,150 items",
    difference: "0",
    status: "Exact Match",
    verifiedBy: "Item Code Audit"
  },
  {
    metric: "Total Debit Balances (₹)",
    sourceValue: "₹ 14,82,90,412.50",
    destValue: "₹ 14,82,90,412.50",
    difference: "₹ 0.00",
    status: "Balanced",
    verifiedBy: "Trial Balance Check"
  },
  {
    metric: "Total Credit Balances (₹)",
    sourceValue: "₹ 14,82,90,412.50",
    destValue: "₹ 14,82,90,412.50",
    difference: "₹ 0.00",
    status: "Balanced",
    verifiedBy: "Trial Balance Check"
  },
  {
    metric: "Accounts Receivable (Sundry Debtors)",
    sourceValue: "₹ 3,42,18,500.00",
    destValue: "₹ 3,42,18,500.00",
    difference: "₹ 0.00",
    status: "Reconciled",
    verifiedBy: "Sub-Ledger Total"
  },
  {
    metric: "Accounts Payable (Sundry Creditors)",
    sourceValue: "₹ 2,19,45,210.00",
    destValue: "₹ 2,19,45,210.00",
    difference: "₹ 0.00",
    status: "Reconciled",
    verifiedBy: "Sub-Ledger Total"
  },
  {
    metric: "Closing Stock Valuation (FIFO)",
    sourceValue: "₹ 4,89,62,100.00",
    destValue: "₹ 4,89,62,100.00",
    difference: "₹ 0.00",
    status: "Reconciled",
    verifiedBy: "Physical & Batch Match"
  }
];

export const ZOHO_REJECTIONS_SAMPLE = [
  {
    id: "ERR-901",
    tallySourceId: "LEDGER-TALLY-0841",
    tallyName: "M/s Reliance Polymers India",
    zohoModule: "Contacts (Customer)",
    errorCode: "INVALID_GSTIN_CHECKSUM",
    rejectionReason: "GSTIN '27AABCR1234F1Z8' failed Ministry of Finance mod-36 checksum verification.",
    suggestedResolution: "Correct checksum digit '8' to '9' as per active GST portal record or mark as Unregistered Dealer.",
    beforeValue: "27AABCR1234F1Z8",
    afterValue: "27AABCR1234F1Z9",
    status: "Pending User Approval",
    severity: "High"
  },
  {
    id: "ERR-902",
    tallySourceId: "ITEM-TALLY-3104",
    tallyName: "Polymer Seal Gasket Type B",
    zohoModule: "Items",
    errorCode: "UNIT_NOT_FOUND",
    rejectionReason: "Usage unit 'SET' is not defined in Zoho Books unit list.",
    suggestedResolution: "Automatically map 'SET' to predefined unit 'Sets' or create custom unit in Zoho.",
    beforeValue: "SET",
    afterValue: "Sets (Custom Unit)",
    status: "Pending User Approval",
    severity: "Medium"
  },
  {
    id: "ERR-903",
    tallySourceId: "VOUCHER-TALLY-10928",
    tallyName: "Sales Invoice INV/24-25/1102",
    zohoModule: "Invoices",
    errorCode: "MISSING_MANDATORY_FIELD",
    rejectionReason: "Place of Supply is empty in source voucher header.",
    suggestedResolution: "Derive Place of Supply '27-Maharashtra' from customer master registered state code.",
    beforeValue: "[EMPTY]",
    afterValue: "27-Maharashtra",
    status: "Pending User Approval",
    severity: "High"
  },
  {
    id: "ERR-904",
    tallySourceId: "VOUCHER-TALLY-10940",
    tallyName: "Payment Voucher PV/24-25/0312",
    zohoModule: "Payments Made",
    errorCode: "ACCOUNT_NOT_BANK_OR_CASH",
    rejectionReason: "Paid Through account 'HDFC Bank OD A/c' is not categorized as Bank/Cash in Zoho Chart of Accounts.",
    suggestedResolution: "Ensure account 'HDFC Bank OD A/c' is classified under 'Bank' account type in Zoho COA.",
    beforeValue: "Current Liabilities",
    afterValue: "Bank (Overdraft)",
    status: "Pending User Approval",
    severity: "Critical"
  }
];

export const SOURCE_TO_ZOHO_TRACEABILITY = [
  {
    tallyId: "LEDGER-T-00101",
    objectType: "Customer",
    sourceName: "Adani Solar Equipment Ltd.",
    migrationId: "CANON-CUST-8819",
    zohoModule: "Contacts",
    zohoReference: "ZB-CUST-990142",
    status: "Imported & Confirmed",
    transformRule: "Standard Customer Transform v2.1"
  },
  {
    tallyId: "LEDGER-T-00102",
    objectType: "Vendor",
    sourceName: "Tata Steel Tubes Division",
    migrationId: "CANON-VEND-3312",
    zohoModule: "Contacts",
    zohoReference: "ZB-VEND-110482",
    status: "Imported & Confirmed",
    transformRule: "Vendor Master Transform v1.9"
  },
  {
    tallyId: "ITEM-T-00450",
    objectType: "Stock Item",
    sourceName: "High Tensile Flange 40mm",
    migrationId: "CANON-ITEM-4091",
    zohoModule: "Items",
    zohoReference: "ZB-ITEM-881023",
    status: "Imported & Confirmed",
    transformRule: "Item Master Transform v3.0"
  },
  {
    tallyId: "VOUCH-T-09812",
    objectType: "Sales Voucher",
    sourceName: "Tax Invoice # INV-2024-001",
    migrationId: "CANON-INV-10924",
    zohoModule: "Invoices",
    zohoReference: "ZB-INV-001928",
    status: "Imported & Confirmed",
    transformRule: "Tax Invoice Line Extraction v2.4"
  },
  {
    tallyId: "VOUCH-T-09813",
    objectType: "Receipt Voucher",
    sourceName: "Customer Receipt # RCT-2024-041",
    migrationId: "CANON-RCT-05819",
    zohoModule: "Payments Received",
    zohoReference: "Pending Destination Evidence",
    status: "Pending Manual Import",
    transformRule: "Payment Receipt Mapper v1.2"
  },
  {
    tallyId: "VOUCH-T-09814",
    objectType: "Journal Voucher",
    sourceName: "Prepaid Insurance Amortization",
    migrationId: "CANON-JRNL-01048",
    zohoModule: "Manual Journals",
    zohoReference: "Pending Destination Evidence",
    status: "Pending Manual Import",
    transformRule: "Dual-entry Balance Checker v2.0"
  }
];

export const TEMPLATES_CATALOGUE = [
  {
    id: "TMPL-01",
    module: "Chart of Accounts",
    acceptedFormat: "CSV / XLS",
    version: "Zoho India v4.8 (2024)",
    fileSizeLimit: "5 MB",
    requiredColumns: 7,
    optionalColumns: 14,
    lastVerified: "01 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_coa_template_v4.8.csv"
  },
  {
    id: "TMPL-02",
    module: "Customers (Contacts)",
    acceptedFormat: "CSV / TSV",
    version: "Zoho India v5.1 (2024)",
    fileSizeLimit: "10 MB",
    requiredColumns: 6,
    optionalColumns: 38,
    lastVerified: "03 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_customers_template_v5.1.csv"
  },
  {
    id: "TMPL-03",
    module: "Vendors (Contacts)",
    acceptedFormat: "CSV / TSV",
    version: "Zoho India v5.1 (2024)",
    fileSizeLimit: "10 MB",
    requiredColumns: 6,
    optionalColumns: 34,
    lastVerified: "03 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_vendors_template_v5.1.csv"
  },
  {
    id: "TMPL-04",
    module: "Items & Inventory",
    acceptedFormat: "CSV / XLS",
    version: "Zoho India v3.9 (2024)",
    fileSizeLimit: "10 MB",
    requiredColumns: 8,
    optionalColumns: 26,
    lastVerified: "04 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_items_template_v3.9.csv"
  },
  {
    id: "TMPL-05",
    module: "Sales Invoices",
    acceptedFormat: "CSV",
    version: "Zoho India Invoices v6.0",
    fileSizeLimit: "15 MB",
    requiredColumns: 12,
    optionalColumns: 42,
    lastVerified: "05 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_invoices_template_v6.0.csv"
  },
  {
    id: "TMPL-06",
    module: "Purchase Bills",
    acceptedFormat: "CSV",
    version: "Zoho India Bills v5.4",
    fileSizeLimit: "15 MB",
    requiredColumns: 11,
    optionalColumns: 36,
    lastVerified: "05 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_bills_template_v5.4.csv"
  },
  {
    id: "TMPL-07",
    module: "Customer Payments Received",
    acceptedFormat: "CSV",
    version: "Zoho India Payments v4.2",
    fileSizeLimit: "8 MB",
    requiredColumns: 7,
    optionalColumns: 18,
    lastVerified: "06 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_payments_received_v4.2.csv"
  },
  {
    id: "TMPL-08",
    module: "Vendor Payments Made",
    acceptedFormat: "CSV",
    version: "Zoho India Payments v4.2",
    fileSizeLimit: "8 MB",
    requiredColumns: 7,
    optionalColumns: 18,
    lastVerified: "06 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_payments_made_v4.2.csv"
  },
  {
    id: "TMPL-09",
    module: "Manual Journals",
    acceptedFormat: "CSV",
    version: "Zoho India Journals v3.8",
    fileSizeLimit: "8 MB",
    requiredColumns: 8,
    optionalColumns: 12,
    lastVerified: "07 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_manual_journals_v3.8.csv"
  },
  {
    id: "TMPL-10",
    module: "Opening Balances / Stock",
    acceptedFormat: "CSV / XLS",
    version: "Zoho India Opening v2.9",
    fileSizeLimit: "5 MB",
    requiredColumns: 6,
    optionalColumns: 10,
    lastVerified: "07 Nov 2026",
    status: "Verified Ready",
    sampleFileName: "zoho_opening_balances_v2.9.csv"
  }
];

