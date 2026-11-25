// The rules, the docs and the zip read-me files say the same thing (docs-frontend batch): the lessons of the test imports
// about the import itself (general.while_importing), no fixed months, no advice to type a balance, the assumptions in
// READ_ME_FIRST. Every company and amount here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { RULES, whileImporting, whileImportingLines, assumptionLines, readMeFirst, importGuide, fiscalYearWords, heldLines } = await import('../src/importwizard.js');
const docs = fs.readFileSync(new URL('../../docs/ZOHO_IMPORT_RULES.md', import.meta.url), 'utf8');

test('while importing: every lesson has its evidence, and the docs say it word for word', () => {
  const list = whileImporting();
  assert.ok(list.length >= 6);
  const ids = new Set(list.map(e => e.id));
  for (const id of ['one-file-at-a-time', 'count-after-the-import', 'missing-contact-refuses-the-journal', 'contact-and-bank-journals-are-accepted', 'nothing-handled-goto-import-preview', 'give-the-error-file']) assert.ok(ids.has(id), id);
  const ruleIds = new Set([...RULES.general.rules, ...Object.values(RULES.modules).flatMap(m => m.rules || [])].map(r => r.id));
  for (const e of list) {
    assert.ok(e.text.length > 40 && /\.$/.test(e.text), `${e.id}: a whole sentence`);
    assert.ok(Object.keys(RULES.meta.evidence_levels).includes(e.evidence), `${e.id}: a known evidence level (${e.evidence})`);
    for (const r of e.rules || []) assert.ok(ruleIds.has(r), `${e.id}: rule ${r} exists`);
    for (const m of e.modules || []) assert.ok(RULES.modules[m], `${e.id}: module ${m} exists`);
    // the docs carry the same text (a | in a table cell is escaped)
    assert.ok(docs.includes(e.text.replace(/\|/g, '\\|')), `${e.id}: in docs/ZOHO_IMPORT_RULES.md`);
    assert.ok(docs.includes(`\`${e.id}\``), `${e.id}: its id is in the docs`);
    // confidential: no GSTIN, no voucher number of the test data
    assert.doesNotMatch(e.text, /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9][A-Z0-9]\b/);
    assert.doesNotMatch(e.text, /\b(RCT|PMT|CTR)-\d/);
  }
  // the third import facts are there: the missing customer was the cause, and a contact with a bank line is accepted
  const byId = Object.fromEntries(list.map(e => [e.id, e]));
  assert.deepEqual(byId['missing-contact-refuses-the-journal'].rules, ['JRN-CONTACT-EXISTS']);
  assert.match(byId['contact-and-bank-journals-are-accepted'].text, /is accepted by Zoho Books/);
  assert.match(byId['nothing-handled-goto-import-preview'].text, /Reload the page/);
  assert.equal(RULES.meta.version, '1.13');
  assert.equal(RULES.meta.changes.at(-1).version, '1.13');
});

test('a file gets its own lessons first, then the general ones; a lesson about journals is not said on other files', () => {
  const ids = key => importGuide(key).tips.map(t => t.id);
  assert.deepEqual(ids('other_journals').slice(0, 2), ['missing-contact-refuses-the-journal', 'contact-and-bank-journals-are-accepted']);
  assert.ok(ids('opening_balances_for_zoho_accounts').includes('missing-contact-refuses-the-journal'), 'OB-2 names contacts too');
  assert.ok(ids('vendors').includes('count-after-the-import'));
  assert.ok(!ids('invoices').includes('missing-contact-refuses-the-journal'));
  for (const key of ['accounts', 'customers', 'bills', 'invoices', 'journals']) assert.ok(ids(key).includes('nothing-handled-goto-import-preview'), key);
  assert.ok(importGuide('bills').tips.every(t => typeof t.general === 'boolean'));
  // both read-me files print every lesson
  const lines = whileImportingLines();
  assert.equal(lines[0], 'While you import');
  assert.equal(lines.filter(l => l.startsWith('   - ')).length, whileImporting().length);
});

test('no fixed months: the set-up says the Fiscal Year from the financial year of the migration', () => {
  const text = JSON.stringify([RULES.organisation_setup, RULES.import_order]);
  assert.doesNotMatch(text, /April - March/);
  assert.match(RULES.organisation_setup.find(o => o.step === 1).do, /Fiscal Year: the months of the financial year of the Tally company/);
  assert.equal(fiscalYearWords({ from: '2024-04-01', to: '2025-03-31' }), 'April - March');
  assert.equal(fiscalYearWords({ from: '2024-01-01', to: '2024-12-31' }), 'January - December');
  assert.equal(fiscalYearWords({ from: '2024-07-01', to: '2025-06-30' }), 'July - June');
  assert.equal(fiscalYearWords(null), '');
});

