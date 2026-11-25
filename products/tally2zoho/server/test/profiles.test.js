// Stage C10: Mapping Profiles. The decisions of one migration are saved for the firm and applied to another, with a
// preview (apply / same / conflict / matches nothing), conflicts kept unless the user replaces them, every entry sent
// through the route a person would use, an audit entry for the whole, and files marked out of date.
// Uses the made-up three-file samples (15, 16, 17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-profiles-'));
const { buildApp } = await import('../src/index.js');
const { validateProfileData, nameMatcher, buildProfileData, planProfile, PROFILE_FORMAT } = await import('../src/profiles.js');

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
const upload = (id, slot, f) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
const company = () => {
  const doc = JSON.parse(fs.readFileSync(path.join(samples, '15_all_masters_for_transactions_utf16.json')).toString('utf16le').replace(/^﻿/, ''));
  return (doc.static_variables || []).find(v => v.name === 'svCurrentCompany')?.value || 'Made-up Company';
};
async function processed() {
  const r = await send('POST', '/api/migrations', { company: company(), financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  for (const [slot, f] of [['all_masters', '15_all_masters_for_transactions_utf16.json'], ['all_transactions', '16_all_transactions_utf16.json'], ['trial_balance', '17_trial_balance_report_utf16.json']]) {
    assert.equal((await upload(id, slot, f)).statusCode, 200);
  }
  for (const s of (await get(`/api/migrations/${id}/completeness`)).slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) {
    await ok('PUT', `/api/migrations/${id}/waivers/${s.key}`, { reason: 'Made-up company keeps no inventory' });
  }
  assert.equal((await send('POST', `/api/migrations/${id}/process?wait=1`)).statusCode, 200);
  return id;
}

test('C10 rules: a profile file is checked field by field; names match exactly, then ignoring hidden characters, then capitals', () => {
  assert.match(validateProfileData(null).error, /not a mapping profile/);
  assert.match(validateProfileData({ format: 'other' }).error, /not a mapping profile of this platform/);
  assert.match(validateProfileData({ format: PROFILE_FORMAT, version: 9 }).error, /version 9/);
  assert.match(validateProfileData({ format: PROFILE_FORMAT, version: 1, taxMappings: 'x' }).error, /must be a list/);
  assert.match(validateProfileData({ format: PROFILE_FORMAT, version: 1, taxMappings: [{ ledger: 'x'.repeat(400), zohoTax: 'y' }] }).error, /longer than/);
  const v = validateProfileData({ format: PROFILE_FORMAT, version: 1, name: 'P', taxMappings: [{ ledger: 'CGST', zohoTax: 'GST18', extra: 'dropped' }], clientSpecific: { names: [{ ledger: 'A' }] } });
  assert.deepEqual(v.data.taxMappings, [{ ledger: 'CGST', zohoTax: 'GST18' }], 'unknown fields are dropped');
  assert.deepEqual(v.data.clientSpecific.names, [{ ledger: 'A' }]);
  const m = nameMatcher(['Output CGST', 'Bank\r\n', 'Rent A', 'rent  a ']);
  assert.deepEqual(m('Output CGST'), { target: 'Output CGST', how: 'same name' });
  assert.equal(m('Bank').target, 'Bank\r\n');
  assert.equal(m('output cgst').how, 'same name once capital letters and spaces are ignored');
  assert.equal(m('RENT A'), null, 'two names fit once capitals and spaces are ignored: nothing is guessed');
  assert.equal(m('Nothing'), null);
});

test('C10 rules: a journal pattern is saved only when its journals all went the same way; the preview sorts entries', () => {
  const pat = (d, c) => ({ key: `D:${d}>C:${c}`, debit: [d], credit: [c] });
  const views = {
    accountTypes: () => ({ groups: [{ group: 'Indirect Expenses', decided: 'Expense', source: 'decided' }, { group: 'Loans', decided: null, source: 'standard', zohoType: 'Non Current Liability' }] }),
    taxes: () => [{ ledger: 'CGST', zohoTax: 'GST18', mapped: true }, { ledger: 'IGST', zohoTax: '', mapped: false }],
    tds: () => ({ ledgers: [] }), units: () => ({ units: [] }), items: () => ({ items: [], accounts: { sales: '', purchase: '' } }), clashes: () => ({ clashes: [] }),
    voucherSettings: () => ({ billNumber: 'voucher', documentStatus: 'final', decidedBy: null }),
    journals: () => [
      { id: 1, pattern: pat('Expenses', 'Creditors'), decision: 'Bill' }, { id: 2, pattern: pat('Expenses', 'Creditors'), decision: 'Bill' },
      { id: 3, pattern: pat('Bank', 'Debtors'), decision: 'Manual Journal' }, { id: 4, pattern: pat('Bank', 'Debtors'), decision: 'Invoice' },
      { id: 5, pattern: pat('Cash', 'Sales'), decision: null }, { id: 6, pattern: pat('Cash', 'Sales'), notPosted: 'cancelled', decision: 'Bill' },
    ],
    names: () => ({ names: [], duplicates: [] }), decisions: () => ({ contactFixes: {} }), contacts: () => [],
  };
  const firm = { gst: { codeSet: 'sample', unregisteredConsumerAs: '' }, layouts: [{ key: 'accounts', module: 'Chart of Accounts', hash: 'abc', isDefault: true }] };
  const { data, skipped } = buildProfileData(views, firm, { name: 'P' });
  assert.deepEqual(data.journalPatterns.map(p => [p.key, p.decision, p.journals]), [['D:Expenses>C:Creditors', 'Bill', 2]]);
  assert.equal(skipped.length, 1); assert.match(skipped[0], /routed differently/);
  assert.deepEqual(data.accountTypes, [{ group: 'Indirect Expenses', zohoType: 'Expense' }], 'only decided types; a standard type is not a decision');
  assert.equal(data.clientSpecific, null, 'client-specific corrections only when asked');
  assert.equal(data.voucherSettings, null, 'default settings are not a decision');

  // the same profile against a migration with another state
  const target = { ...views,
    accountTypes: () => ({ groups: [{ group: 'Indirect Expenses', decided: 'Other Expense', source: 'decided' }] }),
    taxes: () => [{ ledger: 'CGST', zohoTax: '', mapped: false }],
    journals: () => [{ id: 7, pattern: pat('Expenses', 'Creditors'), decision: null, refused: {} }, { id: 8, pattern: pat('Expenses', 'Creditors'), decision: 'Manual Journal', refused: {} }],
  };
  const plan = planProfile({ ...data, accountTypes: [...data.accountTypes, { group: 'Not here', zohoType: 'Expense' }] }, target, { ...firm, gst: { codeSet: 'help', unregisteredConsumerAs: '' } }, '/api/migrations/X');
  const st = id => plan.find(e => e.id === id)?.status;
  assert.equal(st('accountTypes:Indirect Expenses'), 'conflict');
  assert.equal(st('accountTypes:Not here'), 'no_match');
  assert.equal(st('taxMappings:CGST'), 'apply');
  assert.equal(st('journalPatterns:D:Expenses>C:Creditors'), 'apply', 'the undecided journal of the pattern');
  assert.equal(st('journalPatterns:D:Expenses>C:Creditors:decided'), 'conflict', 'the journal routed otherwise here');
  assert.equal(st('gstCodes'), 'info', 'a firm setting is never applied by a profile');
  assert.equal(st('columnLayouts:accounts'), 'same');
  assert.deepEqual(plan.find(e => e.id === 'taxMappings:CGST').request, { method: 'PUT', url: '/api/migrations/X/tax-mappings', payload: { ledger: 'CGST', zohoTax: 'GST18' } });
});

test('C10 end to end: save, preview, keep or replace conflicts, apply through the screens\' routes, export and import', async () => {
  await login('analyst');
  const a = await processed();
  const A = `/api/migrations/${a}`;
  // ----- decisions in migration A -----
  const taxes = await get(`${A}/tax-mappings`);
  assert.ok(taxes.length >= 1, 'the made-up masters have tax ledgers');
  for (const t of taxes) await ok('PUT', `${A}/tax-mappings`, { ledger: t.ledger, zohoTax: `Zoho ${t.ledger}` });
  const types = await get(`${A}/account-types`);
  const g = types.groups.find(x => x.ledgers > 0);
  await ok('PUT', `${A}/account-types`, { group: g.group, zohoType: 'Other Expense' });
  await ok('PUT', `${A}/voucher-settings`, { documentStatus: 'draft' });
  const journals = (await get(`${A}/journals`)).filter(j => !j.notPosted);
  assert.ok(journals.length > 0);
  await ok('POST', `${A}/journals/bulk`, { ids: journals.map(j => j.id), decision: 'Manual Journal', confirmCount: journals.length });
  const contacts = await get(`${A}/contact-fixes`);
  const fixable = contacts.rows.find(r => r.problems.includes('state_missing') || r.problems.includes('registered_without_gstin'));

  // ----- save: firm-level, without and with the client-specific corrections -----
  assert.equal((await send('POST', `${A}/profiles`, { name: '' })).statusCode, 409, 'a name is needed');
  const p1 = await ok('POST', `${A}/profiles`, { name: 'Trading firms', description: 'Made-up' });
  assert.equal(p1.counts.taxMappings, taxes.length);
  assert.equal(p1.counts.accountTypes, 1);
  assert.equal(p1.counts.voucherSettings, 1);
  assert.ok(p1.counts.journalPatterns >= 1);
  assert.equal(p1.includesClientSpecific, false);
  assert.equal(p1.counts.contactFixes, 0);
  assert.equal((await send('POST', `${A}/profiles`, { name: 'trading FIRMS' })).statusCode, 409, 'names are unique per firm');
  if (fixable) await ok('PUT', `${A}/contact-fixes`, { ledger: fixable.ledger, treatment: 'unregistered' });
  const p2 = await ok('POST', `${A}/profiles`, { name: 'With client corrections', includeClientSpecific: true });
  assert.equal(p2.includesClientSpecific, true);
  if (fixable) assert.equal(p2.counts.contactFixes, 1);
  const list = await get('/api/profiles');
  assert.deepEqual(list.profiles.map(p => p.name).sort(), ['Trading firms', 'With client corrections']);
  assert.ok((await get(`${A}/audit`)).some(x => x.action === 'profile_saved' && x.detail.includes('Trading firms')));

  // ----- migration B: one conflicting decision, files created before applying -----
  const b = await processed();
  const B = `/api/migrations/${b}`;
  await ok('PUT', `${B}/tax-mappings`, { ledger: taxes[0].ledger, zohoTax: 'Something else' });
  assert.equal((await send('POST', `${B}/generate`)).statusCode, 200);
  assert.equal((await get(B)).filesOutOfDate, false);

  let pv = await ok('POST', `${B}/profiles/${p1.id}/preview`, {});
  const st = id => pv.entries.find(e => e.id === id);
  assert.equal(st(`taxMappings:${taxes[0].ledger}`).status, 'conflict');
  assert.equal(st(`taxMappings:${taxes[0].ledger}`).current, 'Something else');
  if (taxes[1]) assert.equal(st(`taxMappings:${taxes[1].ledger}`).status, 'apply');
  assert.equal(st(`accountTypes:${g.group}`).status, 'apply');
  assert.equal(st('voucherSettings').status, 'apply');
  assert.ok(pv.entries.some(e => e.section === 'journalPatterns' && e.status === 'apply'));
  assert.ok(pv.entries.every(e => !('request' in e)), 'the internal requests are not sent to the screen');
  const toApply = pv.counts.apply;

  // a stale preview is refused
  let r = await send('POST', `${B}/profiles/${p1.id}/apply`, { replace: [], confirmCount: toApply + 1 });
  assert.equal(r.statusCode, 409); assert.match(r.json().error, /changed since the preview/);
  // keep the conflict
  let res = await ok('POST', `${B}/profiles/${p1.id}/apply`, { replace: [], confirmCount: toApply });
  assert.equal(res.refused, 0, JSON.stringify(res.results.filter(x => !x.ok)));
  assert.equal(res.applied, toApply);
  assert.equal(res.kept, 1);
  assert.equal((await get(`${B}/tax-mappings`)).find(t => t.ledger === taxes[0].ledger).zohoTax, 'Something else', 'a conflict is kept unless replaced');
  if (taxes[1]) assert.equal((await get(`${B}/tax-mappings`)).find(t => t.ledger === taxes[1].ledger).zohoTax, `Zoho ${taxes[1].ledger}`);
  assert.equal((await get(`${B}/account-types`)).groups.find(x => x.group === g.group).decided, 'Other Expense');
  assert.equal((await get(`${B}/voucher-settings`)).documentStatus, 'draft');
  assert.ok((await get(`${B}/journals`)).filter(j => !j.notPosted).every(j => j.decision === 'Manual Journal'), 'journals routed by pattern');
  const m = await get(B);
  assert.equal(m.filesOutOfDate, true, 'applying marks the files out of date');
  const auditB = await get(`${B}/audit`);
  assert.ok(auditB.some(x => x.action === 'profile_applied' && /Trading firms/.test(x.detail)));
  assert.ok(auditB.some(x => x.action === 'tax_mapped'), 'each entry is audited by its own route');
  assert.ok(auditB.some(x => x.action === 'journals_bulk_routed'));

  // replace the conflict
  pv = await ok('POST', `${B}/profiles/${p1.id}/preview`, {});
  assert.equal(pv.counts.apply, 0); assert.equal(pv.counts.conflict, 1);
  res = await ok('POST', `${B}/profiles/${p1.id}/apply`, { replace: [`taxMappings:${taxes[0].ledger}`], confirmCount: 1 });
  assert.equal(res.applied, 1);
  assert.equal((await get(`${B}/tax-mappings`)).find(t => t.ledger === taxes[0].ledger).zohoTax, `Zoho ${taxes[0].ledger}`);
  pv = await ok('POST', `${B}/profiles/${p1.id}/preview`, {});
  assert.equal(pv.counts.apply + pv.counts.conflict, 0, 'everything is now the same');
  assert.equal((await get('/api/profiles')).profiles.find(p => p.id === p1.id).lastApplied.migration, b);

  // client-specific corrections are applied only from a profile that has them
  if (fixable) {
    pv = await ok('POST', `${B}/profiles/${p2.id}/preview`, {});
    assert.equal(pv.entries.find(e => e.id === `contactFixes:${fixable.ledger}`).status, 'apply');
    assert.ok(!(await ok('POST', `${B}/profiles/${p1.id}/preview`, {})).entries.some(e => e.section === 'contactFixes'));
    res = await ok('POST', `${B}/profiles/${p2.id}/apply`, { replace: [], confirmCount: pv.counts.apply });
    const fixed = (await get(`${B}/contact-fixes`)).rows.find(x => x.ledger === fixable.ledger);
    assert.equal(fixed.fix.treatment, 'unregistered');
    assert.match(fixed.fix.reason, /From mapping profile "With client corrections"/);
  }

  // ----- export and import -----
  const ex = await call({ url: `/api/profiles/${p1.id}/export` });
  assert.equal(ex.statusCode, 200);
  assert.match(ex.headers['content-disposition'], /mapping-profile-Trading-firms\.json/);
  const json = JSON.parse(ex.body);
  assert.equal(json.format, PROFILE_FORMAT);
  assert.equal((await send('POST', '/api/profiles/import', { profile: json })).statusCode, 409, 'the same name is refused');
  const imp = await ok('POST', '/api/profiles/import', { profile: JSON.stringify(json), name: 'Trading firms (copy)' });
  assert.deepEqual(imp.counts, p1.counts);
  assert.equal((await send('POST', '/api/profiles/import', { profile: { format: 'x' } })).statusCode, 400);
  // rename and delete
  assert.equal((await ok('PUT', `/api/profiles/${imp.id}`, { name: 'Copy' })).name, 'Copy');
  assert.equal((await send('DELETE', `/api/profiles/${imp.id}`)).statusCode, 200);
  assert.equal((await send('GET', `/api/profiles/${imp.id}`)).statusCode, 404);

  // ----- viewers read only -----
  await login('viewer');
  assert.equal((await send('POST', `${B}/profiles/${p1.id}/apply`, { replace: [], confirmCount: 0 })).statusCode, 403);
  assert.equal((await send('POST', '/api/profiles/import', { profile: json })).statusCode, 403);
  const vl = await call({ url: '/api/profiles' });
  assert.equal(vl.statusCode, 200); assert.equal(vl.json().canChange, false);
});
