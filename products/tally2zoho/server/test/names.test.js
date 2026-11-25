// Stage A4-A5: names (cleaning, possible duplicates) and contact fixes. Every name, GSTIN and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-names-'));
const { buildApp } = await import('../src/index.js');
const { gstTreatment, placeOfContact, parseCsv, TEMPLATES } = await import('../src/zoho.js');
const { cleanName, needsCleaning, visibleName, hiddenParts, makeNameResolver, applyContactFixes, openingWithMerged } = await import('../src/namefix.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, payload });
const ok = async (method, url, payload) => { const r = await send(method, url, payload); assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`); return r.json(); };
const readSample = f => JSON.parse(fs.readFileSync(path.join(samples, f), 'utf8').replace(/^﻿/, ''));
const putDoc = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': `${slot}.json` }, payload: Buffer.from(JSON.stringify(obj)) });
const FILES = { stock_items: '04_stock_items.json', units: '05_units.json', taxes: '06_tax_configuration.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', trial_balance: '13_trial_balance.json' };
const ledger = (name, parent, openingbalance, extra = {}) => ({ metadata: { type: 'Ledger', name }, name, parent, countryname: 'India', ...(openingbalance != null ? { openingbalance } : {}), ...extra });
const line = (ledgername, amount, party = false) => ({ ledgername, amount, isdeemedpositive: amount.startsWith('-'), ispartyledger: party });
const voucher = (vchtype, number, party, lines) => ({ metadata: { type: 'Voucher', vchtype }, guid: `made-up-${number}`, date: '20240715', vouchertypename: vchtype, vouchernumber: number, ...(party ? { partyledgername: party } : {}), narration: '', ledgerentries: lines });

const OAK_LB = 'Oak Line Traders\r\n', OAK = 'Oak Line Traders', BIRCH_LB = 'Birch Retail\r\n', TRAVEL_LB = 'Travel Exp\r\n', TRAVEL = 'Travel Exp';
function customersDoc() {
  const doc = readSample('01_customers.json');
  doc.tallymessage.push(
    ledger(BIRCH_LB, 'Sundry Debtors', '-500.00', { gstregistrationtype: 'Unregistered', ledstatename: 'Karnataka' }),
    ledger('Cedar Stores', 'Sundry Debtors', '-100.00', { gstregistrationtype: 'Regular', ledstatename: 'Karnataka' }), // registered, no GSTIN
    ledger('Elm Mart', 'Sundry Debtors', '0', { gstregistrationtype: 'Regular', partygstin: '29ELM', ledstatename: 'Karnataka' }), // GSTIN of the wrong format
    ledger('Ash Co', 'Sundry Debtors', '0', { ledstatename: 'Karnataka' }), // no GST registration type
    ledger('Maple Foods', 'Sundry Debtors', '-40.00', { gstregistrationtype: 'Regular', partygstin: '29MAPLE1234F1ZS', ledstatename: 'Karnataka' }),
    ledger('Maple Foods Pvt', 'Sundry Debtors', '-60.00', { gstregistrationtype: 'Regular', partygstin: '29MAPLE1234F1ZS', ledstatename: 'Karnataka' }));
  return doc;
}
function vendorsDoc() {
  const doc = readSample('02_vendors.json');
  doc.tallymessage.push(
    ledger(OAK_LB, 'Sundry Creditors', '300.00', { gstregistrationtype: 'Regular', partygstin: '27OAKLN1234F1ZQ', ledstatename: 'Maharashtra' }),
    ledger(OAK, 'Sundry Creditors', '200.00', { gstregistrationtype: 'Regular', partygstin: '27OAKLN1234F1ZQ', ledstatename: 'Maharashtra' }),
    ledger('Pine Supplies ', 'Sundry Creditors', '0', { gstregistrationtype: 'Unregistered', ledstatename: 'Kerala' }), // a space at the end
    ledger('Fir Works', 'Sundry Creditors', '0', { gstregistrationtype: 'Regular', partygstin: '29FIRWK1234F1ZO' })); // no state
  return doc;
}
function accountsDoc() {
  const doc = readSample('03_chart_of_accounts.json');
  doc.tallymessage.push(ledger(TRAVEL_LB, 'Indirect Expenses', '-100.00'), ledger(TRAVEL, 'Indirect Expenses', '-50.00'));
  return doc;
}
function salesDoc() {
  const doc = readSample('07_sales_vouchers.json');
  doc.tallymessage.push(voucher('Sales', 'SA/MADEUP/1', 'Birch Retail', [line('Birch Retail', '-1000.00', true), line('Sales - Spares', '1000.00')]));
  return doc;
}
function purchaseDoc() {
  const doc = readSample('08_purchase_vouchers.json');
  doc.tallymessage.push(
    voucher('Purchase', 'PU/MADEUP/1', OAK_LB, [line(OAK_LB, '700.00', true), line('Purchase - Raw Material', '-700.00')]),
    voucher('Purchase', 'PU/MADEUP/2', OAK, [line(OAK, '800.00', true), line('Purchase - Raw Material', '-800.00')]));
  return doc;
}
function journalDoc() {
  const doc = readSample('11_journal_vouchers.json');
  doc.tallymessage.push(voucher('Journal', 'JO/MADEUP/1', null, [line(TRAVEL_LB, '-25.00'), line('Cash', '25.00')]));
  return doc;
}

async function setUp() {
  await login('analyst');
  const r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  for (const [slot, f] of Object.entries(FILES)) {
    const u = await call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
    assert.equal(u.statusCode, 200, slot);
  }
  for (const [slot, doc] of [['customers', customersDoc()], ['vendors', vendorsDoc()], ['accounts', accountsDoc()], ['sales', salesDoc()], ['purchase', purchaseDoc()], ['journal', journalDoc()]]) {
    assert.equal((await putDoc(id, slot, doc)).statusCode, 200, slot);
  }
  await send('PUT', `/api/migrations/${id}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `/api/migrations/${id}/process`)).statusCode, 200);
  await ok('POST', `/api/migrations/${id}/journals/accept-suggestions`, {});
  return id;
}
const generate = async base => { const g = await send('POST', `${base}/generate`); assert.equal(g.statusCode, 200, g.body); };
const csv = async (base, key) => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, `${key}: ${r.body}`); return parseCsv(r.body).rows; };
const flags = async (base, kind) => (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && e.kind === kind);
const trail = async id => (await get(`/api/migrations/${id}/audit`)).map(a => `${a.actor} | ${a.action} | ${a.detail}`);