test('no advice tells a person to type a balance that a file already carries', () => {
  const all = [...RULES.general.rules, ...Object.values(RULES.modules).flatMap(m => m.rules || []), ...RULES.lists.error_messages];
  const fixes = all.map(r => `${r.id || r.pattern}: ${r.fix || ''}`);
  for (const f of fixes) assert.doesNotMatch(f, /Enter the balance afterwards|opening balance is entered in Settings|lists the balances to enter/, f);
  const bankMsg = RULES.lists.error_messages.find(e => (e.rule_ids || []).includes('COA-BANK-NO-OB'));
  assert.match(bankMsg.fix, /opening balance journal \(OB-1\)/);
  assert.match(bankMsg.fix, /No balance is typed/);
  assert.equal(RULES.modules.opening_balances.zoho_module, 'Settings > Setup & Configurations > Opening Balances');
  // the docs no longer tell to type a bank balance either
  assert.doesNotMatch(docs, /then enter each balance in \*\*Settings > Opening Balances\*\*/);
  assert.doesNotMatch(docs, /Empty the balance; enter it in Settings > Opening Balances/);
  assert.doesNotMatch(docs, /choose April - March/);
});

test('READ_ME_FIRST lists the assumptions and the lessons; nothing when there is no assumption', () => {
  const s = { steps: [{ kind: 'setup', items: [], questions: [] }] };
  const assumptions = { available: true, assumptions: [
    { kind: 'a', title: 'Suppliers taken as outside India', count: 2, words: 'Written as overseas with IGST reverse charge.', check: true, blocking: false, unconfirmed: true },
    { kind: 'b', title: 'TDS ledgers on Zoho\'s TDS accounts', count: 3, words: 'Entered on TDS Payable.', check: false, blocking: false, unconfirmed: false },
  ] };
  const text = readMeFirst({ company: 'Any Co', financial_year: '2030-31' }, s, [], { assumptions }).join('\n');
  assert.match(text, /\nAssumptions the tool made\n   Where nobody made a decision, the tool used a safe default so the files can be imported\. These 2 are in the files\./);
  assert.match(text, /   - Suppliers taken as outside India \(2\): Written as overseas with IGST reverse charge\. Please check\. Not confirmed by a Zoho import yet\./);
  assert.match(text, /   - TDS ledgers on Zoho's TDS accounts \(3\): Entered on TDS Payable\.\n/);
  assert.match(text, /\nWhile you import\n   - Import one file at a time/);
  assert.match(text, /gotoImportPreview/);
  assert.deepEqual(assumptionLines({ available: true, assumptions: [] }), []);
  assert.deepEqual(assumptionLines(null), []);
  assert.doesNotMatch(readMeFirst({ company: 'Any Co', financial_year: '2030-31' }, s).join('\n'), /Assumptions the tool made/);
});

test('vouchers held for a module file: the read-me says how to bring them in now with the default route', () => {
  const held = { available: true, notInAnyFile: 3, awaitingRouting: 0, modules: [{ module: 'Customer Payments', vouchers: 3, file: { buildable: false } }] };
  const text = heldLines(held).join('\n');
  assert.match(text, /choose the default in the tool: Voucher files, "Receipts from customers, payments to vendors, debit and credit notes": Manual Journals/);
  assert.doesNotMatch(text, /enter these vouchers by hand/);
  // a module whose file is built from the sample needs no such line
  assert.doesNotMatch(heldLines({ ...held, modules: [{ module: 'Customer Payments', vouchers: 3, file: { buildable: true } }] }).join('\n'), /choose the default/);
});

test('the dataset list says receipts, payments and notes go to Manual Journals', () => {
  const src = fs.readFileSync(new URL('../src/catalogue.js', import.meta.url), 'utf8');
  for (const key of ['receipt', 'payment', 'debit_note', 'credit_note']) {
    const line = src.split('\n').find(l => l.includes(`key: '${key}'`));
    assert.match(line, /zoho: 'Manual Journals \(/, key);
    assert.doesNotMatch(line, /sample needed/, key);
  }
});
