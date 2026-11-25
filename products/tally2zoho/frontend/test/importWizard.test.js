// The Import Wizard's small rules: where a step sits, how it is marked, and reading the Zoho check tolerantly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPosition, stepMark, expectedFromZohoCheck, count, optionLines, trialBalanceState, refusedFiles, refusedWords, creditGroups, firstCreditFilter, CREDIT_FILTERS, withHeldStep, stepFromParams, expectedTbState, verifyTone, WIZARD_SCREEN } from '../src/importWizard.js';
import { isKnownScreen, flowPosition, parseHash, buildHash } from '../src/navigation.js';

const steps = [{ id: 'setup' }, { id: 'accounts' }, { id: 'finish' }];

test('the wizard is a screen with its own address, and the last page of the guided flow', () => {
  assert.ok(isKnownScreen(WIZARD_SCREEN));
  assert.equal(buildHash(WIZARD_SCREEN), '#/import-wizard');
  assert.deepEqual(parseHash('#/import-wizard'), { screen: WIZARD_SCREEN, params: {} });
  assert.equal(flowPosition(WIZARD_SCREEN).next, null);
  assert.equal(flowPosition(WIZARD_SCREEN).prev.id, 'screen-25');
  // the screens it replaces keep their addresses
  for (const old of ['#/dependency-manager', '#/import-instructions', '#/import-tracker']) assert.ok(isKnownScreen(parseHash(old).screen), old);
});

test('Back and Next follow the list of steps; an unknown step is read as the first', () => {
  assert.deepEqual([stepPosition(steps, 'setup').prev, stepPosition(steps, 'setup').next.id, stepPosition(steps, 'setup').index], [null, 'accounts', 0]);
  assert.deepEqual([stepPosition(steps, 'finish').prev.id, stepPosition(steps, 'finish').next], ['accounts', null]);
  assert.equal(stepPosition(steps, 'gone').step.id, 'setup');
  assert.deepEqual(stepPosition(null, 'x'), { index: 0, step: null, prev: null, next: null, total: 0 });
});

test('how a step is marked in the side list', () => {
  assert.equal(stepMark({ done: true, locked: true }), 'done');
  assert.equal(stepMark({ done: false, locked: true }), 'locked');
  assert.equal(stepMark({ done: false, locked: false, importState: 'refused' }), 'attention');
  assert.equal(stepMark({ done: false, locked: false, file: { importState: 'failed' } }), 'attention');
  assert.equal(stepMark({ done: false, locked: false, importState: 'not_imported' }), 'open');
  assert.equal(stepMark(null), 'open');
});

test('the Zoho check is read whatever its layout, and nothing is shown when it has no counts', () => {
  assert.deepEqual(expectedFromZohoCheck({ files: [{ key: 'accounts', rows: 10, expectedAccepted: 8, expectedRefused: 2 }] }, 'accounts'), { accepted: 8, refused: 2, mayBeRefused: null, rows: 10 });
  assert.deepEqual(expectedFromZohoCheck({ files: { bills: { summary: { rows: 5, accepted: 5, refused: 0 } } } }, 'bills'), { accepted: 5, refused: 0, mayBeRefused: null, rows: 5 });
  assert.deepEqual(expectedFromZohoCheck({ modules: [{ module: 'items', willBeRefused: 3 }] }, 'items'), { accepted: null, refused: 3, mayBeRefused: null, rows: null });
  assert.equal(expectedFromZohoCheck({ files: [{ key: 'accounts', findings: [] }] }, 'accounts'), null);
  assert.equal(expectedFromZohoCheck({ files: [{ key: 'accounts', accepted: 1 }] }, 'customers'), null);
  assert.equal(expectedFromZohoCheck(null, 'accounts'), null);
  assert.equal(expectedFromZohoCheck({ error: 'Not Found' }, 'accounts'), null);
  assert.deepEqual([count(1234567), count(0), count(null)], ['12,34,567', '0', '–']);
});