// ================= the pure rules =================
test('A4: cleaning a name removes line breaks, invisible characters, tabs and edge spaces, and shows what was hidden', () => {
  assert.equal(cleanName('Oak Line Traders\r\n'), 'Oak Line Traders');
  assert.equal(cleanName('﻿Birch\r\nRetail '), 'Birch Retail', 'a line break inside becomes one space');
  assert.equal(cleanName('Pine\tSupplies  Co '), 'Pine Supplies Co');
  assert.equal(cleanName('\r\n'), '');
  assert.ok(needsCleaning('Oak\r\n') && needsCleaning(' Oak') && needsCleaning('Oak​') && !needsCleaning('Oak Line') && !needsCleaning(''));
  assert.equal(visibleName('Oak\r\n'), 'Oak[line break]');
  assert.equal(visibleName(' Oak​'), '[space]Oak[invisible character]');
  assert.deepEqual(hiddenParts('Oak \r\n'), ['line break', 'space at the start or end']);
  assert.deepEqual(hiddenParts('Oak\tTrees﻿'), ['tab', 'invisible character']);
});

test('A4: one resolver gives the written name: clash first, then treated as one, then a new name, then a cleaned name', () => {
  const masters = [OAK_LB, OAK, BIRCH_LB, 'Advance tax', 'Gone Ledger\r\n', 'Twin\r', 'Twin\n'];
  const r = makeNameResolver({
    clashDecisions: { 'Advance tax': { decision: 'zoho' } },
    nameDecisions: { [OAK_LB]: { action: 'merge', mergeInto: OAK }, [OAK]: { action: 'clean', newName: 'never used' }, [BIRCH_LB]: { action: 'clean', newName: 'Birch Retail' } },
  }, masters);
  assert.equal(r(BIRCH_LB), 'Birch Retail');
  assert.equal(r('Birch Retail'), 'Birch Retail', 'a voucher naming the ledger without its line break finds the master');
  assert.equal(r(OAK), 'never used', 'an exact name is matched first: the master without the line break');
  assert.equal(r(OAK_LB), 'never used', 'treated as one: the kept ledger, with its own decision');
  assert.equal(r('Advance tax'), 'Advance Tax', "Zoho's own account");
  // changed on purpose (pick and drop): a master without a decision is written exactly as the masters have it, also
  // when a voucher names it without the line break, so every file carries the same raw value
  assert.equal(r('Gone Ledger'), 'Gone Ledger\r\n', 'a master without a decision: the name exactly as in the masters');
  assert.equal(r('Gone Ledger\r\n'), 'Gone Ledger\r\n');
  assert.equal(r('Twin'), 'Twin', 'two masters match only ignoring hidden characters: not guessed');
  assert.equal(r('Nobody'), 'Nobody');
  assert.equal(r.masterOf('Birch Retail'), BIRCH_LB);
  // a rename to keep two duplicates apart
  const k = makeNameResolver({ nameDecisions: { [OAK_LB]: { action: 'rename', newName: 'Oak Line Traders (North)' } } }, masters);
  assert.equal(k(OAK_LB), 'Oak Line Traders (North)');
  assert.equal(k(OAK), OAK);
  // the merged opening balance is the sum, with the Tally sign
  const m = openingWithMerged(OAK, '200.00', { mergedBalances: { [OAK]: [{ ledger: OAK_LB, amount: '-350.00' }] } });
  assert.equal(m.total.toFixed(2), '-150.00');
  assert.equal(m.added.length, 1);
});

test('A5: a contact correction is applied to the written values only, in the chosen code set', () => {
  const base = { name: 'X', gstin: '', registrationType: 'Regular', country: 'India', state: '', placeOfSupply: '' };
  assert.equal(gstTreatment(base).problem.kind, 'gst_registered_without_gstin');
  const unreg = applyContactFixes({ ...base, gstin: '29BAD' }, { treatment: 'unregistered' });
  assert.equal(unreg.gstin, '', 'no GSTIN is written for an unregistered party');
  assert.equal(gstTreatment(unreg, 'sample').value, 'business_none');
  assert.equal(gstTreatment(unreg, 'help').value, 'business_unregistered');
  const reg = applyContactFixes(base, { gstin: '29ABCDE1234F1ZW' });
  assert.equal(gstTreatment(reg).value, 'business_gst');
  assert.equal(placeOfContact(reg, 'business_gst').value, 'KA', 'the place comes from the GSTIN when no state is known');
  const unknown = applyContactFixes({ ...base, registrationType: '' }, { gstin: '29ABCDE1234F1ZW', treatment: 'regular' });
  assert.equal(gstTreatment(unknown, 'help').value, 'business_registered_regular');
  const state = applyContactFixes(base, { state: 'TN' });
  assert.deepEqual([state.placeOfSupply, state.state, state.placeFixed], ['Tamil Nadu', 'Tamil Nadu', 'TN']);
  assert.equal(placeOfContact(state, '').value, 'TN');
  const kept = applyContactFixes({ ...base, state: 'Kerala' }, { state: 'TN' });
  assert.equal(kept.state, 'Kerala', 'a Tally state is kept as the Billing State; only the place changes');
  assert.equal(applyContactFixes(base, null), base);
});

