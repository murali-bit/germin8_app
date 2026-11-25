// Wizard and guide text written from company data, held vouchers built from an uploaded Zoho sample, and the evidence
// of the second test import. Every company here is synthetic and of a different shape; no test-company value is used.
import test from 'node:test';
import assert from 'node:assert/strict';

const { learnLayout, buildHeldFile, isBuildable, HELD_MODULES } = await import('../src/heldfiles.js');
const { companyFactsOf, setupHints, readMeFirst, RULES } = await import('../src/importwizard.js');
const { evidenceLevel } = await import('../src/zohocheck.js');

const rcSample = ['Payment Number', 'Date', 'Customer Name', 'Payment Mode', 'Amount', 'Reference#', 'Deposit To', 'Invoice Number', 'Amount Applied', 'Currency Code', 'Exchange Rate'];
const pmSample = ['Date', 'Vendor Name', 'Amount', 'Paid Through', 'Bill Number', 'Amount Applied', 'Reference Number'];
const voucher = (o = {}) => ({ number: '1', date: '2025-05-02', party: 'Buyer One', bank: 'Bank A', amount: '1000.00', applied: [{ file: 'invoices', number: 'INV-1', ref: 'INV-1', amount: '1000.00' }], unapplied: '0.00', flags: [], ...o });
const csvRows = csv => csv.replace(/^﻿/, '').trim().split(/\r?\n/);

test('a sample is read by meaning, headings are the sample\'s own, and unknown headings are listed', () => {
  const l = learnLayout('payments_received', rcSample);
  assert.equal(l.buildable, true);
  assert.deepEqual(l.found, { date: 'Date', party: 'Customer Name', amount: 'Amount', account: 'Deposit To', mode: 'Payment Mode', number: 'Payment Number', reference: 'Reference#', document: 'Invoice Number', applied: 'Amount Applied' });
  assert.deepEqual(l.notUnderstood, ['Currency Code', 'Exchange Rate']);
  const v = learnLayout('payments_made', pmSample);
  assert.equal(v.buildable, true);
  assert.equal(v.found.account, 'Paid Through');
  // a customer sample is not a vendor sample: the party heading is not found, so nothing is built
  assert.deepEqual(learnLayout('payments_made', rcSample).missing.map(m => m.concept), ['party', 'account']);
});

test('Payments Received file: one row per invoice applied, the sample\'s headings in the sample\'s order, nothing invented', () => {
  const details = [
    voucher({ number: '7', amount: '1500.00', applied: [{ file: 'invoices', number: 'INV-1', amount: '1000.00' }, { file: 'invoices', number: 'INV-2', amount: '500.00' }] }),
    voucher({ number: '3', date: '2025-04-20', party: 'Buyer Two', amount: '200.00', applied: [], unapplied: '200.00' }),
  ];
  const b = buildHeldFile('payments_received', rcSample, details);
  assert.equal(b.built, true);
  const lines = csvRows(b.csv);
  assert.equal(lines[0], rcSample.join(','));
  assert.equal(lines.length - 1, 3, 'two rows for the two-invoice payment, one for the unapplied one');
  assert.equal(b.vouchers, 2);
  // sorted by date; unapplied payment has no invoice; the unknown columns are empty
  assert.match(lines[1], /^RCT-3,2025-04-20,Buyer Two,Others,200\.00,3,Bank A,,,,$/);
  assert.match(lines[2], /^RCT-7,2025-05-02,Buyer One,Others,1500\.00,7,Bank A,INV-1,1000\.00,,$/);
  assert.match(lines[3], /,INV-2,500\.00,,$/);
  assert.ok(b.notes.some(n => /excess payment/.test(n)));
  assert.ok(b.notes.some(n => /"Currency Code", "Exchange Rate"/.test(n)));
});

test('Payments Made file for a vendor sample without a payment number column', () => {
  const b = buildHeldFile('payments_made', pmSample, [voucher({ party: 'Supplier One', applied: [{ file: 'bills', number: 'B-9', amount: '1000.00' }] })]);
  assert.equal(b.built, true);
  const lines = csvRows(b.csv);
  assert.equal(lines[0], pmSample.join(','));
  assert.equal(lines[1], '2025-05-02,Supplier One,1000.00,Bank A,B-9,1000.00,1');
  assert.ok(b.notes.some(n => /numbers the payments itself/.test(n)));
});