test('what to choose on Zoho\'s import screens: the options of the click path with their reason, then what to leave', () => {
  const guide = {
    clicks: [{ text: 'Accountant', option: false }, { text: 'Duplicate Handling: Skip Duplicates', option: true, label: 'Duplicate Handling', value: 'Skip Duplicates' }, { text: 'Import', option: false }],
    notes: [{ label: 'Duplicate Handling', value: 'Skip Duplicates', why: 'Existing accounts stay.', others: ['Overwrite Accounts'], inPath: true }, { label: 'Auto number', value: 'NOT ticked', why: null, others: [], inPath: false }],
    defaults: ['File Delimiter: Comma'],
  };
  assert.deepEqual(optionLines(guide), [
    { label: 'Duplicate Handling', value: 'Skip Duplicates', why: 'Existing accounts stay.', others: ['Overwrite Accounts'], keep: false },
    { label: 'Auto number', value: 'NOT ticked', why: null, others: [], keep: false },
    { label: 'File Delimiter', value: 'Comma', why: null, others: [], keep: true },
  ]);
  assert.deepEqual(optionLines(null), []);
  assert.deepEqual(optionLines({}), []);
});

test('the last step: the Trial Balance comparison in one word', () => {
  assert.deepEqual(trialBalanceState({ check: null }), { state: 'none', accounts: 0 });
  assert.deepEqual(trialBalanceState(null), { state: 'none', accounts: 0 });
  assert.deepEqual(trialBalanceState({ check: {}, problem: 'no Tally TB' }), { state: 'problem', accounts: 0 });
  assert.deepEqual(trialBalanceState({ check: {}, comparison: { counts: { matched: 9, differing: 0, onlyTally: 0, onlyZoho: 0 } } }), { state: 'agrees', accounts: 0 });
  assert.deepEqual(trialBalanceState({ check: {}, comparison: { counts: { matched: 9, differing: 2, onlyTally: 1, onlyZoho: 0 } } }), { state: 'differs', accounts: 3 });
});

test('the old import screens open the wizard, and the sidebar lists the wizard once', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const old of ['screen-21', 'screen-26', 'screen-27']) assert.match(app, new RegExp(`'${old}': ImportWizardRedirect`), old);
  assert.match(app, new RegExp(`'${WIZARD_SCREEN}': Screen40_ImportWizard`));
  const sidebar = fs.readFileSync(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8');
  assert.equal((sidebar.match(new RegExp(`"${WIZARD_SCREEN}"`, 'g')) || []).length, 1);
  for (const old of ['screen-21', 'screen-26', 'screen-27']) assert.ok(!sidebar.includes(`"${old}"`), `${old} is not in the sidebar`);
});

test('the Zoho check as the server sends it: expected, will be refused, may be refused; files to confirm before download', () => {
  const check = { available: true, files: [
    { key: 'accounts', module: 'Chart of Accounts', rows: 10, rowsWill: 2, rowsMay: 1, accepted: 8, refused: 2, blocking: true },
    { key: 'items', module: 'Items', rows: 4, rowsWill: 0, rowsMay: 0, accepted: 4, refused: 0, blocking: false },
    { key: 'bills', module: 'Bills', rows: 3, rowsWill: 3, rowsMay: 0, accepted: 0, refused: 3, blocking: true, outOfDate: true },
  ] };
  assert.deepEqual(expectedFromZohoCheck(check, 'accounts'), { accepted: 8, refused: 2, mayBeRefused: 1, rows: 10 });
  assert.deepEqual(refusedFiles(check).map(f => f.key), ['accounts'], 'an out-of-date file is not in a download');
  assert.deepEqual(refusedFiles(check, ['items']), []);
  assert.deepEqual(refusedFiles(check, ['accounts', 'items']), [{ key: 'accounts', module: 'Chart of Accounts', rows: 10, rowsWill: 2 }]);
  assert.deepEqual(refusedFiles({ available: false }), []);
  // a file whose opening balances wait for the Migration Date: nothing is refused, but the download asks first
  const dated = { available: true, files: [
    { key: 'customers', module: 'Customers', rows: 9, rowsWill: 0, blocking: false, download: 'confirm_date', dateRows: 2 },
    { key: 'vendors', module: 'Vendors', rows: 5, rowsWill: 0, blocking: false, download: 'confirm_date', dateRows: 1 },
    { key: 'accounts', module: 'Chart of Accounts', rows: 10, rowsWill: 2, blocking: true, download: 'confirm' },
    { key: 'items', module: 'Items', rows: 4, rowsWill: 0, blocking: false, download: 'ok' }] };
  assert.deepEqual(refusedFiles(dated, ['customers', 'items']), [{ key: 'customers', module: 'Customers', rows: 9, rowsWill: 0, waitsForDate: true, dateRows: 2 }]);
  const words = refusedWords(refusedFiles(dated));
  assert.equal(words.length, 2);
  assert.match(words[0], /^Zoho Books is expected to refuse 2 of 10 rows of Chart of Accounts\. Fix them first, or download anyway\.$/);
  assert.match(words[1], /^Customers \(2 opening balances\) and Vendors \(1 opening balance\) must not be imported before the Migration Date is saved and checked in Zoho Books/);
  assert.deepEqual(refusedWords([]), []);
  assert.deepEqual(refusedFiles(null), []);
});