// ================= names through the API =================
// changed on purpose (pick and drop): names with hidden characters are passed as in Tally and are warnings, not
// blockers; cleaning is opt-in. Names that become the same once cleaned block only when cleaning is chosen.
test('A4: names with hidden characters are listed and written as in Tally (a warning); cleaning is opt-in, one by one or all at once, used in every file and audited', async () => {
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  await generate(base);
  let v = await get(`${base}/names`);
  const listed = v.names.map(n => n.ledger).sort();
  assert.deepEqual(listed, [BIRCH_LB, OAK_LB, 'Pine Supplies ', TRAVEL_LB].sort());
  const birch = v.names.find(n => n.ledger === BIRCH_LB);
  assert.deepEqual([birch.before, birch.after, birch.hidden, birch.sections, birch.decision, birch.vouchers], ['Birch Retail[line break]', 'Birch Retail', ['line break'], ['customer'], null, 1]);
  // by default: written exactly as in Tally, the same raw value in the contact file and on the invoice
  assert.ok((await csv(base, 'customers')).some(r => r['Display Name'] === BIRCH_LB), 'the line break is kept (the CSV quotes the cell)');
  assert.ok((await csv(base, 'invoices')).some(r => r['Customer Name'] === BIRCH_LB), 'the invoice names the same raw value, although the voucher names it without the line break');
  // flagged as warnings, not blockers.
  // v2 default 6 (changed on purpose: this was 2): the vendor "Oak Line Traders[line break]" has the same name as the
  // vendor "Oak Line Traders", so by default the two are one party and the one with the line break is not written.
  assert.equal((await flags(base, 'display_name_hidden_characters')).length, 1);
  assert.deepEqual((await flags(base, 'contact_merged_by_default')).map(f => f.name), [OAK_LB]);
  assert.equal((await flags(base, 'account_name_hidden_characters')).length, 1);
  assert.ok((await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'display_name_hidden_characters').every(e => e.warning === true));
  let rep = await get(`${base}/test-report`);
  assert.ok(rep.whatToFixNext.some(x => !x.blocking && x.message.includes('display_name_hidden_characters') && /a warning/.test(x.message)));
  assert.ok(!rep.whatToFixNext.some(x => x.blocking && /hidden_characters|collides_after_cleaning/.test(x.message)), 'no name warning blocks the import');
  assert.ok(!rep.whatToFixNext.some(x => x.blocking && /_duplicate"/.test(x.message)), 'nothing is written twice with the same name');
  const prep = (await get(`${base}/prepare`)).steps.find(s => s.key === 'decisions').items;
  const namesItem = prep.find(i => i.key === 'names');
  // changed on purpose (audit item 8): only names WRITTEN to a file count; the merged vendor is not written (4 -> 3)
  assert.deepEqual([namesItem.open, namesItem.info, namesItem.blocksImport, namesItem.warnings], [0, true, false, 3]);
  assert.deepEqual([v.counts.names, v.counts.notWritten], [3, 1]);
  assert.match(namesItem.words, /written as in Tally/);
  // clean one
  v = await ok('PUT', `${base}/names`, { ledger: BIRCH_LB, clean: true });
  assert.equal(v.names.find(n => n.ledger === BIRCH_LB).decision, 'clean');
  assert.equal(v.names.find(n => n.ledger === BIRCH_LB).written, 'Birch Retail');
  const stale = (await get(base)).outOfDateFiles;
  assert.ok(stale.includes('customers') && stale.includes('invoices') && !stale.includes('vendors') && !stale.includes('accounts'), `out of date: ${stale}`);
  assert.ok((await trail(id)).some(t => /analyst.*\| name_cleaned \| Name "Birch Retail\[line break\]" \(customer\) is written as "Birch Retail"/.test(t)));
  await generate(base);
  const customers = await csv(base, 'customers');
  assert.ok(customers.some(r => r['Display Name'] === 'Birch Retail' && r['Company Name'] === 'Birch Retail'));
  assert.ok(!customers.some(r => /\r|\n/.test(r['Display Name'])));
  const invoices = await csv(base, 'invoices');
  assert.ok(invoices.some(r => r['Customer Name'] === 'Birch Retail'), 'the invoice names the cleaned contact');
  assert.equal((await flags(base, 'display_name_hidden_characters')).length, 0, 'none is left (the Oak vendor with the line break is not written: default 6)');
  // undo
  v = await ok('PUT', `${base}/names`, { ledger: BIRCH_LB, clean: false });
  assert.equal(v.names.find(n => n.ledger === BIRCH_LB).decision, null);
  assert.ok((await trail(id)).some(t => /name_cleaned \| Name "Birch Retail\[line break\]" \(customer\): cleaning removed/.test(t)));
  // a viewer only reads
  await login('viewer');
  assert.equal((await get(`${base}/names`)).names.length, 4);
  assert.equal((await send('PUT', `${base}/names`, { ledger: BIRCH_LB, clean: true })).statusCode, 403);
  assert.equal((await send('POST', `${base}/names/clean-all`)).statusCode, 403);
  await login('analyst');
  assert.equal((await send('PUT', `${base}/names`, { ledger: 'Nobody', clean: true })).statusCode, 404);
  // clean all
  v = await ok('POST', `${base}/names/clean-all`);
  assert.equal(v.changed, 4);
  // (audit item 8: counted over the names written; the Oak vendor is still treated as one party with the other)
  assert.deepEqual([v.counts.cleaned, v.counts.notCleaned, v.counts.notWritten], [3, 0, 1]);
  assert.equal((await ok('POST', `${base}/names/clean-all`)).changed, 0, 'nothing left to clean');
  await generate(base);
  assert.equal((await flags(base, 'display_name_hidden_characters')).length, 0);
  assert.equal((await flags(base, 'account_name_hidden_characters')).length, 0);
  const vendors = await csv(base, 'vendors');
  assert.ok(vendors.some(r => r['Display Name'] === 'Pine Supplies'));
  // cleaning (chosen) makes the two Travel accounts the same written name: blocking until decided.
  // v2 default 6 (changed on purpose: display_name_duplicate was 1): the two Oak vendors would be written with the same
  // Display Name too, which Zoho refuses ("Duplicate row found in your CSV/TSV file"), so by default they are one party.
  assert.equal((await flags(base, 'display_name_duplicate')).length, 0);
  assert.deepEqual((await csv(base, 'vendors')).filter(r => /^Oak/.test(r['Display Name'])).map(r => [r['Display Name'], r['Opening Balance']]), [[OAK, '500.00']]);
  assert.equal((await flags(base, 'account_name_duplicate')).length, 1);
  assert.equal((await flags(base, 'display_name_collides_after_cleaning')).length, 0);
  rep = await get(`${base}/test-report`);
  assert.ok(rep.whatToFixNext.some(x => x.blocking && x.message.includes('account_name_duplicate')));
  const dup = (await get(`${base}/names`)).duplicates.find(g => g.section === 'vendor');
  assert.deepEqual([dup.sameWrittenName, dup.needsDecision, dup.defaultDecision, dup.defaultKept], [false, true, 'merge', OAK], 'one party by default; the shared GSTIN can still be decided');
  assert.equal((await get(`${base}/names`)).duplicates.find(g => g.section === 'account').sameWrittenName, true);
  const prepAfter = (await get(`${base}/prepare`)).steps.find(s => s.key === 'decisions').items.find(i => i.key === 'duplicates');
  assert.equal(prepAfter.blocksImport, true);
  assert.ok(!rep.whatToFixNext.some(x => x.message.includes('"name_hidden_characters"') && !/not decided yet/.test(x.message)), 'processing flags about decided names are not listed as to do');
});

test('A4: possible duplicates are listed with their facts; keep both needs distinct names; treat as one adds the balance and every file uses the kept name', async () => {
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  let v = await get(`${base}/names`);
  const oak = v.duplicates.find(g => g.section === 'vendor');
  assert.ok(oak, 'the vendor pair is listed');
  assert.deepEqual([oak.sameName, oak.sameGstin, oak.members.length, oak.decision], [true, true, 2, null]);
  assert.deepEqual([oak.sameWrittenName, oak.needsDecision], [false, true], 'written differently (as in Tally); the shared GSTIN still asks for a decision');
  const lb = oak.members.find(m => m.ledger === OAK_LB), plain = oak.members.find(m => m.ledger === OAK);
  assert.deepEqual([lb.visible, lb.group, lb.gstin, lb.openingBalance, lb.vouchers], ['Oak Line Traders[line break]', 'Sundry Creditors', '27OAKLN1234F1ZQ', { amount: '300.00', side: 'Credit' }, 1]);
  assert.deepEqual([plain.openingBalance, plain.vouchers], [{ amount: '200.00', side: 'Credit' }, 1]);
  assert.deepEqual(oak.combinedBalance, { amount: '500.00', side: 'Credit' });
  const maple = v.duplicates.find(g => g.section === 'customer');
  assert.deepEqual([maple.sameName, maple.sameGstin], [false, true], 'two contacts with the same GSTIN');
  const travel = v.duplicates.find(g => g.section === 'account');
  assert.deepEqual([travel.sameName, travel.sameGstin, travel.members.length], [true, false, 2]);
  assert.deepEqual([travel.sameWrittenName, travel.needsDecision], [false, false], 'the same only once cleaned: a warning, nothing to decide');
  // UI audit #12 (changed on purpose: was [2, 0, 1]). A group on the tool's default (Oak: one party; Maple: kept apart)
  // counts as decided; only a group whose names would reach Zoho the same is still open.
  assert.deepEqual([v.counts.duplicatesUndecided, v.counts.duplicatesBlocking, v.counts.duplicatesOnlyOnceCleaned], [0, 0, 1]);
  assert.deepEqual([oak.status, maple.status, travel.status, v.counts.duplicatesOnDefault], ['default', 'default', 'default', 3]);
  // v2 default 6 (changed on purpose). With no decision: the two Oak vendors have the same name once cleaned (and the same
  // GSTIN), so they are ONE party by default; the two Maple customers share a GSTIN under different names and are kept
  // apart. Both are flagged, and listed as assumptions.
  assert.deepEqual([oak.defaultDecision, oak.defaultKept, maple.defaultDecision, travel.defaultDecision], ['merge', OAK, 'keep_both', 'keep_both']);
  assert.equal(v.counts.duplicatesMergedByDefault, 1);
  await generate(base);
  assert.equal((await flags(base, 'display_name_collides_after_cleaning')).length, 0, 'the vendor with the line break is not written, so nothing collides (this was 1 warning)');
  assert.equal((await flags(base, 'display_name_duplicate')).length, 0);
  assert.deepEqual((await flags(base, 'contact_merged_by_default')).map(f => f.name), [OAK_LB]);
  assert.match((await flags(base, 'contact_merged_by_default'))[0].message, /By default the two are treated as one party/);
  assert.deepEqual((await csv(base, 'vendors')).filter(r2 => /^Oak/.test(r2['Display Name'])).map(r2 => [r2['Display Name'], r2['Opening Balance']]), [[OAK, '500.00']], 'one row, the balances added with exact decimals');
  assert.match((await flags(base, 'contacts_treated_as_one'))[0].message, /has the same name as this vendor, and Zoho Books rejects two rows with one Display Name, so by default it is treated as the same party and not written separately\. The opening balance written is the total: 500\.00 Credit/);
  assert.deepEqual((await csv(base, 'bills')).filter(b => /MADEUP/.test(b['Bill Number'])).map(b => b['Vendor Name']), [OAK, OAK], 'the bills of both name the contact kept');
  const apart = await flags(base, 'same_gstin_kept_apart');
  assert.equal(apart.length, 1);
  assert.match(apart[0].message, /2 customers have the same GSTIN .* and different names.*They are written as separate contacts/);
  const assumed = (await get(`${base}/assumptions`)).assumptions;
  assert.deepEqual(['contact_merged_by_default', 'same_gstin_kept_apart'].map(k => assumed.find(a => a.kind === k)?.count), [1, 1]);

  // changed on purpose (pick and drop): keep both needs no new name while the names are written differently (as in Tally)
  let r = await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'keep_both' });
  assert.equal(r.statusCode, 200, r.body);
  await ok('PUT', `${base}/duplicates`, { key: oak.key, decision: null });
  // once one of them is cleaned (opt-in) they would be written the same: then a new name is required
  await ok('PUT', `${base}/names`, { ledger: OAK_LB, clean: true });
  // (changed on purpose: sameWrittenName was true here. By default the two are one party, so only one row is written.)
  assert.deepEqual((({ sameWrittenName, defaultDecision }) => [sameWrittenName, defaultDecision])((await get(`${base}/names`)).duplicates.find(g => g.key === oak.key)), [false, 'merge']);
  r = await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'keep_both' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /written with the same name in Zoho.*Type a different name for one of them/);
  r = await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'keep_both', names: { [OAK_LB]: 'Bharat Steel Traders' } });
  assert.equal(r.statusCode, 400, 'the name of another vendor is refused');
  r = await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'keep_both', names: { [OAK_LB]: 'Oak\r\nNorth' } });
  assert.equal(r.statusCode, 400, 'hidden characters are refused');
  v = await ok('PUT', `${base}/duplicates`, { key: oak.key, decision: 'keep_both', names: { [OAK_LB]: 'Oak Line Traders (North)' } });
  assert.equal(v.duplicates.find(g => g.key === oak.key).decision, 'keep_both');
  assert.equal((await send('PUT', `${base}/names`, { ledger: OAK_LB, clean: true })).statusCode, 409, 'decided as a duplicate: changed there');
  // keeping a same-GSTIN pair with different names needs no new name
  await ok('PUT', `${base}/duplicates`, { key: maple.key, decision: 'keep_both' });
  assert.ok((await get(base)).outOfDateFiles.includes('vendors'));
  await generate(base);
  let vendors = await csv(base, 'vendors');
  assert.ok(vendors.some(r2 => r2['Display Name'] === 'Oak Line Traders (North)' && r2['Opening Balance'] === '300.00'));
  assert.ok(vendors.some(r2 => r2['Display Name'] === OAK && r2['Opening Balance'] === '200.00'));
  let bills = await csv(base, 'bills');
  assert.deepEqual(bills.filter(b => /MADEUP/.test(b['Bill Number'])).map(b => [b['Bill Number'], b['Vendor Name']]).sort(), [['PU/MADEUP/1', 'Oak Line Traders (North)'], ['PU/MADEUP/2', OAK]]);
  assert.equal((await flags(base, 'display_name_collides_after_cleaning')).length, 0, 'the blocking flag clears once decided');

  // treat as one: one contact, the other's balance added, the vouchers of both name the kept one
  r = await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'merge', keep: 'Somebody' });
  assert.equal(r.statusCode, 400);
  v = await ok('PUT', `${base}/duplicates`, { key: oak.key, decision: 'merge', keep: OAK });
  const g = v.duplicates.find(x => x.key === oak.key);
  assert.deepEqual([g.decision, g.kept], ['merge', OAK]);
  assert.equal(g.addition, '"Oak Line Traders" 200.00 Credit + "Oak Line Traders[line break]" 300.00 Credit = 500.00 Credit');
  assert.ok((await trail(id)).some(t => /duplicate_decided \| Possible duplicate vendors .*: keep both -> treat as one vendor: "Oak Line Traders" is written/.test(t)));
  await generate(base);
  vendors = await csv(base, 'vendors');
  assert.deepEqual(vendors.filter(r2 => /^Oak/.test(r2['Display Name'])).map(r2 => [r2['Display Name'], r2['Opening Balance']]), [[OAK, '500.00']]);
  bills = await csv(base, 'bills');
  assert.deepEqual(bills.filter(b => /MADEUP/.test(b['Bill Number'])).map(b => b['Vendor Name']), [OAK, OAK]);
  const merged = await flags(base, 'merged_into_other_contact');
  assert.deepEqual(merged.map(f => f.name), [OAK_LB]);
  assert.match((await flags(base, 'contacts_treated_as_one'))[0].message, /The opening balance written is the total: 500\.00 Credit \(its own 200\.00 Credit plus 300\.00 Credit of "Oak Line Traders\[line break\]"/);

  // accounts: treat as one adds the balance in the Chart of Accounts; the journal names the kept account
  r = await send('PUT', `${base}/duplicates`, { key: travel.key, decision: 'keep_both', names: { [TRAVEL_LB]: 'Advance Tax' } });
  assert.equal(r.statusCode, 400, "the name of one of Zoho's own accounts is refused");
  await ok('PUT', `${base}/duplicates`, { key: travel.key, decision: 'merge', keep: TRAVEL });
  const stale = (await get(base)).outOfDateFiles;
  assert.ok(stale.includes('accounts') && stale.includes('journals'));
  await generate(base);
  const accounts = await csv(base, 'accounts');
  assert.deepEqual(accounts.filter(a => /^Travel Exp/.test(a['Account Name'])).map(a => [a['Account Name'], a['Opening Balance'], a['Debit or Credit']]), [[TRAVEL, '150.00', 'Debit']]);
  const journals = await csv(base, 'journals');
  // B6: the journal file follows Zoho's sample, where the Tally voucher number is the Reference Number
  assert.ok(journals.some(j => j['Reference Number'] === 'JO/MADEUP/1' && j.Account === TRAVEL), 'the journal line on the merged ledger names the kept account');
  assert.equal((await flags(base, 'account_name_collides_after_cleaning')).length, 0);
  assert.deepEqual((await flags(base, 'merged_into_other_account')).map(f => f.name), [TRAVEL_LB]);

  // undo: no decision again. Changed on purpose (v2 default 6): the default applies again, so there is still one row
  // (there were two rows here before, which Zoho would have refused once the names were the same).
  v = await ok('PUT', `${base}/duplicates`, { key: oak.key, decision: null });
  assert.deepEqual([v.duplicates.find(x => x.key === oak.key).decision, v.duplicates.find(x => x.key === oak.key).defaultDecision], [null, 'merge']);
  await generate(base);
  assert.equal((await csv(base, 'vendors')).filter(r2 => /^Oak/.test(r2['Display Name'])).length, 1);
  assert.deepEqual((await flags(base, 'merged_into_other_contact')), [], 'not a decision of a person any more');
  assert.deepEqual((await flags(base, 'contact_merged_by_default')).map(f => f.name), [OAK_LB]);
  await login('viewer');
  assert.equal((await send('PUT', `${base}/duplicates`, { key: oak.key, decision: 'merge', keep: OAK })).statusCode, 403);
  await login('analyst');
});

