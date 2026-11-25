// node --test extension/tests/linked-dummy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../js/linked/dummy-fill.js');

test('placeholders are allowed only when the company master says LINKED_DUMMY_OK = Yes', () => {
  assert.equal(T.allowed({ LINKED_DUMMY_OK: 'Yes' }), true);
  assert.equal(T.allowed({ LINKED_DUMMY_OK: 'yes ' }), true);
  assert.equal(T.allowed({ LINKED_DUMMY_OK: 'No' }), false);
  assert.equal(T.allowed({}), false);
  assert.equal(T.allowed(null), false);
});

test('placeholder answers fit the question type and the formats MCA expects', () => {
  T.fyFrom = '01/04/2025'; T.fyTo = '31/03/2026';
  assert.equal(T.dummy({ key: 'AGM_DATE', label: '7(b) Date of AGM', type: 'date' }), '31/03/2026');
  assert.equal(T.dummy({ key: 'X', type: 'select', options: ['Yes', 'No'] }), 'No');
  assert.equal(T.dummy({ key: 'X', type: 'select', options: ['Chartered Accountant', 'Cost Accountant'] }), 'Chartered Accountant');
  assert.ok(T.dummy({ key: 'BOARD_RESOLUTION_NO' }).length <= 10, 'fits MCA 10-character box');
  assert.equal(T.dummy({ key: 'EMP_FEMALE', type: 'number' }), '0');
  assert.equal(T.dummy({ key: 'EMPHASIS', label: '1(c) Emphasis of matter', type: 'textarea' }), 'Nil');
  assert.equal(T.dummy({ key: 'ROWS', label: 'AOC-2 rows' }), '[]');
  const meetings = T.dummy({ key: 'BOARD_MEETINGS', type: 'textarea' }).split(String.fromCharCode(10));
  assert.equal(meetings.length, 4);
  assert.match(meetings[0], /^\d{2}\/\d{2}\/2025 \| 2 \| 2$/);
});

// ── pageLinkedFillEmpty (MCA tab) on a tiny fake DOM ──
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { FakeEl, installDom } from './fake-dom.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis.window || globalThis;
vm.runInThisContext(readFileSync(path.join(here, '../js/linked/dummy-fill.js'), 'utf8'), { filename: 'dummy-fill.js' });

// An empty box MCA marks required, with its label in the AEM field wrapper.
const box = (label, attrs = {}) => {
  const input = new FakeEl('input', { type: 'text', attrs: { required: '', ...attrs } });
  const field = new FakeEl('div', { cls: 'guideFieldNode', children: [new FakeEl('label', { cls: 'guideFieldLabel', text: label }), input] });
  return { field, input };
};

test('placeholder fill: "pin" only as a word — opinion / shipping boxes never get a PIN code', async () => {
  const opinion = box('Basis for qualified opinion');
  const shipping = box('Shipping remarks');
  const pin = box('Pin code');
  const pincode = box('PINCODE of registered office');
  installDom([opinion.field, shipping.field, pin.field, pincode.field]);
  const r = await pageLinkedFillEmpty({ from: '01/04/2025', to: '31/03/2026' });
  assert.equal(r.filled.length, 4);
  assert.equal(opinion.input.value, 'Not applicable');
  assert.equal(shipping.input.value, 'Not applicable');
  assert.equal(pin.input.value, '560001');
  assert.notEqual(pincode.input.value, '', 'still filled');
});

test('placeholder fill: login / search / captcha boxes are skipped, camelCase ids included; rootPanel is not', async () => {
  const skip = [
    box('Enter the code', { id: 'captchaInput' }),
    box('Search', { id: 'globalSearchText' }),
    box('One time password', { id: 'otpValue' }),
    box('User', { id: 'userId' }),
    box('User', { name: 'user_id' }),
    box('Pass', { id: 'loginPasswordField' }),
  ];
  const root = box('Remarks', { id: 'rootPanel_remarks' });
  installDom([...skip.map(b => b.field), root.field]);
  const r = await pageLinkedFillEmpty({ from: '01/04/2025', to: '31/03/2026' });
  for (const b of skip) assert.equal(b.input.value, '', `${b.input.id || b.input.name} untouched`);
  assert.equal(root.input.value, 'Not applicable');
  assert.equal(r.filled.length, 1);
});
