// A route the server sends whole ('/api/migrations/...') and a short one ('/migrations/...') reach the same address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiUrl } from '../src/apiUrl.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('a route is never sent as /api/api/...', () => {
  assert.equal(apiUrl('/migrations/7/voucher-settings'), '/api/migrations/7/voucher-settings');
  assert.equal(apiUrl('/api/migrations/7/voucher-settings'), '/api/migrations/7/voucher-settings');
  assert.equal(apiUrl('/auth/me'), '/api/auth/me');
  assert.equal(apiUrl('/apiary'), '/api/apiary', 'only a whole /api/ prefix is removed');
});

test('Fix contacts does not read its list before it has loaded', () => {
  const page = fs.readFileSync(path.join(here, '../src/screens/app/NamesAndContacts.jsx'), 'utf8');
  assert.ok(!/new Set\(view\.rows\.filter/.test(page), 'the list is read only once it is there');
});