test('a sample with no invoice column writes unlinked payments and says so; a missing bank column keeps the module held with the exact reason', () => {
  const b = buildHeldFile('payments_received', ['Date', 'Customer Name', 'Amount', 'Deposit To'], [voucher()]);
  assert.equal(b.built, true);
  assert.equal(csvRows(b.csv)[1], '2025-05-02,Buyer One,1000.00,Bank A');
  assert.ok(b.notes.some(n => /no column for the invoice number/.test(n)));
  const miss = buildHeldFile('payments_received', ['Date', 'Customer Name', 'Amount'], [voucher()]);
  assert.equal(miss.built, false);
  assert.match(miss.reason, /no heading that means: Bank or cash account/);
  assert.match(miss.reason, /"Date", "Customer Name", "Amount"/);
  // an applied-amount column is needed when there is an invoice column
  assert.match(buildHeldFile('payments_received', ['Date', 'Customer Name', 'Amount', 'Deposit To', 'Invoice Number'], [voucher()]).reason, /applied to that invoice/i);
});

test('a voucher with lines besides the party and the bank stays held, whatever the company', () => {
  const other = voucher({ number: '9', flags: [{ kind: 'money_voucher_other_lines', message: 'x' }] });
  const b = buildHeldFile('payments_made', pmSample, [voucher(), other]);
  assert.equal(b.vouchers, 1);
  assert.deepEqual(b.heldBack.map(h => h.number), ['9']);
  assert.ok(b.notes.some(n => /stays? held/.test(n) && /9/.test(n)));
});

test('text cells that start like a formula are written as text', () => {
  const b = buildHeldFile('payments_made', pmSample, [voucher({ party: '=HYPERLINK("x")', applied: [] })]);
  assert.match(csvRows(b.csv)[1], /'=HYPERLINK/);
});

test('Vendor Credits and Credit Notes stay held, with the reason from the rules', () => {
  for (const k of ['vendor_credits', 'credit_notes']) {
    assert.equal(isBuildable(k), false);
    const l = learnLayout(k, ['Date', 'Vendor Name']);
    assert.equal(l.buildable, false);
    assert.ok(HELD_MODULES[k].why_held.length > 20);
    assert.equal(buildHeldFile(k, ['Date'], [voucher()]).built, false);
  }
});

test('set-up hints follow the company: a goods trader, an exporter, a composition vendor, a services company with TDS', () => {
  const none = { overseas: { customers: 0, vendors: 0 }, sez: { customers: 0, vendors: 0 }, composition: { customers: 0, vendors: 0 }, reverseChargeBills: 0 };
  const trader = setupHints({ job: { gstin: '29AAAAA0000A1Z5' }, fy: { from: '2025-04-01' }, facts: none, tds: { taxes: [], exportGiven: false, toCreate: 0 } });
  assert.match(trader.profile[0], /Karnataka/);
  assert.ok(trader.gst.some(t => /Leave SEZ \/ Overseas Trading unticked/.test(t)));
  assert.ok(trader.gst.some(t => /No bill in these files uses reverse charge/.test(t)));
  assert.ok(trader.tds.some(t => /Old Income Tax Act 1961/.test(t)));
  assert.ok(trader.tds.some(t => /no TDS tax has to be created/.test(t)));

  const exporter = setupHints({ job: { gstin: '27AAAAA0000A1Z5' }, fy: { from: '2026-04-01' }, tds: null,
    facts: { ...none, overseas: { customers: 3, vendors: 1 }, reverseChargeBills: 2, composition: { customers: 0, vendors: 1 } } });
  assert.match(exporter.profile[0], /Maharashtra/);
  assert.ok(exporter.gst.some(t => /3 customers and 1 vendor in these files are outside India or in an SEZ: tick SEZ \/ Overseas Trading, and choose any expense account as the Custom Duty Tracking Account/.test(t)));
  assert.ok(exporter.gst.some(t => /2 bills in these files carry reverse charge GST: tick Reverse Charge/.test(t)));
  assert.ok(exporter.gst.some(t => /1 party in these files is under the composition scheme\. That is about them/.test(t)));
  assert.ok(exporter.tds.some(t => /New Income Tax Act 2025/.test(t)));

  const services = setupHints({ job: {}, fy: { from: '2024-04-01' }, facts: none,
    tds: { taxes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], exportGiven: true, toCreate: 2 } });
  assert.deepEqual(services.profile, []);
  assert.ok(services.tds.some(t => /3 TDS taxes are named in the files; 2 of them are not in the TDS export you gave/.test(t)));
});

test('company facts are counted from rows, not names', () => {
  const f = companyFactsOf({
    customers: [{ treatment: 'overseas' }, { treatment: 'business_gst' }, { treatment: 'business_sez' }],
    vendors: [{ treatment: 'business_registered_composition' }, { treatment: 'overseas' }, { treatment: '' }],
    bills: [{ doc: 'A', reverseCharge: true }, { doc: 'A', reverseCharge: true }, { doc: 'B', reverseCharge: false }, { doc: 'C', reverseCharge: true }],
  });
  assert.deepEqual(f, { overseas: { customers: 1, vendors: 1 }, sez: { customers: 1, vendors: 0 }, composition: { customers: 0, vendors: 1 }, reverseChargeBills: 2, reverseChargeNoState: 0 });
});

