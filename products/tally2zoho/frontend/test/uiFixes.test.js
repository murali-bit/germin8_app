// UI audit fixes: the wizard's step in the address, the "Not in any file yet" step, one import order, the progress
// strip from the guided flow, the completeness table's open item, and the Zoho check's "Fix" filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFromParams, withHeldStep, sortByImportOrder, completenessRowState, countDifferenceWords, stepMark, HELD_STEP, WIZARD_SCREEN } from '../src/importWizard.js';
import { screenKey, buildHash, parseHash, flowProgress, FLOW } from '../src/navigation.js';
import { contactFilterForRule, taxNeedsPerson } from '../src/mappingLogic.js';

const steps = [{ id: 'setup', kind: 'setup' }, { id: 'accounts', kind: 'file' }, { id: 'customers', kind: 'file' }, { id: 'finish', kind: 'finish' }];

test('the wizard step is in the address, and changing it does not remount the screen', () => {
  assert.equal(buildHash(WIZARD_SCREEN, { step: 'customers' }), '#/import-wizard?step=customers');
  assert.deepEqual(parseHash('#/import-wizard?step=customers'), { screen: WIZARD_SCREEN, params: { step: 'customers' } });
  // the key a screen is mounted under ignores the step, so Back / Forward between steps keeps the page
  assert.equal(screenKey(WIZARD_SCREEN, { step: 'accounts' }), screenKey(WIZARD_SCREEN, { step: 'customers' }));
  assert.equal(screenKey(WIZARD_SCREEN, {}), '#/import-wizard');
  // other screens keep every param in their key
  assert.notEqual(screenKey('screen-38', { file: 'bills' }), screenKey('screen-38', { file: 'invoices' }));
  // the step shown: the address, else the one the server remembers, else the first
  assert.equal(stepFromParams(steps, { step: 'customers' }, 'accounts'), 'customers');
  assert.equal(stepFromParams(steps, { step: 'nope' }, 'accounts'), 'accounts');
  assert.equal(stepFromParams(steps, {}, 'gone'), 'setup');
  assert.equal(stepFromParams([], {}, null), null);
});

test('"Not in any file yet" comes before the trial balance comparison while vouchers are held, and is never done', () => {
  const held = { notInAnyFile: 191, modules: [{ key: 'payments_made', vouchers: 157 }], words: '468 written to files, 191 not in any file yet' };
  const out = withHeldStep(steps, held);
  assert.deepEqual(out.map(s => s.id), ['setup', 'accounts', 'customers', HELD_STEP, 'finish']);
  assert.deepEqual(out.map(s => s.n), [1, 2, 3, 4, 5]);
  const h = out.find(s => s.id === HELD_STEP);
  assert.deepEqual([h.done, h.locked, h.held.notInAnyFile, stepMark(h)], [false, false, 191, 'held']);
  // nothing held: no such step, and none left from before
  assert.deepEqual(withHeldStep(out, { notInAnyFile: 0 }).map(s => s.id), ['setup', 'accounts', 'customers', 'finish']);
  assert.deepEqual(withHeldStep(steps, null).map(s => s.id), ['setup', 'accounts', 'customers', 'finish']);
  // no finish step: at the end
  assert.equal(withHeldStep(steps.slice(0, 2), held).at(-1).id, HELD_STEP);
  // the address can open it
  assert.equal(stepFromParams(out, { step: HELD_STEP }, 'setup'), HELD_STEP);
});

test('one import order: every list follows the server import list, files not in it come last as they were', () => {
  const order = [{ key: 'accounts' }, { key: 'customers' }, { key: 'vendors' }, { key: 'items' }, { key: 'opening_balances_for_zoho_accounts' }, { key: 'bills' }, { key: 'invoices' }];
  const files = [{ key: 'invoices' }, { key: 'opening_balances' }, { key: 'accounts' }, { key: 'opening_balances_for_zoho_accounts' }, { key: 'bills' }, { key: 'customers' }];
  assert.deepEqual(sortByImportOrder(files, order).map(f => f.key), ['accounts', 'customers', 'opening_balances_for_zoho_accounts', 'bills', 'invoices', 'opening_balances']);
  // the order can be keys too, and an empty order keeps the list as it is
  assert.deepEqual(sortByImportOrder([{ key: 'b' }, { key: 'a' }], ['a', 'b']).map(f => f.key), ['a', 'b']);
  assert.deepEqual(sortByImportOrder([{ key: 'b' }, { key: 'a' }], []).map(f => f.key), ['b', 'a']);
  assert.deepEqual(sortByImportOrder(null, order), []);
});

test('the progress strip has the steps of the guided flow; a step is done only when the ones before it are', () => {
  const strip = flowProgress({ 'screen-12': true, 'screen-15': true, 'screen-17': true });
  assert.equal(strip.length, FLOW.length);
  assert.deepEqual(strip.map(s => s.state), ['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(strip.map(s => s.n), FLOW.map((_, i) => i + 1));
  assert.equal(flowProgress({}).filter(s => s.state === 'current').length, 1);
});

test('the completeness table: vouchers held for a Zoho sample are an open item, never "Explained"', () => {
  assert.equal(completenessRowState({ status: 'explained', reasons: [{ kind: 'held:payments_made', count: 157 }] }), 'not_in_file');
  assert.equal(completenessRowState({ status: 'explained', reasons: [{ kind: 'left_out:cancelled', count: 2 }] }), 'explained');
  assert.equal(completenessRowState({ status: 'not_matched', reasons: [{ kind: 'held:payments_made' }] }), 'not_matched');
  assert.equal(completenessRowState({ status: 'matches', reasons: [] }), 'matches');
  assert.equal(completenessRowState(null), 'no_files');
  assert.equal(countDifferenceWords(-3), '3 more in Zoho');
  assert.equal(countDifferenceWords(0), '0');
  assert.equal(countDifferenceWords(null), '–');
});

test('Zoho check "Fix" opens Fix contacts with the filter of the rule; one rule for tax ledgers that need a person', () => {
  assert.equal(contactFilterForRule('CUS-GSTIN-REQUIRED-WHEN-REGISTERED'), 'registered_without_gstin');
  assert.equal(contactFilterForRule('VEN-GSTIN-FORMAT'), 'gstin_format');
  assert.equal(contactFilterForRule('CUS-GST-TREATMENT-EMPTY'), 'treatment_other');
  assert.equal(contactFilterForRule('INV-ITEM-EXISTS'), '');
  assert.equal(contactFilterForRule(undefined), '');
  // the same rule as the server's taxLedgersToDecide: only a GST ledger used as a tax row, not mapped, not automatic
  assert.equal(taxNeedsPerson({ kind: 'gst', needsPerson: true, source: 'none', taxRowVouchers: 3 }), true);
  assert.equal(taxNeedsPerson({ kind: 'gst', needsPerson: true, source: 'none', taxRowVouchers: 0 }), false);
  assert.equal(taxNeedsPerson({ kind: 'gst', needsPerson: true, source: 'explicit', taxRowVouchers: 3 }), false);
  assert.equal(taxNeedsPerson({ kind: 'tds', needsPerson: true, taxRowVouchers: 3 }), false);
  assert.equal(taxNeedsPerson({ kind: 'gst', needsPerson: false, source: 'auto', taxRowVouchers: 3 }), false);
});