// The page "Apply the credits" (after the journals): the list of GET credits-to-apply, grouped by contact.
test('apply the credits: the rows are grouped by contact, filtered by what to do, and added up without rounding errors', () => {
  const row = (type, contact, journal, what, number, amount) => ({ 'Contact Type': type, Contact: contact, 'Journal Number': journal, 'Journal Date': '2024-05-01', 'What To Do': what, 'Invoice or Bill Number': number, Amount: amount, what });
  const list = [
    row('Customer', 'Alder Retail', 'RCT-1', 'apply', 'INV-1', '0.10'), row('Customer', 'Alder Retail', 'RCT-2', 'apply', 'INV-2', '0.20'),
    row('Customer', 'Alder Retail', 'RCT-2', 'leave', '', '50.00'), row('Vendor', 'Elm Works', 'PMT-1', 'apply', 'B-1', '500.00'),
    row('Vendor', 'Alder Retail', 'PMT-2', 'opening_balance', '', '7.00'),
  ];
  const apply = creditGroups(list, 'apply');
  assert.deepEqual(apply.map(g => [g.contactType, g.contact, g.rows.length, g.amount]), [['Customer', 'Alder Retail', 2, '0.30'], ['Vendor', 'Elm Works', 1, '500.00']]);
  // a customer and a vendor of the same name are two groups
  assert.deepEqual(creditGroups(list, 'all').map(g => [g.contactType, g.contact, g.rows.length]), [['Customer', 'Alder Retail', 3], ['Vendor', 'Elm Works', 1], ['Vendor', 'Alder Retail', 1]]);
  assert.deepEqual(creditGroups(list, 'leave').map(g => g.amount), ['50.00']);
  assert.deepEqual([creditGroups(null), creditGroups([], 'all')], [[], []]);
  // the page opens on the rows to apply; with none, on the opening balance rows; with neither, on everything
  assert.equal(firstCreditFilter([{ id: 'apply', rows: 3 }, { id: 'leave', rows: 9 }]), 'apply');
  assert.equal(firstCreditFilter([{ id: 'apply', rows: 0 }, { id: 'opening_balance', rows: 1 }]), 'opening_balance');
  assert.equal(firstCreditFilter([{ id: 'apply', rows: 0 }, { id: 'leave', rows: 2 }]), 'all');
  assert.equal(firstCreditFilter(null), 'all');
  assert.deepEqual(CREDIT_FILTERS.map(f => f.id), ['apply', 'opening_balance', 'leave', 'all']);
});

