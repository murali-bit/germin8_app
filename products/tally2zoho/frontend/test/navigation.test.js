// Screen addresses, the guided flow, and that every screen id used anywhere in the app is a real screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREEN_LIST, FLOW, isKnownScreen, parseHash, buildHash, flowPosition, backTarget, sameRoute, HOME, NOT_FOUND } from '../src/navigation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('every screen id written in the app or sent by the server is a known screen', () => {
  const files = [...walk(path.join(here, '../src')), ...walk(path.join(here, '../../server/src'))].filter(f => /\.(jsx?|mjs)$/.test(f));
  const used = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/screen-\d+/g)) used.add(m[0]);
  assert.ok(used.has('screen-36'), 'Prepare migration is linked');
  for (const id of used) assert.ok(isKnownScreen(id), `${id} is used but is not a screen`);
});

test('every screen in App.jsx has an address, and every address is a screen in App.jsx', () => {
  const app = fs.readFileSync(path.join(here, '../src/App.jsx'), 'utf8');
  const inApp = new Set([...app.matchAll(/'(screen-\d+)':/g)].map(m => m[1]));
  assert.deepEqual([...inApp].sort(), SCREEN_LIST.map(s => s.id).sort());
  assert.equal(new Set(SCREEN_LIST.map(s => s.slug)).size, SCREEN_LIST.length, 'addresses are unique');
});

test('addresses: build and read back, old style ids, unknown pages, empty address', () => {
  for (const s of SCREEN_LIST) assert.deepEqual(parseHash(buildHash(s.id)), { screen: s.id, params: {} });
  assert.equal(buildHash('screen-36'), '#/prepare-migration');
  assert.deepEqual(parseHash('#/new-migration?edit=1'), { screen: 'screen-12', params: { edit: '1' } });
  assert.deepEqual(parseHash('#/screen-15'), { screen: 'screen-15', params: {} });
  assert.deepEqual(parseHash(''), { screen: HOME, params: {} });
  assert.deepEqual(parseHash('#/'), { screen: HOME, params: {} });
  assert.deepEqual(parseHash('#/no-such-page'), { screen: NOT_FOUND, params: {}, unknown: 'no-such-page' });
  assert.equal(parseHash('#/screen-99').screen, NOT_FOUND);
  assert.equal(isKnownScreen('constructor'), false);
  assert.ok(sameRoute({ screen: 'screen-12', params: { edit: '1' } }, parseHash('#/new-migration?edit=1')));
  assert.ok(!sameRoute({ screen: 'screen-12', params: {} }, parseHash('#/new-migration?edit=1')));
});

test('the guided flow: one step per page, Back to New Migration opens the saved details', () => {
  // every step is its own page; the Progress checklist (screen-36) is an overview, not a step
  assert.deepEqual(FLOW.map(s => s.id), ['screen-12', 'screen-15', 'screen-16', 'screen-17', 'screen-19', 'screen-20', 'screen-25', 'screen-40']);
  for (const s of FLOW) assert.ok(isKnownScreen(s.id));
  const first = flowPosition('screen-12');
  assert.equal(first.prev, null);
  assert.equal(first.next.id, 'screen-15', 'New Migration goes on to the Upload Center page');
  assert.equal(flowPosition('screen-36'), null, 'the Progress checklist is not a step');
  assert.deepEqual(backTarget(flowPosition('screen-15').prev), { screen: 'screen-12', params: { edit: '1' } });
  assert.deepEqual(backTarget(flowPosition('screen-16').prev), { screen: 'screen-15', params: {} });
  const last = flowPosition('screen-40');
  assert.equal(last.next, null);
  assert.equal(last.index + 1, last.total);
  assert.equal(flowPosition('screen-18'), null, 'screens outside the flow have no Back / Continue bar');
});

test('Voucher Reconciliation has its own address and is not a step of the guided flow', () => {
  assert.equal(buildHash('screen-37'), '#/voucher-reconciliation');
  assert.deepEqual(parseHash('#/voucher-reconciliation'), { screen: 'screen-37', params: {} });
  assert.equal(flowPosition('screen-37'), null);
});

test('in-app Back goes back in the browser history when it returns to the page it came from', async () => {
  const { historyMove } = await import('../src/navigation.js');
  assert.equal(historyMove('#/upload-center', '#/prepare-migration', { from: '#/prepare-migration' }, { back: true }), 'back');
  assert.equal(historyMove('#/upload-center', '#/prepare-migration', { from: '#/dashboard' }, { back: true }), 'replace');
  assert.equal(historyMove('#/upload-center', '#/prepare-migration', null, { back: true }), 'replace');
  assert.equal(historyMove('#/a', '#/b', null, {}), 'push');
  assert.equal(historyMove('#/a', '#/a', null, {}), 'none');
  assert.equal(historyMove('#/a', '#/b', { from: '#/b' }, { replace: true }), 'replace');
});

test('the side menu numbers the pages of the guided flow, and New Migration goes on to the Upload Center', async () => {
  const { flowStepNumber } = await import('../src/navigation.js');
  assert.equal(flowStepNumber('screen-12'), 1);
  assert.equal(flowStepNumber('screen-15'), 2);
  assert.equal(flowStepNumber('screen-40'), FLOW.length);
  assert.equal(flowStepNumber('screen-36'), null);
  assert.equal(flowStepNumber('screen-18'), null);
  const page = fs.readFileSync(path.join(here, '../src/screens/app/Screen12_NewMigration.jsx'), 'utf8');
  assert.ok(!/onNavigate\('screen-36'\)/.test(page), 'New Migration no longer sends everyone to the one-page checklist');
  const menu = fs.readFileSync(path.join(here, '../src/components/layout/Sidebar.jsx'), 'utf8');
  assert.ok(/flowStepNumber\(item\.id\)/.test(menu), 'the menu shows the step numbers');
});
