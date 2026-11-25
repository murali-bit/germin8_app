// The words of the Import Wizard pages, worked out from the server's fields, and the help texts that must say that
// receipts, payments, contra and notes reach Zoho Books (as Manual Journals). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heldWords, openingWords, fileTips, stillOpenRows } from '../src/importWizard.js';
import { UPLOAD_HELP, ALL_TRANSACTIONS_HELP, ALL_TRANSACTIONS_STEPS } from '../src/screens/app/uploadHelp.js';

test('opening balances: the journal is the plan; the list to type is shown only without a file or after a refusal', () => {
  const lines = [{ id: 'a', account: 'Town Bank', side: 'Debit', amount: '10.00' }];
  const file = { key: 'opening_balances_for_zoho_accounts', rows: 3 };
  const withFile = openingWords({ file, lines, journalDate: { nice: '31/12/2023' }, typeNeeded: false, contactCredits: 0 });
  assert.equal(withFile.typing, 'hidden');
  assert.match(withFile.intro, /OB-1, dated 31\/12\/2023, carries every opening balance that is not in the Chart of Accounts, Customers or Vendors file/);
  assert.match(withFile.intro, /Nothing is typed\./);
  assert.doesNotMatch(withFile.intro, /OB-2/);
  assert.match(openingWords({ file, lines, journalDate: { nice: '31/12/2023' }, typeNeeded: false, contactCredits: 2 }).intro, /Journal OB-2 in the same file carries the customers in credit and the vendors in debit/);
  const refused = openingWords({ file, lines, typeNeeded: true });
  assert.deepEqual([refused.typing, refused.typeTitle], ['refused', 'Zoho refused the journal: type these balances instead']);
  const noFile = openingWords({ file: null, lines, typeNeeded: true });
  assert.equal(noFile.typing, 'plan');
  assert.match(noFile.intro, /in no file\. Type each one once/);
  assert.equal(openingWords({ file, lines: [] }).typing, 'none');
  assert.equal(openingWords({ file: null, lines: [] }).typing, 'none');
});

test('vouchers in no file: the words say they are held only because Payments files were chosen, and how to bring them in', () => {
  const held = { notInAnyFile: 7, awaitingRouting: 1, modules: [{ module: 'Payments Received', vouchers: 4, file: null }, { module: 'Payments Made', vouchers: 2, file: { buildable: true } }] };
  const w = heldWords(held);
  assert.match(w, /^Payments Received 4, Payments Made 2\./);
  assert.match(w, /held because Payments files were chosen in Voucher files instead of the default, Manual Journals/);
  assert.match(w, /1 journal voucher waits for a decision in Voucher Classification\./);
  assert.doesNotMatch(w, /by hand/);
  // every module file built from a sample: nothing to choose
  assert.doesNotMatch(heldWords({ modules: [{ module: 'Payments Made', vouchers: 2, file: { buildable: true } }] }), /Payments files were chosen/);
  // only journals waiting for a decision: no word about samples
  assert.equal(heldWords({ modules: [], awaitingRouting: 3 }), '3 journal vouchers wait for a decision in Voucher Classification.');
  assert.equal(heldWords(null), '');
});

test('a file step lists its own tips first, then the general ones; the finish step lists what is still open', () => {
  const f = { guide: { tips: [{ id: 'general-one', text: 'Reload the page.', general: true }, { id: 'journal-one', text: 'A missing contact refuses the journal.', general: false }, { id: 'empty', text: '' }] } };
  assert.deepEqual(fileTips(f).map(t => t.id), ['journal-one', 'general-one']);
  assert.deepEqual(fileTips({}), []);
  const finish = { stillOpen: [{ step: 'customers', words: 'Customers is not imported yet.' }, { step: 'held', words: '3 vouchers are in no file.' }] };
  assert.deepEqual(stillOpenRows(finish, [{ id: 'customers' }, { id: 'finish' }]), [
    { step: 'customers', words: 'Customers is not imported yet.', canGo: true },
    { step: 'held', words: '3 vouchers are in no file.', canGo: false },
  ]);
  assert.deepEqual(stillOpenRows({}, []), []);
});

test('help texts: receipts, payments, contra and notes reach Zoho Books as Manual Journals; no fixed months', () => {
  for (const k of ['receipt', 'payment', 'contra', 'debit_note', 'credit_note']) {
    assert.doesNotMatch(UPLOAD_HELP[k].tip, /no Zoho file/i, k);
    assert.match(UPLOAD_HELP[k].tip, /Manual Journals/, k);
  }
  assert.match(UPLOAD_HELP.other_vouchers.tip, /no Zoho file is created/, 'other voucher types still have no file');
  assert.ok(ALL_TRANSACTIONS_HELP.checks.some(c => /Credit Notes are written as Manual Journals/.test(c)));
  assert.ok(!ALL_TRANSACTIONS_STEPS.some(s => /April|March/.test(s)), 'the period is the financial year of the migration, whatever its months');
  // the screens that said these vouchers get no file
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const guide = read('../src/screens/app/Screen13_TallyExportGuide.jsx');
  assert.doesNotMatch(guide, /Credit Notes are read and kept; no Zoho file is created for these yet/);
  assert.doesNotMatch(guide, /1 April to 31 March/);
  assert.doesNotMatch(read('../src/screens/app/Screen20_TransactionClassification.jsx'), /\(sample needed\)/);
  assert.doesNotMatch(read('../src/screens/app/Screen22_TemplateLibrary.jsx'), /have no file yet/);
  assert.doesNotMatch(read('../src/components/HeldNotice.jsx'), /entered by hand/);
});

test('the Import Wizard screen shows every server step and field of this batch', () => {
  const screen = fs.readFileSync(new URL('../src/screens/app/Screen40_ImportWizard.jsx', import.meta.url), 'utf8');
  // the Migration Date check (the date Zoho Books shows), the export upload of a master, the credits page, the
  // predicted trial balance, the required SEZ / Overseas tick, the tips, what is still open, the assumptions
  for (const s of ['z.route', 'v.uploadRoute', 'credits-to-apply', '<ExpectedTrialBalance', 't.required', 'fileTips(f)', 'stillOpenRows(step, steps)', '<Assumptions', 'openingWords(step)', 'step.itemsNotNeeded']) {
    assert.ok(screen.includes(s), s);
  }
  for (const kind of ['setup', 'bank', 'date', 'opening', 'credits', 'held', 'finish']) assert.ok(screen.includes(`step.kind === '${kind}'`), kind);
});