test('the credits page is a step of its own with an address; with nothing held there is no "Not in any file yet" step', () => {
  const steps = [{ id: 'setup', kind: 'setup' }, { id: 'other_journals', kind: 'file' }, { id: 'credits', kind: 'credits', done: false, locked: true }, { id: 'finish', kind: 'finish' }];
  assert.equal(stepFromParams(steps, { step: 'credits' }, 'setup'), 'credits');
  assert.equal(stepMark(steps[2]), 'locked');
  assert.equal(stepMark({ ...steps[2], locked: false }), 'open');
  assert.equal(stepMark({ ...steps[2], locked: false, done: true }), 'done');
  // nothing held (the default: payments are Manual Journals): the list of steps is the server's, numbered
  assert.deepEqual(withHeldStep(steps, { notInAnyFile: 0, modules: [] }).map(s => [s.id, s.n]), [['setup', 1], ['other_journals', 2], ['credits', 3], ['finish', 4]]);
  // vouchers held (the route "module_files"): the open item comes just before the comparison, after the credits page
  assert.deepEqual(withHeldStep(steps, { notInAnyFile: 2, modules: [] }).map(s => s.id), ['setup', 'other_journals', 'credits', 'held', 'finish']);
});

test('a master file whose records did not all arrive in Zoho Books is marked for attention, not as open', () => {
  assert.equal(stepMark({ done: false, locked: false, importState: 'missing_in_zoho' }), 'attention');
  assert.equal(stepMark({ done: false, locked: false, importState: 'short' }), 'attention');
  assert.equal(verifyTone({ state: 'missing' }), 'warning');
  assert.equal(verifyTone({ state: 'all_there' }), 'success');
  assert.equal(verifyTone({ state: 'not_given' }), 'info');
  assert.equal(verifyTone(null), null);
});

test('the expected Zoho trial balance: agrees, only rounding, or rows to look at (accounts, contacts, accounts that must end at zero)', () => {
  const f = (signed, side = Number(signed) < 0 ? 'Debit' : Number(signed) > 0 ? 'Credit' : '') => ({ amount: String(Math.abs(Number(signed)).toFixed(2)), side, signed });
  assert.equal(expectedTbState(null).state, 'none');
  assert.equal(expectedTbState({ available: false, message: 'Create the files first.' }).headline, 'Create the files first.');
  assert.equal(expectedTbState({ available: true, comparison: null, words: 'nothing to compare' }).state, 'problem');
  const empty = { accounts: { differing: [], onlyTally: [], onlyZoho: [] }, contacts: { customers: { rows: [] }, vendors: { rows: [] } }, mustBeZero: [{ account: 'Suspense', ok: true }] };
  assert.equal(expectedTbState({ available: true, comparison: empty, words: 'same' }).state, 'agrees');
  const rounding = { ...empty, accounts: { ...empty.accounts, differing: [{ account: 'Tax Out', tally: f('10.00'), zoho: f('10.01'), difference: f('0.01'), rounding: true, sources: [] }] } };
  assert.equal(expectedTbState({ available: true, comparison: rounding }).state, 'rounding');
  const differs = { ...empty,
    accounts: { differing: [], onlyTally: [{ account: 'Old Ledger', tally: f('-5.00'), zoho: f('0'), difference: f('5.00'), rounding: false }], onlyZoho: [{ account: 'Adjust Here', zoho: f('2.00'), sources: [{ label: 'Invoices' }], rounding: false }] },
    contacts: { customers: { rows: [{ contact: 'A Buyer', tally: f('-3.00'), zoho: f('-1.00'), difference: f('2.00'), rounding: false }] }, vendors: { rows: [] } },
    mustBeZero: [{ account: 'Balancing Account', ok: false, predicted: f('-7.00'), expected: f('0'), words: 'must be zero', sources: [{ label: 'Opening balance journal' }] }] };
  const s = expectedTbState({ available: true, comparison: differs, words: 'differs' });
  assert.equal(s.state, 'differs');
  assert.deepEqual(s.rows.map(r => [r.part, r.name, r.difference.signed, r.from]), [
    ['Must end at zero', 'Balancing Account', '-7.00', 'Opening balance journal'],
    ['Account', 'Old Ledger', '5.00', 'In Tally only: no file posts to it'],
    ['Account', 'Adjust Here', '2.00', 'Invoices'],
    ['Customer', 'A Buyer', '2.00', ''],
  ]);
  assert.equal(s.real, 4);
});