// ================= Fix contacts =================
test('A5: Fix contacts lists the problems, validates every correction, applies it to the files only, and audits it with its reason', async () => {
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  await generate(base);
  let v = await get(`${base}/contact-fixes`);
  const row = l => v.rows.find(r => r.ledger === l);
  const remaining = p => v.problems.find(x => x.id === p).remaining;
  assert.deepEqual(row('Cedar Stores').problems, ['registered_without_gstin']);
  assert.deepEqual(row('Elm Mart').problems, ['gstin_format']);
  assert.ok(row('Ash Co').problems.includes('registration_unknown'));
  // v2 default 5 (changed on purpose): Fir Works has no state in Tally and a valid GSTIN. That was the problem
  // "state_missing"; the state of the GSTIN is now written by default, and the row is listed with that assumption.
  assert.ok(!row('Fir Works').problems.includes('state_missing'));
  // v2: with no PAN in Tally, the PAN in the GSTIN (characters 3 to 12) is written too, as an assumption
  assert.deepEqual([row('Fir Works').assumptions, row('Fir Works').written.place, row('Fir Works').written.billingState], [['state_from_gstin', 'pan_from_gstin'], 'KA', 'Karnataka']);
  assert.deepEqual(row('Fir Works').pan, { tally: '', written: row('Fir Works').written.gstin.slice(2, 12), fromGstin: row('Fir Works').written.gstin.slice(2, 12), source: 'gstin' });
  assert.equal(v.assumptions.find(a => a.id === 'state_from_gstin').count, 1);
  assert.deepEqual((await flags(base, 'state_from_gstin')).map(f => f.name), ['Fir Works']);
  assert.deepEqual((({ 'Billing State': b, 'Source Of Supply': s }) => [b, s])((await csv(base, 'vendors')).find(x => x['Display Name'] === 'Fir Works')), ['Karnataka', 'KA'], 'written without anyone choosing it');
  assert.equal(row('Fir Works').gstinState, 'KA');
  assert.deepEqual([remaining('registered_without_gstin'), remaining('gstin_format')], [1, 1]);
  assert.equal(v.counts.stateFromGstinPossible, 1);

  // validation
  const put = body => send('PUT', `${base}/contact-fixes`, body);
  assert.equal((await put({ ledger: 'Nobody', gstin: '29ABCDE1234F1ZW' })).statusCode, 404);
  let r = await put({ ledger: 'Cedar Stores', gstin: '29ABC' });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /format of a GSTIN/);
  r = await put({ ledger: 'Cedar Stores', gstin: '99ABCDE1234F1ZP' });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /not the code of a state/);
  r = await put({ ledger: 'Cedar Stores', gstin: '29ABCDE1234F1ZW', state: 'TN' });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /registered in Karnataka \(KA\), not in Tamil Nadu \(TN\)/);
  r = await put({ ledger: 'Ash Co', treatment: 'regular' });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /needs a GSTIN/);
  r = await put({ ledger: 'Elm Mart', treatment: 'sometimes' });
  assert.equal(r.statusCode, 400);

  // corrections
  v = await ok('PUT', `${base}/contact-fixes`, { ledger: 'Cedar Stores', gstin: ' 29abcde1234f1zw ', reason: 'GSTIN from the party invoice' });
  assert.equal(row('Cedar Stores').fix.gstin, '29ABCDE1234F1ZW');
  assert.deepEqual(row('Cedar Stores').problems, []);
  assert.equal(remaining('registered_without_gstin'), 0);
  // (audit item 5: what an invoice can carry depends on the contact, so journals routed by default and the service
  // items of the Items file may change too)
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['customers', 'invoices', 'items', 'journals'], 'only the files of that contact (changed on purpose: Invoices write its GST details)');
  v = await ok('PUT', `${base}/contact-fixes`, { ledger: 'Elm Mart', treatment: 'unregistered' });
  assert.equal(row('Elm Mart').written.gstTreatment, 'business_none');
  r = await put({ ledger: 'Elm Mart', gstin: '29ABCDE1234F1ZW' });
  assert.equal(r.statusCode, 400, 'a GSTIN for a party treated as unregistered is refused');
  v = await ok('PUT', `${base}/contact-fixes`, { ledger: 'Ash Co', gstin: '29ASHCO1234F1ZK', treatment: 'regular' });
  assert.equal(row('Ash Co').written.gstTreatment, 'business_gst');
  const audit = await trail(id);
  assert.ok(audit.some(t => /analyst.* \| contact_fixed \| Contact "Cedar Stores" \(Fix contacts\): no correction -> GSTIN 29ABCDE1234F1ZW\. Reason: GSTIN from the party invoice/.test(t)));
  assert.ok(audit.some(t => /contact_fixed \| Contact "Elm Mart" .*-> treated as unregistered\. Reason: treated as unregistered in Fix contacts/.test(t)));

  // bulk: the GSTIN's state where the state is missing
  v = await ok('POST', `${base}/contact-fixes/state-from-gstin`, {});
  assert.equal(v.changed, 1);
  assert.equal(row('Fir Works').fix.state, 'KA');
  assert.equal(v.counts.stateFromGstinPossible, 0);

  await generate(base);
  const customers = await csv(base, 'customers');
  const c = n => customers.find(x => x['Display Name'] === n);
  assert.deepEqual([c('Cedar Stores')['GST Treatment'], c('Cedar Stores')['GST Identification Number (GSTIN)'], c('Cedar Stores')['Place Of Contact']], ['business_gst', '29ABCDE1234F1ZW', 'KA']);
  assert.deepEqual([c('Elm Mart')['GST Treatment'], c('Elm Mart')['GST Identification Number (GSTIN)']], ['business_none', '']);
  const vendors = await csv(base, 'vendors');
  const fir = vendors.find(x => x['Display Name'] === 'Fir Works');
  assert.deepEqual([fir['Billing State'], fir['Source Of Supply']], ['Karnataka', 'KA']);
  const corrected = await flags(base, 'contact_details_corrected');
  assert.equal(corrected.length, 4);
  assert.match(corrected.find(f => f.name === 'Cedar Stores').message, /Corrected in Mapping Studio \(Fix contacts\), for the Zoho file only: GSTIN\. Tally has no GSTIN, registration type "Regular"/);
  assert.equal((await flags(base, 'gst_registered_without_gstin')).length, 0);
  assert.equal((await flags(base, 'gstin_format')).length, 0);
  // the Tally values are unchanged: the screen still shows them
  v = await get(`${base}/contact-fixes`);
  assert.deepEqual([row('Cedar Stores').tally.gstin, row('Elm Mart').tally.gstin], ['', '29ELM']);

  // with the help page codes, "treat as unregistered" writes that set's code
  await login('admin');
  await ok('PUT', '/api/settings/gst-codes', { codeSet: 'help' });
  v = await get(`${base}/contact-fixes`);
  assert.equal(row('Elm Mart').written.gstTreatment, 'business_unregistered');
  await ok('PUT', '/api/settings/gst-codes', { codeSet: 'sample' });
  await login('analyst');

  // removing a correction
  v = await ok('PUT', `${base}/contact-fixes`, { ledger: 'Ash Co', gstin: '', treatment: '' });
  assert.equal(row('Ash Co').fix, null);
  assert.ok(row('Ash Co').problems.includes('registration_unknown'));

  await login('viewer');
  assert.equal((await get(`${base}/contact-fixes`)).rows.length > 0, true);
  assert.equal((await send('PUT', `${base}/contact-fixes`, { ledger: 'Ash Co', treatment: 'unregistered' })).statusCode, 403);
  await login('analyst');
});

