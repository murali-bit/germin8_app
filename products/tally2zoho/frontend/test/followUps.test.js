// The follow-ups of the server fix round: "Do this first in Zoho Books", the TDS export upload, the journal default
// that fell back to a Manual Journal, reviews made before the files were read again, a viewer's "Download anyway", and
// when Prepare migration reads its state on a timer. Every name here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preStepList, downloadAddress, tdsUploadWords } from '../src/importWizard.js';
import { fallbackSentence, reviewWords } from '../src/mappingLogic.js';
import { prepareShouldPoll, PREPARE_POLL_MS } from '../src/prepareLogic.js';

test('"Do this first in Zoho Books" reads the Zoho check\'s preSteps and the wizard\'s createFirst alike', () => {
  const fromCheck = preStepList([{ id: 'COA-TYPE-LONG-TERM-LIABILITY', ruleId: 'COA-TYPE-LONG-TERM-LIABILITY', files: ['accounts'], rows: 1,
    what: 'Create this account by hand first.', where: 'Accountant > Chart of Accounts > New Account', then: 'Import with Skip Duplicates.' }]);
  assert.deepEqual(fromCheck, [{ id: 'COA-TYPE-LONG-TERM-LIABILITY', what: 'Create this account by hand first.', path: ['Accountant', 'Chart of Accounts', 'New Account'],
    then: 'Import with Skip Duplicates.', rows: 1, accounts: [], files: ['accounts'] }]);
  const fromWizard = preStepList({ accounts: [{ account: 'Term Loan: Birch', accountType: 'Long Term Liability' }], path: ['Accountant', 'Chart of Accounts', 'New Account'], words: 'Before this import, create this account by hand.' });
  assert.equal(fromWizard.length, 1);
  assert.deepEqual([fromWizard[0].path.length, fromWizard[0].accounts[0].account, fromWizard[0].rows, fromWizard[0].files], [3, 'Term Loan: Birch', 1, ['accounts']]);
  // nothing to do: nothing shown
  assert.deepEqual(preStepList(null), []);
  assert.deepEqual(preStepList([]), []);
  assert.deepEqual(preStepList({ accounts: [] }), []);
  assert.deepEqual(preStepList([{ rows: 2 }]), [], 'a step that says nothing is not shown');
});

test('a viewer\'s "Download anyway" is carried by the download itself; others acknowledge first', () => {
  assert.equal(downloadAddress('/api/migrations/M1/files/bills/download', { viewer: true, confirmed: true }), '/api/migrations/M1/files/bills/download?confirmed=1');
  assert.equal(downloadAddress('/api/x?y=1', { viewer: true, confirmed: true }), '/api/x?y=1&confirmed=1');
  assert.equal(downloadAddress('/api/migrations/M1/download-all', { viewer: false, confirmed: true }), '/api/migrations/M1/download-all');
  assert.equal(downloadAddress('/api/migrations/M1/download-all', { viewer: true, confirmed: false }), '/api/migrations/M1/download-all', 'nothing to confirm: the plain address');
});

test('the TDS export upload says what it read', () => {
  assert.match(tdsUploadWords({ given: false, taxes: 0 }), /^No file yet/);
  assert.match(tdsUploadWords({ given: true, taxes: 12, fileName: 'tds.csv' }), /^12 TDS taxes read from "tds.csv"\./);
  assert.match(tdsUploadWords({ given: true, taxes: 1 }), /^1 TDS tax read\./);
  assert.equal(tdsUploadWords(null), '');
});

test('a journal whose default fell back to a Manual Journal says why; a decision or another default says nothing', () => {
  const j = { suggested: 'Bill', defaultDecision: 'Manual Journal', defaultFallbackWords: 'it would have lines Zoho refuses ("Specify either a Tax or Tax Exemption or Reverse Charge.")' };
  assert.equal(fallbackSentence(j), 'Manual Journal by default, not the suggested Bill: it would have lines Zoho refuses ("Specify either a Tax or Tax Exemption or Reverse Charge.").');
  assert.equal(fallbackSentence({ ...j, decision: 'Bill' }), '');
  assert.equal(fallbackSentence({ ...j, defaultDecision: 'Bill' }), '');
  assert.equal(fallbackSentence({ ...j, defaultFallbackWords: null }), '');
  assert.match(fallbackSentence({ ...j, suggested: 'Manual Journal' }), /^Manual Journal by default, not a Bill or Invoice:/);
});

test('"Accepted as per Tally" says when it was accepted before the files were read again', () => {
  assert.equal(reviewWords({ by: 'a@b.c', beforeReprocess: false }), 'Accepted as per Tally by a@b.c');
  assert.equal(reviewWords({ by: 'a@b.c', beforeReprocess: true }), 'Accepted as per Tally by a@b.c (accepted before the files were read again)');
  assert.equal(reviewWords(null), '');
});

test('Prepare migration polls only while processing or file creation runs', () => {
  const state = active => ({ steps: [{ key: 'upload' }, { key: 'process', active }] });
  assert.equal(prepareShouldPoll(state(true)), true);
  assert.equal(prepareShouldPoll(state(false)), false);
  assert.equal(prepareShouldPoll(state(false), { creating: true }), true);
  assert.equal(prepareShouldPoll(null), false);
  assert.equal(PREPARE_POLL_MS, 4000);
});