test('READ_ME_FIRST is written from the wizard state and holds the corrected instructions', () => {
  const rule = RULES.organisation_setup;
  const item = o => ({ what: o.what, paths: [o.where.split(/\s*;\s*/).map(p => p.split(/\s*>\s*/))].flat(), notes: [], hints: ['A hint of this company.'], lines: [], ticks: [{ id: 'x', text: `Tick for ${o.what}.` }] });
  const s = { steps: [
    { kind: 'setup', items: rule.map(item), questions: [{ text: 'Is the field on?', help: 'Help words.', value: 'off', options: [{ id: 'on', label: 'Yes' }, { id: 'off', label: 'No' }] }] },
    { kind: 'date', mode: 'edit', date: { nice: '31/03/2025' }, dependsOn: [{ key: 'accounts', module: 'Chart of Accounts', rows: 1 }, { key: 'customers', module: 'Customers', rows: 4 }], balancesToType: [] },
  ] };
  const text = readMeFirst({ company: 'Any Co', financial_year: '2025-26' }, s).join('\n');
  assert.match(text, /^Read this first: Any Co, financial year 2025-26/);
  assert.match(text, /Where: Settings > Taxes & Compliance > Direct Taxes > Income TDS Settings/);
  assert.match(text, /For this company: A hint of this company\./);
  assert.match(text, /Answered in the tool: No/);
  // changed on purpose (opening balance batch): the Migration Date is a numbered step that cannot be missed, says what
  // depends on it and what happens when it is skipped, and asks for an edit of the date: no balance is typed
  assert.match(text, /\n\d+\. Migration Date \(the Opening Balance Date of Zoho Books\)\. DO NOT SKIP THIS\./);
  assert.match(text, /The Migration Date of this migration is 31\/03\/2025\./);
  assert.match(text, /1 opening balance in Chart of Accounts and 4 opening balances in Customers/);
  assert.match(text, /If you skip this step, Zoho Books dates those balances on the day the organisation was made/);
  assert.match(text, /Click Edit, change the date to the Migration Date, type NO balance/);
  assert.match(text, /type it in the Import Wizard/);
  assert.doesNotMatch(text, /set it back|type one real opening balance|type any one/i);
  // the rare case: no chart row can carry a balance, so ONE named balance is typed (it is in no file)
  const typed = readMeFirst({ company: 'Any Co', financial_year: '2025-26' }, { steps: [{ kind: 'setup', items: [], questions: [] },
    { kind: 'date', mode: 'type', date: { nice: '31/03/2025' }, dependsOn: [{ key: 'vendors', module: 'Vendors', rows: 2 }], balancesToType: [{ account: 'Town Bank', side: 'Debit', amount: '10.00' }] }] }).join('\n');
  assert.match(typed, /type this ONE balance: "Town Bank" 10\.00 Debit\. It is in no file, so it is not counted twice/);
});

test('the set-up text of the rules: right Settings paths, the Custom Duty account, the TDS tax act, both copies the same', () => {
  const org = RULES.organisation_setup;
  for (const o of RULES.import_order.filter(x => x.kind === 'setup')) {
    const same = org.find(x => x.step === o.step);
    assert.deepEqual([same.do, same.where], [o.do, o.where], `step ${o.step} is the same in both copies`);
  }
  const text = org.map(o => `${o.where} ${o.do}`).join('\n');
  assert.match(text, /Organization, Users & Roles, Setup & Configurations, Customization and Automation/);
  assert.match(text, /Taxes & Compliance with Taxes, Direct Taxes and e-Way Bills/);
  assert.match(text, /Custom Duty Tracking Account a required field: choose any expense account/);
  assert.match(text, /Income TDS Settings/);
  assert.match(text, /Income TDS Rates/);
  assert.match(text, /Applicable Income Tax Act first: choose the Old Income Tax Act 1961/);
  assert.match(text, /start date of every tax on or before the first day of the financial year/);
  assert.match(text, /Export TDS Taxes/);
  // no old path, and no step that tells the user to set the date before the balances
  assert.ok(!/Settings > Preferences/.test(JSON.stringify(RULES.organisation_setup)));
  assert.ok(!/Settings > Opening Balances/.test(JSON.stringify(RULES.import_order)));
  // every sentence of a set-up step is a whole instruction (it becomes a tick box)
  for (const o of org) for (const sentence of o.do.split(/(?<=\.)\s+(?=[A-Z+])/)) assert.ok(sentence.length > 15 && /\.$/.test(sentence), `step ${o.step}: "${sentence}"`);
});

