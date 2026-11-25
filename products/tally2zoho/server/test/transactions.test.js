// Real TallyPrime 7.1 transaction and Trial Balance exports: one "All transactions" file split by voucher type, voucher
// types of the company's own, cancelled / optional / deleted vouchers, both line lists, names with hidden line breaks,
// journal suggestions, and the Trial Balance report with its checks.
// Every value used here is MADE UP (see fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-alltxn-'));
const { buildApp } = await import('../src/index.js');
const { NameSet, matchKey, voucherStatus, ledgerEntryList, voucherBalance } = await import('../src/tally.js');
const { routeVoucherType, voucherTypeMap } = await import('../src/transactions.js');
const { reportBody, flattenTrialBalance, analyseTrialBalance, movementCollector, masterIndex } = await import('../src/trialbalance.js');
const { voucherLines, suggestJournal, buildVoucherOutput } = await import('../src/vouchers.js');
const { createCrossCheck } = await import('../src/crosscheck.js');
const { fieldsNotRead, fieldGroup } = await import('../src/fields.js');
const { parseCsv } = await import('../src/zoho.js');
const { MASTER_RECORDS, mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, LEDGER_FIGURES, QUARTZ, QUARTZ_MASTER, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const byNumber = Object.fromEntries(VOUCHERS.map(v => [v.vouchernumber, v]));
const count = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

test('voucher types are followed up to Tally\'s own type; nothing is guessed', () => {
  const types = voucherTypeMap(MASTER_RECORDS);
  assert.deepEqual(types['Sales - Export'], { parent: 'Sales', reserved: '' });
  assert.deepEqual(types.Sales, { parent: 'Sales', reserved: 'Sales' }, 'Tally\'s own types name themselves as parent');
  const slot = (t, m = types) => { const r = routeVoucherType(t, m); return [r.slot, r.base, r.how]; };
  assert.deepEqual(slot('Sales'), ['sales', 'Sales', 'own']);
  assert.deepEqual(slot('Debit Note'), ['debit_note', 'Debit Note', 'own']);
  assert.deepEqual(slot('Contra', null), ['contra', 'Contra', 'own'], 'Tally\'s own types need no masters');
  assert.deepEqual(slot('Sales - Export'), ['sales', 'Sales', 'master']);
  assert.deepEqual(slot('Sales - Export', null), ['other_vouchers', null, 'unresolved'], 'not guessed from the name when the masters are missing');
  assert.deepEqual(slot('Gate Pass'), ['other_vouchers', null, 'unresolved']);
  assert.deepEqual(slot('Memorandum'), ['other_vouchers', 'Memorandum', 'no_dataset']);
  // two levels of the company's own types, a renamed Tally type (recognised by its reserved name), and a chain that loops
  const more = { 'Export - Sea': { parent: 'Sales - Export', reserved: '' }, 'Sales - Export': { parent: 'Sales', reserved: '' }, 'Tax Invoice': { parent: 'Tax Invoice', reserved: 'Sales' },
    A: { parent: 'B', reserved: '' }, B: { parent: 'A', reserved: '' } };
  assert.deepEqual([slot('Export - Sea', more), slot('Tax Invoice', more), slot('A', more)], [['sales', 'Sales', 'master'], ['sales', 'Sales', 'master'], ['other_vouchers', null, 'unresolved']]);
});

test('voucher lines: either list is read, both lists are never added up blindly; status flags; names with hidden characters', () => {
  assert.equal(ledgerEntryList(byNumber['S-1']).used, 'ledgerentries');
  assert.equal(ledgerEntryList(byNumber['J-1']).used, 'allledgerentries');
  assert.deepEqual(voucherLines(byNumber['S-1']).map(l => [l.ledger, l.amount.toFixed(2), l.party]), [['Maple Leaf Traders', '-1180.00', true], ['Domestic Sales', '1000.00', false], ['Output CGST', '180.00', false]]);
  // the same lines in both lists: read once
  const twice = { ...byNumber['J-1'], ledgerentries: byNumber['J-1'].allledgerentries };
  assert.deepEqual([ledgerEntryList(twice).both, ledgerEntryList(twice).used, voucherLines(twice).length, voucherBalance(twice).ok], [true, 'allledgerentries', 3, true]);
  // the lists complete each other: only together do they balance
  const parts = { ...byNumber['J-1'], allledgerentries: byNumber['J-1'].allledgerentries.slice(0, 2), ledgerentries: byNumber['J-1'].allledgerentries.slice(2) };
  assert.deepEqual([ledgerEntryList(parts).used, voucherLines(parts).length, voucherBalance(parts).ok], ['both lists together', 3, true]);

  assert.deepEqual(['J-1', 'J-5', 'J-6', 'R-2'].map(k => voucherStatus(byNumber[k])), [null, 'cancelled', 'optional', 'deleted']);
  assert.equal(voucherStatus({ iscancelled: 'Yes' }), 'cancelled');

  assert.equal(matchKey(QUARTZ_MASTER), QUARTZ);
  const set = new NameSet([QUARTZ_MASTER, 'Birch Supplies']);
  assert.deepEqual([set.has(QUARTZ), set.has(QUARTZ_MASTER), set.canonical(QUARTZ), set.has('quartz freight lines'), set.has('Other')], [true, true, QUARTZ_MASTER, false, false]);

  // the cross-check treats the two spellings as one ledger, reports it once, and counts how names matched
  const masters = { customers: ['Maple Leaf Traders'], vendors: ['Birch Supplies', QUARTZ_MASTER], accounts: ['Staff Tea Expenses', 'Cash'], taxes: ['TDS Payable'] };
  const c = createCrossCheck({ masters, items: null, units: null });
  c.add({ id: 1, slot: 'journal', name: 'Journal J-2', data: byNumber['J-2'] });
  c.add({ id: 2, slot: 'journal', name: 'Journal X', data: { allledgerentries: [{ ledgername: 'Nobody Ltd', amount: '-1.00' }, { ledgername: 'Cash', amount: '1.00' }] } });
  const out = c.finish([]);
  assert.deepEqual(out.map(o => [o.kind, o.name, o.uses]), [['ledger_missing', 'Nobody Ltd', 1], ['ledger_name_hidden_characters', QUARTZ, 1]]);
  assert.deepEqual(c.stats(), { names: 5, exact: 3, ignoringHidden: 1, notFound: 1 });
});

test('journal suggestions carry their reason; cancelled and optional vouchers are never written', () => {
  const customers = new NameSet(['Maple Leaf Traders', 'Pine Hill Stores']), vendors = new NameSet(['Birch Supplies', QUARTZ_MASTER]), taxLedgers = new NameSet(['Input CGST', 'TDS Payable', 'Output CGST']);
  const kinds = { 'Staff Tea Expenses': 'expense', 'Input CGST': 'tax', 'TDS Payable': 'tax', Cash: 'bank', 'Bank of Example': 'bank', 'Domestic Sales': 'income', 'Owner Capital': 'other' };
  const kindOf = name => kinds[matchKey(name)] ?? (customers.has(name) ? 'customer' : vendors.has(name) ? 'vendor' : null);
  const s = v => suggestJournal(v, customers, vendors, { kindOf, taxLedgers });
  let r = s(byNumber['J-1']);
  assert.deepEqual([r.suggested, r.clear], ['Bill', true]);
  assert.match(r.reason, /Vendor "Birch Supplies" is the only vendor ledger and is credited, with 1 expense, purchase or asset ledger and 1 tax ledger debited/);
  r = s(byNumber['J-2']);
  assert.deepEqual([r.suggested, r.clear], ['Bill', true], 'the vendor is found although the master\'s name ends in a line break');
  assert.match(r.reason, /1 tax ledger is credited as well .* written as a negative row, not as a tax on the bill, so check this before you approve/); // changed on purpose: it is not a tax line
  assert.deepEqual([r.needsCheck, s(byNumber['J-1']).needsCheck, s(byNumber['J-4']).needsCheck], [true, false, false]);
  assert.deepEqual([s(byNumber['J-3']).suggested, s(byNumber['J-3']).clear], ['Manual Journal', true]);
  r = s(byNumber['J-4']);
  assert.deepEqual([r.suggested, r.clear], ['Manual Journal', false]);
  assert.match(r.reason, /1 vendor ledger debited.*Please review\.$/);
  // a customer debited against an expense ledger is not a sale; a vendor credited against a capital ledger is not a purchase
  const jv = (...lines) => ({ allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
  assert.deepEqual([s(jv(['Maple Leaf Traders', '-10.00'], ['Staff Tea Expenses', '10.00'])).suggested, s(jv(['Maple Leaf Traders', '-10.00'], ['Staff Tea Expenses', '10.00'])).clear], ['Manual Journal', false]);
  assert.deepEqual([s(jv(['Maple Leaf Traders', '-10.00'], ['Domestic Sales', '10.00'])).suggested, s(jv(['Owner Capital', '-10.00'], ['Birch Supplies', '10.00'])).clear], ['Invoice', false]);
  assert.equal(s(jv(['Staff Tea Expenses', '-10.00'], ['Birch Supplies', '4.00'], ['Cash', '6.00'])).clear, false, 'a bank or cash ledger on the voucher: not a plain purchase');
  // without ledger kinds the earlier rule still holds
  assert.equal(suggestJournal(byNumber['J-1'], customers, vendors).suggested, 'Bill');

  const recs = ['S-1', 'J-1', 'J-5', 'J-6'].map((k, i) => ({ id: i + 1, source_id: k, name: k, slot: k.startsWith('S') ? 'sales' : 'journal', data: byNumber[k], decision: 'Bill' }));
  const built = buildVoucherOutput(recs, { customers, vendors, taxLedgers });
  assert.deepEqual([built.invoices.vouchers, built.bills.vouchers, built.excluded], [1, 1, 2]);
  // B6: only the "left out" kinds are looked at here (the document flags are tested in vouchers.test.js)
  assert.deepEqual(built.exceptions.filter(e => /^left_out/.test(e.kind || '')).map(e => [e.rec.name, e.kind]), [['J-5', 'left_out_cancelled'], ['J-6', 'left_out_optional']]);
});

test('the Trial Balance report is flattened, matched to ledgers and groups, and checked against the vouchers', () => {
  const body = reportBody(trialBalanceReport());
  assert.ok(body && reportBody({ tallymessage: [] }) === null);
  const flat = flattenTrialBalance(body);
  assert.equal(flat.lines.length, 5 + 7 + 13, '5 top-level groups, 7 groups below them, 13 ledgers');
  assert.equal(flat.maxDepth, 3);
  const line = name => flat.lines.find(l => l.metadata.name === name);
  // numbers become exact decimal text; a debit is negative; an empty amount object is no figure
  assert.deepEqual([line('Maple Leaf Traders').openingbalance, line('Maple Leaf Traders').debittotal, line('Maple Leaf Traders').credittotal, line('Maple Leaf Traders').closingbalance], ['-1500.5', '1180', '1180', '-1500.5']);
  assert.deepEqual([line(QUARTZ).openingbalance, line(QUARTZ).debittotal, line(QUARTZ).credittotal, line(QUARTZ).closingbalance], ['', '', '270.07', '270.07']);
  assert.deepEqual([line('Pine Hill Stores').depth, line('Pine Hill Stores').haschildren, flat.lines[line('Pine Hill Stores').parentline - 1].metadata.name], [3, false, 'Hill Region Debtors']);
  assert.deepEqual(flat.unread, {});
  // a figure the file cannot hold to two decimals is noted; other shapes of the report are read too
  const odd = flattenTrialBalance(reportBody({ DSPACCBODY: { dspaccline: { dspaccname: { dspdispname: 'Cash', other: 1 }, extra: 'x',
    dspaccinfo: { dspopamt: { dspopamta: 0.1 + 0.2 }, dspdramt: { dspdramta: '1,234.50 Dr' }, dspcramt: {}, dspclamt: { dspclamta: -1234.2 } } } } }));
  assert.deepEqual([odd.lines[0].openingbalance, odd.lines[0].debittotal, odd.lines[0].closingbalance], ['0.30000000000000004', '1234.5', '-1234.2']);
  assert.match(odd.lines[0].notes[0], /opening balance has more than two decimals/);
  assert.deepEqual(odd.unread, { 'dspaccline.extra': 1, 'dspaccname.other': 1 });

  // the movement of every ledger, from the vouchers Tally posts
  const movement = movementCollector();
  // S4 (TALLY-002): the custom type Gate Pass carries ledger amounts, so it posts (and is written as a Manual Journal); Memorandum never posts
  for (const v of VOUCHERS) if (!voucherStatus(v) && !['Memorandum'].includes(v.vouchertypename)) movement.add(voucherLines(v));
  const masters = masterIndex(MASTER_RECORDS.map(r => ({ type: r.metadata.type, data: r })));
  let a = analyseTrialBalance({ lines: flat.lines, ...masters, movement });
  assert.deepEqual([a.summary.lines, a.summary.topLevelLines, a.summary.levels, a.summary.ledgers, a.summary.groups, a.summary.unmatched], [25, 5, 4, 13, 12, 0]);
  assert.deepEqual([a.summary.atLedgerLevel, a.summary.lowestLines, a.summary.lowestLedgers, a.summary.matchedIgnoringHidden], [true, 13, 13, 1]);
  assert.deepEqual([a.summary.totals.openingBalanced, a.summary.totals.closingBalanced, a.summary.totals.openingDebit, a.summary.totals.closingCredit], [true, true, '4500.50', '6100.57']);
  assert.deepEqual(a.summary.movement, { checked: 25, agree: 25, differ: 0, notChecked: 0, vouchers: 11, excludedVouchers: 0, otherVouchers: 0, unreadableLines: 0 });
  assert.deepEqual(a.summary.closingArithmetic, { agree: 25, differ: 0 });
  const q = a.lines.find(l => l.name === QUARTZ);
  assert.deepEqual([q.matchType, q.matchName, q.matchHow], ['ledger', QUARTZ_MASTER, 'hidden'], 'matched although the master\'s name ends in a line break; neither value is changed');
  assert.deepEqual(a.flags.map(f => f.kind), ['trial_balance_name_hidden_characters']);
  const sd = a.lines.find(l => l.name === 'Sundry Debtors');
  assert.deepEqual([sd.matchType, sd.ledgers, sd.movementDebit, sd.movementCredit, sd.movementOk], ['group', 2, '1680.00', '1180.00', true], 'a group: the ledgers under it at any depth');

  // one figure deliberately wrong: the debit total of Cash
  const wrong = trialBalanceReport();
  const cash = wrong.dspaccbody.dspaccline[1].grpexplosion.dspaccline[2].grpexplosion.dspaccline[0];
  assert.equal(cash.dspaccname.dspdispname, 'Cash');
  cash.dspaccinfo[0].dspdramt.dspdramta = -250;
  a = analyseTrialBalance({ lines: flattenTrialBalance(reportBody(wrong)).lines, ...masters, movement });
  assert.deepEqual([a.summary.movement.agree, a.summary.movement.differ, a.summary.closingArithmetic.differ], [24, 1, 1]);
  const flag = a.flags.find(f => f.kind === 'trial_balance_movement_differs');
  assert.equal(flag.name, 'Cash');
  assert.match(flag.message, /the report shows debits 250\.00 and credits 55\.00 for the period, but the vouchers stored add up to debits 200\.00 and credits 55\.00 \(difference: debits 50\.00, credits 0\.00\)/);
  assert.ok(a.flags.some(f => f.kind === 'trial_balance_closing_differs' && f.name === 'Cash'));

  // a name that is both a ledger and a group, both directly under the same group: the vouchers decide which one the line is
  const twins = { ledgers: [{ name: 'Travel', parent: 'Indirect Expenses' }, { name: 'Air Fares', parent: 'Travel' }], groups: [{ name: 'Indirect Expenses', parent: '', reserved: 'Indirect Expenses' }, { name: 'Travel', parent: 'Indirect Expenses', reserved: '' }] };
  const twinLines = flattenTrialBalance(reportBody({ dspaccbody: { dspaccline: [{ dspaccname: { dspdispname: 'Indirect Expenses' }, dspaccinfo: [{ dspopamt: {}, dspdramt: { dspdramta: -40 }, dspcramt: {}, dspclamt: { dspclamta: -40 } }],
    grpexplosion: { dspaccline: [{ dspaccname: { dspdispname: 'Travel' }, dspaccinfo: [{ dspopamt: {}, dspdramt: { dspdramta: -40 }, dspcramt: {}, dspclamt: { dspclamta: -40 } }] }] } }] } })).lines;
  const twinMovement = movementCollector();
  twinMovement.add(voucherLines({ allledgerentries: [{ ledgername: 'Air Fares', amount: '-40.00' }, { ledgername: 'Somewhere', amount: '40.00' }] }));
  a = analyseTrialBalance({ lines: twinLines, ...twins, movement: twinMovement });
  assert.deepEqual([a.lines[1].matchType, a.lines[1].movementOk, a.summary.atLedgerLevel], ['group', true, false]);
  assert.match(a.lines[1].notes[0], /"Travel" is the name of both a ledger and a group in the masters\. The line was read as the group, because the vouchers agree/);
  assert.equal(analyseTrialBalance({ lines: twinLines, ...twins }).lines[1].matchType, 'ledger', 'without vouchers nothing decides: read as the ledger, and said so');

  // groups with one level opened: not at ledger level; a top-level line left out: the totals do not balance
  a = analyseTrialBalance({ lines: flattenTrialBalance(reportBody(trialBalanceReport({ depth: 1 }))).lines, ...masters, movement });
  assert.deepEqual([a.summary.lines, a.summary.atLedgerLevel, a.summary.lowestGroups, a.summary.movement.differ], [14, false, 6, 0]);
  assert.ok(a.flags.some(f => f.kind === 'trial_balance_not_ledger_level' && /press Alt\+F5/.test(f.message)));
  const cut = trialBalanceReport(); cut.dspaccbody.dspaccline.pop();
  a = analyseTrialBalance({ lines: flattenTrialBalance(reportBody(cut)).lines, ...masters, movement });
  assert.deepEqual([a.summary.totals.openingBalanced, a.summary.totals.closingBalanced], [true, false]);
  assert.match(a.flags.find(f => f.kind === 'trial_balance_totals').message, /closing balances of the Trial Balance do not balance: over its 4 top-level lines the debit balances total 4945\.50 and the credit balances total 6100\.57/); // S4: Gate Pass credits Cash 5.00
});

test('fields not transferred from a real voucher are listed in groups', () => {
  const r = fieldsNotRead([byNumber['S-1'], byNumber['P-1'], byNumber['J-5']], 'sales');
  const names = r.groups.flatMap(g => g.fields.map(f => f.name));
  assert.equal(names.length, r.count);
  for (const read of ['date', 'guid', 'vouchernumber', 'partyledgername', 'narration', 'iscancelled', 'vchstatusiscancelled', 'ledgerentries.ledgername', 'allledgerentries.amount', 'ledgerentries.ispartyledger']) assert.ok(!names.includes(read), read);
  assert.deepEqual(['ledgerentries.billallocations', 'allledgerentries.bankallocations', 'partygstin', 'placeofsupply', 'effectivedate', 'cmpgstin', 'ledgerentries.ratedetails', 'masterid', 'ledgerentries.udf:userdescription', 'iseligibleforitc'].map(fieldGroup),
    ['Bill-wise and bank details', 'Bill-wise and bank details', 'Party, address and place of supply', 'Party, address and place of supply', 'Reference numbers and dates', 'GST, tax and other statutory details',
      'GST, tax and other statutory details', 'Tally internal (identifiers, numbering, screen view)', 'Other details on the voucher lines', 'GST, tax and other statutory details']);
  // changed on purpose in B6: placeofsupply, reference, cmpgststate and the line rates (ratedetails) are read for the Invoices and Bills files
  // changed on purpose in B8: the bill-wise details (billallocations: name, bill type, amount) are read for payments and notes
  for (const f of ['allledgerentries.bankallocations', 'partygstin', 'effectivedate', 'ledgerentries.isdeemedpositive']) assert.ok(names.includes(f), f);
  for (const f of ['placeofsupply', 'cmpgststate', 'ledgerentries.ratedetails', 'ledgerentries.ratedetails.gstrate', 'ledgerentries.billallocations', 'ledgerentries.billallocations.name']) assert.ok(!names.includes(f), f);
  assert.ok(r.groups.every(g => g.fields.length > 0) && r.groups.length >= 5);
});

// ---------- end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const csvRows = async (id, key) => { const r = await call({ url: `/api/migrations/${id}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };

test('All Transactions file and Trial Balance report, end to end', async () => {
  const u = seed.users.find(x => x.role === 'analyst');
  const lr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  cookie = String(lr.headers['set-cookie']).split(';')[0];
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Sample Masters Co', financialYear: '2024-25' } })).json().id;
  const base = `/api/migrations/${id}`;
  const comp = async () => { const c = await get(`${base}/completeness`); return { c, slot: k => c.slots.find(s => s.key === k) }; };

  // a masters file is not a Transactions export
  let r = await put(id, 'all_transactions', mastersDoc(), 'Master.json');
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /has no vouchers, so it does not look like a Transactions export/);

  // ---- uploaded BEFORE the masters: the company's own voucher type cannot be traced yet, and is not guessed ----
  r = await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json');
  assert.equal(r.statusCode, 200, r.body);
  let up = r.json();
  assert.deepEqual([up.encoding, up.records, up.vouchers], ['utf16le', VOUCHERS.length, VOUCHERS.length]);
  assert.deepEqual(Object.fromEntries(up.datasets.map(d => [d.slot, d.records])), { sales: 1, receipt: 2, payment: 1, journal: 6, contra: 1, debit_note: 1, other_vouchers: 3 });
  assert.deepEqual(up.autoNotApplicable.map(x => x.slot), ['purchase', 'credit_note']);
  assert.ok(up.messages.some(m => /1 voucher of type "Sales - Export": this is not one of Tally's own voucher types.*no All Masters file with Voucher Type records has been uploaded/.test(m)), up.messages.join(' | '));
  assert.deepEqual(up.statuses, { cancelled: 1, optional: 1, deleted: 1 });
  // changed on purpose in B8: receipts, payments, contra and notes go to Manual Journals or wait for Zoho's samples
  assert.ok(up.messages.some(m => /Read and kept; no Zoho file is created for these yet: Other Voucher Types \(3\)/.test(m)), up.messages.join(' | '));
  assert.ok(up.messages.some(m => /^Receipt Vouchers \(2\), Payment Vouchers \(1\), Contra Vouchers \(1\), Debit Notes \(1\): contra vouchers, .* are written as Manual Journals\. .*are written as Manual Journals too, on Accounts Receivable or Accounts Payable with the contact, so every voucher is in a file\. The list credits_to_apply\.csv says which invoice or bill each one pays/.test(m)), up.messages.join(' | '));

  // ---- the All Masters file arrives: the kept Transactions file is sorted again ----
  r = await put(id, 'all_masters', mastersDoc(), 'Master.json');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().voucherTypes, 11);
  assert.ok(r.json().messages.some(m => /The All Transactions file "Transactions\.json" was sorted again, because the All Masters file "Master\.json" was uploaded: Sales Vouchers 2,/.test(m)), r.json().messages.join(' | '));
  let { c, slot } = await comp();
  const at = c.allTransactions;
  assert.deepEqual([at.fileName, at.encodingName, at.vouchers, at.mastersUsed], ['Transactions.json', 'UTF-16 (little endian)', 15, true]);
  assert.deepEqual(at.datasets.map(d => [d.slot, d.records, d.current]), [['sales', 2, true], ['purchase', 0, false], ['receipt', 2, true], ['payment', 1, true], ['journal', 6, true], ['contra', 1, true], ['debit_note', 1, true], ['credit_note', 0, false], ['other_vouchers', 2, true]]);
  assert.deepEqual(at.datasets[0].types, [{ type: 'Sales', vouchers: 1, base: 'Sales', how: 'own' }, { type: 'Sales - Export', vouchers: 1, base: 'Sales', how: 'master' }]);
  assert.deepEqual([at.customTypes, at.unresolvedTypes, at.otherTallyTypes], [[{ type: 'Sales - Export', vouchers: 1, base: 'Sales' }], [{ type: 'Gate Pass', vouchers: 1 }], [{ type: 'Memorandum', vouchers: 1, base: 'Memorandum' }]]);
  assert.equal(slot('sales').upload.sha256, at.sha256, 'each dataset carries the checksum of the file it came from');
  assert.deepEqual([slot('sales').upload.fromAllTransactions, slot('sales').upload.fromAllMasters, slot('customers').upload.fromAllMasters, slot('customers').upload.fromAllTransactions], [true, false, true, false]);
  assert.ok(slot('sales').upload.warnings.some(w => /1 voucher\(s\) of type "Sales - Export" were read as Sales vouchers/.test(w)));
  // Purchase has no vouchers in the file: confirmed empty by the file, with the reason; it no longer blocks
  assert.deepEqual([slot('purchase').status, slot('purchase').autoNotApplicable, slot('purchase').requirement], ['not_applicable', true, 'required']);
  assert.match(slot('purchase').waiver.reason, /^Set automatically: the All Transactions file "Transactions\.json" has no Purchase vouchers, and that file holds every voucher of the period.*purchases as journals/);
  // changed on purpose in B8: contra vouchers are written as Manual Journals, so the dataset is no longer "no Zoho file"
  assert.deepEqual([slot('credit_note').status, slot('contra').requirement, slot('contra').noZohoFile, slot('other_vouchers').noZohoFile.slice(0, 55)], ['not_applicable', 'optional', null, 'Read and kept. A voucher of these types that posts to t']); // S4 (TALLY-002)
  assert.ok(!c.missingRequired.includes('Purchase Vouchers'));
  // by hand a required dataset still cannot be marked not applicable, and an optional one need not be
  assert.equal((await call({ method: 'PUT', url: `${base}/waivers/sales`, payload: { reason: 'x' } })).statusCode, 400);
  assert.match((await call({ method: 'PUT', url: `${base}/waivers/contra`, payload: { reason: 'x' } })).json().error, /optional: it never blocks/);
  // fields not transferred are given in groups for the voucher datasets
  // changed on purpose in B8: the bill-wise details are read, so the journals (which carry no bank details) no longer list that group; the payment's bank details still do
  assert.ok(slot('payment').upload.fieldsNotRead.groups.some(g => g.name === 'Bill-wise and bank details'));
  assert.ok(!slot('journal').upload.fieldsNotRead.groups.some(g => g.name === 'Bill-wise and bank details'));

  // ---- the Trial Balance report (three levels of groups, every ledger listed) ----
  r = await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json');
  assert.equal(r.statusCode, 200, r.body);
  let tb = r.json().trialBalance;
  assert.deepEqual([r.json().records, tb.lines, tb.ledgers, tb.groups, tb.unmatched, tb.atLedgerLevel, tb.levels, tb.encoding], [25, 25, 13, 12, 0, true, 4, 'utf16le']);
  assert.match(tb.description, /^25 lines read from the Tally Trial Balance report \(5 top-level lines, 4 levels\)\. 13 are ledgers, 12 are groups\. The report is at ledger level: every lowest line is a ledger\.$/);
  assert.equal(r.json().fieldsNotRead.count, 0);
  ({ c, slot } = await comp());
  assert.equal(slot('trial_balance').upload.trialBalance.atLedgerLevel, true);
  assert.deepEqual([c.ready, c.missingRequired, c.awaitingConfirmation], [false, [], ['Stock Summary']]);
  await call({ method: 'PUT', url: `${base}/waivers/stock_summary`, payload: { reason: 'Not needed for test' } });

  // ---- process ----
  r = await call({ method: 'POST', url: `${base}/process?wait=1` });
  assert.equal(r.statusCode, 200, r.body);
  const sum = Object.fromEntries(r.json().summary.map(s => [s.slot, s.stored]));
  assert.deepEqual([sum.sales, sum.receipt, sum.payment, sum.journal, sum.contra, sum.debit_note, sum.other_vouchers, sum.trial_balance, sum.purchase], [2, 2, 1, 6, 1, 1, 2, 25, undefined]);
  assert.deepEqual(r.json().ledgerNames, { names: 12, exact: 11, ignoringHidden: 1, notFound: 0 });
  assert.deepEqual(r.json().vouchersNotPosted, { cancelled: 1, optional: 1, deleted: 1 });
  let exc = (await get(`${base}/summary`)).exceptions;
  const kinds = stage => count(exc.filter(e => e.stage === stage && e.kind), e => e.kind);
  assert.deepEqual([kinds('process').voucher_cancelled, kinds('process').voucher_optional, kinds('process').voucher_deleted], [1, 1, 1]);
  assert.ok(!exc.some(e => /no ledger entries|differ by/.test(e.message)), 'a cancelled voucher without lines is not reported as unbalanced');
  const cc = kinds('crosscheck');
  assert.deepEqual([cc.ledger_missing, cc.ledger_name_hidden_characters, cc.voucher_type_not_resolved, cc.voucher_type_no_dataset, cc.trial_balance_name_hidden_characters, cc.trial_balance_movement_differs, cc.trial_balance_totals, cc.trial_balance_not_ledger_level],
    [undefined, 1, 1, 1, 1, undefined, undefined, undefined]);
  assert.match(exc.find(e => e.kind === 'voucher_type_not_resolved').message, /1 voucher of type "Gate Pass".*could not be traced to one through the Voucher Type records.*Nothing was guessed from the name/);
  assert.equal(exc.find(e => e.kind === 'ledger_name_hidden_characters').name, QUARTZ);

  // ---- the Trial Balance as stored: an indented table with the checks ----
  let t = await get(`${base}/trial-balance`);
  assert.equal(t.shape, 'report');
  assert.deepEqual([t.lines.length, t.summary.movement.checked, t.summary.movement.agree, t.summary.movement.differ, t.summary.movement.excludedVouchers, t.summary.movement.otherVouchers], [25, 25, 25, 0, 3, 1]); // S4: only the Memorandum voucher posts nothing
  assert.deepEqual([t.summary.totals.openingBalanced, t.summary.totals.closingBalanced, t.summary.atLedgerLevel], [true, true, true]);
  const staff = t.lines.find(l => l.name === 'Staff Tea Expenses');
  assert.deepEqual([staff.depth, staff.debit, staff.credit, staff.closing, staff.movementDebit, staff.movementCredit, staff.movementOk, staff.closingOk, staff.matchType],
    [2, '1355.07', '200', '-1155.07', '1355.07', '200.00', true, true, 'ledger'], 'the optional journal (999.00) and the Memorandum voucher are not in the movement; the Gate Pass voucher posts (S4, TALLY-002)');

  // ---- Data Explorer: vouchers of either view show their lines, and the new datasets are there ----
  const recs = async k => (await get(`${base}/records?slot=${k}`)).records;
  assert.deepEqual((await recs('contra')).map(x => [x.name, x.view.voucherType, x.view.lines.length, x.view.total, x.view.linesFrom]), [['Contra C-1', 'Contra', 2, '200.00', 'allledgerentries']]);
  assert.deepEqual((await recs('debit_note')).map(x => [x.view.lines.length, x.view.linesFrom]), [[3, 'ledgerentries']]);
  assert.deepEqual((await recs('journal')).map(x => x.view.notPosted), [null, null, null, null, 'cancelled', 'optional']);
  assert.deepEqual((await recs('other_vouchers')).map(x => x.view.voucherType), ['Memorandum', 'Gate Pass']);

  // ---- journals: every suggestion has its reason and waits for approval; cancelled and optional ones need none ----
  let journals = await get(`${base}/journals`);
  assert.deepEqual(journals.map(j => [j.number, j.suggested, j.clear, j.notPosted, j.decision]),
    [['J-1', 'Bill', true, null, null], ['J-2', 'Bill', true, null, null], ['J-3', 'Manual Journal', true, null, null], ['J-4', 'Manual Journal', false, null, null], ['J-5', 'Manual Journal', true, 'cancelled', null], ['J-6', 'Bill', true, 'optional', null]]);
  assert.ok(journals.every(j => j.reason));
  assert.equal((await call({ method: 'PUT', url: `${base}/journals/${journals[4].id}`, payload: { decision: 'Bill' } })).statusCode, 409);
  // changed on purpose: "accept" approves only the clear suggestions that carry no warning. The Bill with a tax ledger
  // credited is accepted as its own, named group; the journal marked "please review" is decided by hand.
  assert.deepEqual((await call({ method: 'POST', url: `${base}/journals/accept-suggestions` })).json(), { accepted: 2, group: 'clear', leftForReview: { needsCheck: 1, notClear: 1 } });
  assert.deepEqual((await call({ method: 'POST', url: `${base}/journals/accept-suggestions`, payload: { group: 'needs_check' } })).json(), { accepted: 1, group: 'needs_check', leftForReview: { needsCheck: 0, notClear: 1 } });
  r = await call({ method: 'PUT', url: `${base}/journals/${journals[3].id}`, payload: { decision: 'Bill' } });
  assert.equal(r.statusCode, 409, 'a journal with the vendor debited cannot be routed to Bill');
  assert.match(r.json().error, /cannot be routed to Bill: the vendor "Birch Supplies" is debited on this voucher, so it is not a bill/);
  assert.equal((await call({ method: 'PUT', url: `${base}/journals/${journals[3].id}`, payload: { decision: 'Manual Journal' } })).statusCode, 200);
  assert.deepEqual((await get(`${base}/report`)).journals, { total: 4, notPosted: 2, decided: 4, overridden: 0 });

  // ---- files ----
  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  const files = Object.fromEntries(r.json().files.map(f => [f.key, f]));
  assert.deepEqual([files.invoices.vouchers, files.bills.vouchers, files.journals.vouchers], [2, 2, 3]); // S4 (TALLY-002): Gate Pass is a Manual Journal
  const inv = await csvRows(id, 'invoices');
  // changed on purpose in B6: Zoho's layouts, one row per line; the GST is on its line (here not mapped, so its cells are empty)
  // v2 (changed on purpose): a line of an export with no GST carries Zoho's zero-rate IGST0
  assert.deepEqual(inv.map(x => [x['Invoice Number'], x['Customer Name'], x.Account, x['Item Price'], x['Item Tax']]),
    [['S-1', 'Maple Leaf Traders', 'Domestic Sales', '1000.00', ''], ['SE-1', 'Pine Hill Stores', 'Export Sales', '500.00', 'IGST0']],
    'invoice-view vouchers (lines in "ledgerentries") and the company\'s own sales type both become invoices');
  const bills = await csvRows(id, 'bills');
  // v2 (changed on purpose): J-1 carries the supplier's invoice number from Tally (its reference, B-77) as Bill Number,
  // without anyone choosing it (default 9); the Bills file has no Item Total column, so the line amount is in Rate (default 10).
  assert.deepEqual(bills.map(x => [x['Bill Number'], x['Vendor Name'], x.Account, x.Rate, x['Tax Amount']]),
    // changed on purpose (pick and drop): the vendor is written with its name exactly as the masters have it (with the
    // line break), the same value as in the Vendors file, although the voucher names it without the line break
    [['B-77', 'Birch Supplies', 'Staff Tea Expenses', '1000.00', ''], ['J-2', QUARTZ_MASTER, 'Staff Tea Expenses', '300.07', ''], ['J-2', QUARTZ_MASTER, 'TDS Payable', '-30.00', '']]); // a tax ledger credited on a bill with no Tally type TDS: a negative line
  assert.ok((await csvRows(id, 'vendors')).some(v => v['Display Name'] === QUARTZ_MASTER), 'the same raw name in the Vendors file');
  assert.deepEqual([...new Set((await csvRows(id, 'journals')).map(x => x['Reference Number']))], ['J-3', 'J-4', 'GP-1'], 'the cancelled and the optional journal are not written; the Gate Pass voucher posts, so it is a Manual Journal (S4, TALLY-002)');
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  // changed on purpose in B8: receipts are now routed too, so the deleted receipt is left out with its kind like the journals
  assert.deepEqual(exc.filter(e => /^left_out_/.test(e.kind || '')).map(e => [e.name, e.kind]), [['Journal J-5', 'left_out_cancelled'], ['Journal J-6', 'left_out_optional'], ['Receipt R-2', 'left_out_deleted']]);
  assert.ok(!exc.some(e => /could not identify|lines total/.test(e.message)), exc.map(e => e.message).join(' | '));
  // Opening Balances: the report is at ledger level, so the file is built from the opening balance column of the ledger lines
  assert.deepEqual(await csvRows(id, 'opening_balances'),
    [{ Account: 'Owner Capital', Debit: '', Credit: '2000.50' }, { Account: 'Maple Leaf Traders', Debit: '1500.50', Credit: '' }, { Account: 'Bank of Example', Debit: '3000.00', Credit: '' }, { Account: 'Birch Supplies', Debit: '', Credit: '2500.00' }]);
  assert.match(files.opening_balances.notes, /Opening Balance column of 4 ledger line\(s\)/);
  assert.ok(!exc.some(e => /Opening balances do not balance/.test(e.message)));
  // the test report names the new datasets and checks
  let rep = await get(`${base}/test-report`);
  assert.deepEqual(rep.processing.vouchers.find(v => v.slot === 'journal'), { slot: 'journal', name: 'Journal Vouchers', vouchers: 6, cancelled: 1, optional: 1, deleted: 0, zohoFile: 'Invoices, Bills or Manual Journals' });
  assert.equal(rep.processing.vouchers.find(v => v.slot === 'contra').zohoFile, 'Manual Journals'); // changed on purpose in B8: contra vouchers are Manual Journals
  assert.deepEqual([rep.processing.ledgerNamesOnVouchers.ignoringHidden, rep.processing.trialBalance.movement.agree, rep.filesHoldingSeveralDatasets.allTransactions.vouchers, rep.decisions.journalRouting.undecided], [1, 25, 15, 0]);
  assert.equal(rep.datasets.find(d => d.key === 'trial_balance').trialBalanceReport.atLedgerLevel, true);

  // ---- a Trial Balance with one wrong figure: flagged with the figures ----
  const wrong = trialBalanceReport();
  wrong.dspaccbody.dspaccline[1].grpexplosion.dspaccline[2].grpexplosion.dspaccline[0].dspaccinfo[0].dspdramt.dspdramta = -250;
  assert.equal((await put(id, 'trial_balance', wrong, 'TrialBal-wrong.json')).statusCode, 200);
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.slot === 'trial_balance');
  assert.deepEqual(exc.filter(e => e.kind === 'trial_balance_movement_differs').map(e => e.name), ['Cash']);
  assert.match(exc.find(e => e.kind === 'trial_balance_movement_differs').message, /debits 250\.00 and credits 55\.00 .* debits 200\.00 and credits 55\.00/);
  t = await get(`${base}/trial-balance`);
  assert.deepEqual([t.summary.movement.agree, t.summary.movement.differ, t.lines.find(l => l.name === 'Cash').movementOk], [24, 1, false]);

  // ---- groups with one level opened (like a Trial Balance exported without Alt+F5): no Opening Balances file ----
  r = await put(id, 'trial_balance', trialBalanceReport({ depth: 1 }), 'TrialBal-groups.json');
  assert.equal(r.statusCode, 200, r.body);
  tb = r.json().trialBalance;
  assert.deepEqual([tb.lines, tb.ledgers, tb.groups, tb.atLedgerLevel, tb.lowestGroups], [14, 3, 11, false, 6]);
  assert.ok(r.json().warnings.some(w => /The report is NOT at ledger level: 6 of its 9 lowest lines are groups\. A detailed Trial Balance \(press Alt\+F5/.test(w)), r.json().warnings.join(' | '));
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  exc = (await get(`${base}/summary`)).exceptions;
  assert.equal(exc.filter(e => e.kind === 'trial_balance_not_ledger_level').length, 1);
  assert.equal(exc.filter(e => e.kind === 'trial_balance_movement_differs').length, 0, 'group lines are still checked against the vouchers of the ledgers under them');
  await call({ method: 'POST', url: `${base}/journals/accept-suggestions` });
  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!r.json().files.some(f => f.key === 'opening_balances'), 'no misleading Opening Balances file from group lines');
  const notCreated = (await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'opening_balances_not_created');
  assert.equal(notCreated.length, 1);
  assert.match(notCreated[0].message, /not at ledger level: 6 of its 9 lowest line\(s\) are groups.*press Alt\+F5.*No other figures were used in its place/);
  rep = await get(`${base}/test-report`);
  assert.ok(rep.whatToFixNext.some(f => /Trial Balance uploaded is not at ledger level, so no Opening Balances file is created/.test(f.message)));

  // ---- the made-up sample Trial Balance (a file of lines) is still accepted in the same slot ----
  r = await call({ method: 'PUT', url: `${base}/uploads/trial_balance`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'tb.json' },
    payload: Buffer.from(JSON.stringify({ tallymessage: [{ metadata: { type: 'TrialBalanceLine' }, name: 'Cash', closingbalance: '-10.00' }, { metadata: { type: 'TrialBalanceLine' }, name: 'Owner Capital', closingbalance: '10.00' }] })) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().trialBalance, undefined);

  // ---- separate uploads later: the later file wins for its dataset only ----
  r = await put(id, 'sales', transactionsDoc(), 'mixed.json');
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /"Sales Vouchers" expects only Sales vouchers, but the file contains: /);
  r = await put(id, 'other_vouchers', transactionsDoc([byNumber['GP-1'], byNumber['C-1']]), 'other.json');
  assert.match(r.json().error, /only for vouchers of a type that has no dataset of its own/);
  r = await put(id, 'sales', transactionsDoc([byNumber['SE-1']]), 'export-sales.json');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().replacedAllTransactions, 'Transactions.json');
  assert.match(r.json().warnings[0], /This file replaces the Sales Vouchers that came from the All Transactions file "Transactions\.json"/);
  ({ c, slot } = await comp());
  assert.deepEqual(c.allTransactions.datasets.find(d => d.slot === 'sales'), { ...c.allTransactions.datasets.find(d => d.slot === 'sales'), records: 2, current: false, replacedBy: 'export-sales.json', removed: false });
  // the All Transactions file uploaded again replaces it again, and says so
  r = await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json');
  assert.ok(r.json().messages.some(m => /Sales Vouchers: the file uploaded on its own earlier \("export-sales\.json"\) was replaced by the vouchers from this file/.test(m)));
  // a Purchase file of its own is kept when the All Transactions file has none
  const purchase = { ...byNumber['J-1'], metadata: { ...byNumber['J-1'].metadata, vchtype: 'Purchase' }, vouchertypename: 'Purchase' };
  assert.equal((await put(id, 'purchase', transactionsDoc([purchase]), 'purchase.json')).statusCode, 200);
  r = await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json');
  assert.ok(r.json().messages.some(m => /Purchase Vouchers: this file has no Purchase vouchers\. The file uploaded on its own earlier \("purchase\.json"\) is kept/.test(m)));
  assert.deepEqual(r.json().autoNotApplicable.map(x => x.slot), ['credit_note']);

  // ---- removing the All Transactions file removes its datasets and its automatic marks ----
  r = await call({ method: 'DELETE', url: `${base}/uploads/all_transactions` });
  assert.equal(r.statusCode, 200);
  ({ c, slot } = await comp());
  assert.equal(c.allTransactions, null);
  assert.deepEqual(['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'credit_note'].map(k => slot(k).status), ['missing', 'uploaded', 'missing', 'missing', 'missing', 'missing', 'missing']);
  assert.deepEqual(c.missingRequired, ['Sales Vouchers', 'Receipt Vouchers', 'Payment Vouchers', 'Journal Vouchers'], 'without the file, the standard voucher datasets are required again');
  assert.equal(slot('customers').status, 'uploaded', 'master datasets are untouched');
  const trail = (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok(trail.some(x => /^upload_all_transactions \| Transactions\.json, 15 vouchers \(UTF-16 \(little endian\)\), sha256 [a-f0-9]{12}: Sales Vouchers 1, Receipt Vouchers 2/.test(x)), trail.join('\n'));
  assert.ok(trail.some(x => /^all_transactions_sorted_again \| /.test(x)));

  // ---- removing the All Masters file: the company's own voucher type can no longer be traced ----
  assert.equal((await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json')).statusCode, 200);
  r = await call({ method: 'DELETE', url: `${base}/uploads/all_masters` });
  assert.match(r.json().messages[0], /sorted again, because the All Masters file "Master\.json" was removed/);
  ({ c } = await comp());
  assert.deepEqual(c.allTransactions.datasets.filter(d => ['sales', 'other_vouchers'].includes(d.slot)).map(d => d.records), [1, 3]);
});
