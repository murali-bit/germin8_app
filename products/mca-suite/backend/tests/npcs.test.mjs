// node --test backend/tests/npcs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { search, suggest, suggestDetailed, suggestCategory, stem, queryWords, getCode, info } from '../npcs.js';

const codes = r => r.map(x => x.code);

test('data loads: categories and products', () => {
  const i = info();
  assert.ok(i.categories >= 30, `categories ${i.categories}`);
  assert.ok(i.products > 1500, `products ${i.products}`);
  assert.equal(getCode('9983').desc, 'Other professional, technical and business services');
  assert.equal(getCode('99831130').category, '9983');
  assert.equal(getCode('nope'), null);
});

test('stem joins simple word forms', () => {
  assert.equal(stem('services'), stem('service'));
  assert.equal(stem('trading'), stem('trade'));
  assert.equal(stem('leasing'), stem('lease'));
  assert.equal(stem('processes'), stem('process'));
  assert.equal(stem('consultants'), stem('consultant'));
  assert.equal(stem('9983'), '9983');
});

test('search by code: category first, then its products', () => {
  const r = search('9983', { limit: 10 });
  assert.equal(r[0].code, '9983');
  assert.equal(r[0].level, 'category');
  assert.ok(r.slice(1).every(x => x.code.startsWith('9983') && x.level === 'product'));
  assert.ok(search('998311', { limit: 50 }).every(x => x.code.startsWith('998311')));
  assert.equal(search('99831130')[0].code, '99831130');
  assert.deepEqual(search('12345678'), []);
});

test('search by words: all words must match; result shape', () => {
  const r = search('human resources consulting');
  assert.equal(r[0].code, '99831130');
  assert.deepEqual(Object.keys(r[0]).sort(), ['category', 'categoryDesc', 'code', 'desc', 'level']);
  for (const x of search('software', { limit: 30 })) assert.match(`${x.desc} ${x.categoryDesc}`, /software/i);
  assert.equal(search('', {}).length, 0);
  assert.ok(search('consult', { limit: 5 }).length === 5, 'limit respected');
});

test('search mixes a code prefix with words', () => {
  const r = search('9983 software');
  assert.ok(r.length > 0);
  assert.ok(r.every(x => x.code.startsWith('9983')));
});

test('suggest: human resources consulting → 99831130 in top 3', () => {
  const r = suggest('human resources consulting');
  assert.ok(codes(r).slice(0, 3).includes('99831130'), codes(r).join(','));
  assert.equal(r[0].score, 1);
  assert.ok(r[0].matched.includes('human'));
  assert.ok(r.every(x => x.code.length === 8), 'products only');
});

test('suggest: software development → a 998313x/998314x code near the top', () => {
  const r = suggest('software development', { limit: 5 });
  assert.ok(codes(r).some(c => /^99831[34]/.test(c)), codes(r).join(','));
  assert.match(r[0].code, /^99831[34]/);
});

test('suggest: synonyms and abbreviations', () => {
  assert.ok(codes(suggest('HR consultancy', { limit: 3 })).includes('99831130'));
  assert.ok(queryWords('IT services').some(w => w.stems.some(s => s.stem === stem('information'))));
  assert.ok(!queryWords('it is a company').length, 'lower-case "it" and stop words are dropped');
  assert.equal(suggest('Restaurant', { limit: 3 })[0].category, '9963');
  assert.equal(suggest('renting of commercial property', { limit: 3 })[0].category, '9972');
  assert.equal(suggest('Chartered accountants audit and tax advisory', { limit: 3 })[0].category, '9982');
});

test('suggest: a long business paragraph still finds the trade', () => {
  const text = 'The Company is a private limited company incorporated in India. It is engaged in the business of providing '
    + 'human resources consulting and recruitment services to corporate clients.';
  const d = suggestDetailed(text, { limit: 5 });
  assert.ok(codes(d.suggestions).slice(0, 3).includes('99831130'), codes(d.suggestions).join(','));
  assert.equal(d.categories[0].code, '9983');
  assert.deepEqual(suggestCategory(text), { code: '9983', desc: 'Other professional, technical and business services' });
});

test('suggest: nothing to go on → empty', () => {
  assert.deepEqual(suggest(''), []);
  assert.deepEqual(suggest('the private limited company and other services'), []);
  assert.equal(suggestCategory(''), null);
});