test('the second import: every lesson is confirmed evidence, names its rules, and keeps no party, GSTIN or amount', () => {
  const lessons = RULES.lists.second_import_lessons;
  assert.equal(lessons.entries.length, 9);
  const ids = new Set(Object.values(RULES.modules).flatMap(m => (m.rules || []).map(r => r.id)));
  for (const e of lessons.entries) {
    assert.equal(e.evidence, 'Confirmed by second import');
    for (const r of e.rules) assert.ok(ids.has(r), `${e.id}: rule ${r} exists`);
    assert.ok(!/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9][A-Z0-9]\b/.test(e.lesson), 'no GSTIN');
  }
  for (const id of ['account-type-name', 'tds-columns', 'rcm-igst', 'hsn-required', 'header-spelling', 'opening-balance-date', 'tds-tax-act-and-expired', 'tds-default-name-clash', 'unregistered-vendor-treatment']) {
    assert.ok(lessons.entries.some(e => e.id === id), id);
  }
  assert.equal(evidenceLevel('Confirmed by second import'), 'confirmed');
  assert.equal(evidenceLevel('confirmed by our import'), 'confirmed');
  assert.equal(evidenceLevel('Zoho documentation'), 'documented');
  const rule = id => Object.values(RULES.modules).flatMap(m => m.rules || []).find(r => r.id === id);
  for (const id of ['BIL-TDS-THREE-TOGETHER', 'INV-TDS-THREE-TOGETHER', 'BIL-RCM-INTRA-INTER', 'INV-HSN-REQUIRED-WHEN-ENABLED', 'COA-TYPE-ALLOWED']) assert.equal(rule(id).evidence, 'Confirmed by second import', id);
});

test('a sample that repeats a heading: each column keeps its own value, and the unapplied total is exact', () => {
  // "Amount" and "Notes" appear twice; the second "Amount" is not a meaning of its own, so it stays empty
  const heads = ['Date', 'Customer Name', 'Amount', 'Notes', 'Amount', 'Notes', 'Deposit To'];
  const details = [voucher({ applied: [], unapplied: '0.10' }), voucher({ number: '2', applied: [], unapplied: '0.20' }), voucher({ number: '3', applied: [], unapplied: '0.30' })];
  const b = buildHeldFile('payments_received', heads, details);
  assert.equal(b.built, true);
  const rows = csvRows(b.csv).slice(1).map(l => l.split(','));
  assert.equal(rows.length, 3);
  for (const r of rows) assert.deepEqual([r[2] !== '', r[3], r[4], r[5]], [true, '', '', ''], 'only the first Amount is written');
  assert.ok(b.notes.some(n => n.includes('0.60 in all')), '0.1 + 0.2 + 0.3 is 0.60, not 0.6000000000000001');
});

test('the zip read-me has a section on vouchers that are in no file: counts, reason and the sample to upload', async () => {
  const { heldLines } = await import('../src/importwizard.js');
  assert.deepEqual(heldLines(null), []);
  assert.deepEqual(heldLines({ available: true, modules: [] }), [], 'nothing held: no section');
  const held = { available: true, notInAnyFile: 12, awaitingRouting: 1, modules: [
    { module: 'Customer Payments', vouchers: 5, file: { buildable: false, sampleReceived: false } },
    { module: 'Vendor Payments', vouchers: 6, file: { buildable: true } },
    { module: 'Vendor Credits', vouchers: 1, file: { stillHeld: true, buildable: false, why: 'Zoho gives no import columns for it.' } }] };
  const text = heldLines(held).join('\n');
  assert.match(text, /Vouchers that are not in any file/);
  assert.match(text, /12 vouchers are in no file/);
  assert.match(text, /Customer Payments: 5 vouchers\. .*sample.*not in the platform/);
  assert.match(text, /Vendor Payments: 6 vouchers\. The file is in this zip/);
  assert.match(text, /Vendor Credits: 1 voucher\. They stay held: Zoho gives no import columns/);
  assert.match(text, /1 journal voucher waits for a decision/);
  // and READ_ME_FIRST carries the lines it is given
  const s = { steps: [{ kind: 'setup', items: [], questions: [] }] };
  assert.match(readMeFirst({ company: 'Any Co', financial_year: '2025-26' }, s, heldLines(held)).join('\n'), /Vouchers that are not in any file/);
});

test('company facts: reverse charge bills of a vendor with no state are counted, once per bill, from the rows', () => {
  const f = companyFactsOf({ bills: [
    { doc: 'B1', reverseCharge: true, noState: true }, { doc: 'B1', reverseCharge: true, noState: true }, // two lines of one bill
    { doc: 'B2', reverseCharge: true, noState: false }, { doc: 'B3', reverseCharge: false, noState: true }, { doc: 'B4', reverseCharge: true, noState: true }] });
  assert.deepEqual([f.reverseChargeBills, f.reverseChargeNoState], [3, 2]);
  assert.equal(companyFactsOf({}).reverseChargeNoState, 0);
});