test('v2 Fix contacts: PAN shown, derived and corrected; the same GSTIN twice is a problem fixed in place; accept as per Tally', async () => {
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  let v = await get(`${base}/contact-fixes`);
  const row = l => v.rows.find(r => r.ledger === l);
  // two contacts of one kind get the same GSTIN: both show the problem, naming the other
  const [a, b] = ['Cedar Stores', 'Ash Co'];
  assert.equal(row(a).section, row(b).section);
  v = await ok('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: a, gstin: '29QWERT5678K1Z0' }, { ledger: b, gstin: '29QWERT5678K1Z0', treatment: 'regular' }] });
  assert.deepEqual([row(a).problems.includes('same_gstin'), row(a).sameGstin, row(b).sameGstin], [true, [b], [a]]);
  // (the made-up data already has one such pair, Maple Foods and Maple Foods Pvt)
  assert.deepEqual(v.rows.filter(r => r.problems.includes('same_gstin')).map(r => r.ledger).sort(), [b, a, 'Maple Foods', 'Maple Foods Pvt'].sort());
  assert.equal(v.problems.find(p => p.id === 'same_gstin').remaining, 4);
  // the PAN of a contact with no PAN in Tally comes from its GSTIN
  assert.deepEqual([row(a).pan.written, row(a).pan.source], ['QWERT5678K', 'gstin']);
  // the wrong GSTIN is corrected in place; the PAN follows it
  v = await ok('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: b, gstin: '29ASHCO1234F1ZK' }] });
  assert.deepEqual([row(a).problems.includes('same_gstin'), row(b).sameGstin, row(b).pan.written], [false, [], 'ASHCO1234F']);
  // a PAN: format checked, and it must be the PAN in the GSTIN
  let r = await send('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: b, pan: 'ABC12' }] });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /format of a PAN/);
  r = await send('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: b, pan: 'ZZZZZ9999Z' }] });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /The PAN in the GSTIN 29ASHCO1234F1ZK is ASHCO1234F, not ZZZZZ9999Z/);
  v = await ok('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: b, pan: 'ashco1234f' }] });
  assert.deepEqual([row(b).fix.pan, row(b).pan.source], ['ASHCO1234F', 'fix']);
  // a contact with no GSTIN takes any well-formed PAN, written to the file
  v = await ok('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger: 'Elm Mart', treatment: 'unregistered', pan: 'ELMMA1234R' }] });
  await generate(base);
  const file = [...await csv(base, 'customers'), ...await csv(base, 'vendors')];
  assert.equal(file.find(x => x['Display Name'] === 'Elm Mart')['PAN Number'], 'ELMMA1234R');
  assert.equal(file.find(x => x['Display Name'] === a)['PAN Number'], 'QWERT5678K', 'derived from the GSTIN');
  assert.ok((await trail(id)).some(t => /contact_fixed \| Contact "Ash Co" .*PAN ASHCO1234F/.test(t)));

  // "Accept as per Tally": recorded per step, audited, shown on Prepare migration, undone; viewers cannot
  let rv = await get(`${base}/reviews`);
  assert.deepEqual([rv.steps, rv.keys.includes('contact_fixes'), rv.keys.includes('tax_mapping')], [{}, true, true]);
  assert.equal((await send('PUT', `${base}/reviews/nothing`, { accepted: true })).statusCode, 404);
  assert.equal((await send('PUT', `${base}/reviews/contact_fixes`, {})).statusCode, 400);
  rv = await ok('PUT', `${base}/reviews/contact_fixes`, { accepted: true });
  assert.equal(rv.steps.contact_fixes.by, seed.users.find(u => u.role === 'analyst').email);
  assert.equal((await ok('PUT', `${base}/reviews/contact_fixes`, { accepted: true })).changed, false);
  const prep = await get(`${base}/prepare`);
  const item = prep.steps.find(s => s.key === 'decisions').items.find(i => i.key === 'contact_fixes');
  assert.equal(item.reviewed.by, rv.steps.contact_fixes.by);
  assert.ok((await trail(id)).some(t => /step_accepted_as_tally \| Fix contacts: reviewed and accepted as per Tally/.test(t)));
  await login('viewer');
  assert.equal((await send('PUT', `${base}/reviews/contact_fixes`, { accepted: false })).statusCode, 403);
  assert.ok((await get(`${base}/reviews`)).steps.contact_fixes);
  await login('analyst');
  rv = await ok('PUT', `${base}/reviews/contact_fixes`, { accepted: false });
  assert.deepEqual(rv.steps, {});
});

test('A5: "treat all registered without GSTIN as unregistered" names the count and is refused when the list changed', async () => {
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  let v = await get(`${base}/contact-fixes`);
  assert.equal(v.counts.registeredWithoutGstin, 1);
  let r = await send('POST', `${base}/contact-fixes/unregistered-without-gstin`, {});
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().count, 1);
  r = await send('POST', `${base}/contact-fixes/unregistered-without-gstin`, { confirmCount: 3 });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /There are 1 contact\(s\) registered without a GSTIN now, not 3/);
  v = await ok('POST', `${base}/contact-fixes/unregistered-without-gstin`, { confirmCount: 1 });
  assert.equal(v.changed, 1);
  assert.equal(v.counts.registeredWithoutGstin, 0);
  assert.equal(v.rows.find(x => x.ledger === 'Cedar Stores').fix.treatment, 'unregistered');
  assert.ok((await trail(id)).some(t => /contact_fixed \| Contact "Cedar Stores" \(treat all registered without GSTIN as unregistered\): no correction -> treated as unregistered\. Reason: Registered in Tally but no GSTIN/.test(t)));
});

test('A4: a merged balance on the wrong side is left empty and flagged, and the templates still work without decisions', () => {
  const d = ledger('Kept Vendor', 'Sundry Creditors', '100.00', { gstregistrationtype: 'Unregistered' });
  const ctx = { mergedBalances: { 'Kept Vendor': [{ ledger: 'Other Vendor', amount: '-250.00' }] }, outputName: n => n };
  const row = TEMPLATES.vendors.row(d, ctx);
  assert.equal(row['Opening Balance'], '', '100 credit + 250 debit = 150 debit: a vendor in debit is left empty');
  const f = TEMPLATES.vendors.check(d, ctx).find(x => x.kind === 'balance_unusual_side');
  assert.match(f.message, /Opening balance 150\.00 \(its own 100\.00 Credit plus 250\.00 Debit of "Other Vendor", treated as the same party\) is a debit/);
  assert.equal(TEMPLATES.vendors.row(d, {})['Opening Balance'], '100.00');
  assert.equal(TEMPLATES.accounts.row(ledger('Rent\r\n', 'Indirect Expenses', '-10.00'), { outputName: () => 'Rent' })['Account Name'], 'Rent');
});
