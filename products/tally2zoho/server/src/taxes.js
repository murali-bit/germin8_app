// Tax mapping: Tally tax ledger -> the name of a tax in the user's Zoho Books.
//
// The user can save the list of tax names that exist in their Zoho Books (pasted text, one name per line).
// When a list exists, a mapping must be one of the listed names. When no list exists, free text is allowed and the
// mapping is marked "not checked against your Zoho tax list".
// The platform does not know Zoho's taxes and never invents a rule about rates or names: it only compares with
// the list the user saved, and reports which tax ledgers appear together on the same voucher.

import Decimal from 'decimal.js';
import { voucherLines, partyDocParty, taxLedgerInfo, STANDARD_GST_RATES } from './vouchers.js';
import { NameSet, voucherStatus, matchKey } from './tally.js';
import { builtinAccount } from './zohocodes.js';
import { defaultZohoTaxName, ZOHO_DEFAULT_TAXES, TDS_CHOICES } from './defaults.js';
import { mostSimilar } from './similar.js';

const MAX_NAME_LENGTH = 100; // longest Zoho tax name accepted from the user
const MAX_LIST = 1000;
const norm = v => String(v ?? '').trim().toLowerCase();
const quote = list => list.map(n => `"${n}"`).join(', ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FILES = ['invoices', 'bills']; // the files that carry a tax name

export function setupTaxes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zoho_tax_list (job_id TEXT NOT NULL, pos INTEGER NOT NULL, name TEXT NOT NULL, saved_by TEXT, at TEXT, PRIMARY KEY (job_id, pos));
    CREATE TABLE IF NOT EXISTS tax_usage (job_id TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT);
  `);
}

// Pasted text (or a list of names) -> names: trimmed, blanks dropped, duplicates dropped ignoring capital letters (the first spelling is kept).
export function parseTaxList(input) {
  const raw = Array.isArray(input) ? input.map(x => String(x ?? '')) : String(input ?? '').split(/\r\n|\r|\n/);
  const seen = new Set(), names = [];
  let duplicates = 0;
  for (const line of raw) {
    const name = line.trim();
    if (!name) continue;
    if (seen.has(norm(name))) { duplicates++; continue; }
    seen.add(norm(name));
    names.push(name);
  }
  return { names, duplicates };
}

export const zohoTaxList = (db, jobId) => db.prepare('SELECT name, saved_by, at FROM zoho_tax_list WHERE job_id = ? ORDER BY pos').all(jobId);
const mappings = (db, jobId) => db.prepare('SELECT ledger, zoho_tax FROM tax_mappings WHERE job_id = ? ORDER BY ledger').all(jobId);
const taxLedgerNames = (db, jobId) => db.prepare("SELECT name FROM source_records WHERE job_id = ? AND slot = 'taxes' ORDER BY id").all(jobId).map(r => r.name);

// Counts, voucher by voucher, on how many vouchers each tax ledger is used, and which other tax ledgers are on the
// same voucher. Sales and purchase vouchers are counted in `vouchers`; JOURNAL vouchers in `journals` (a company
// that enters its purchases as journals has every tax line of its bills there). Journals are counted whatever their
// routing, so the counts do not change when a routing decision changes. add(slot, voucher) for each voucher Tally
// posts, then result():
//   { ledger: { vouchers, journals, asTax, partySide, with: { otherLedger: vouchers } } }
// A ledger is counted under its name as the masters write it, also when the voucher writes the name without a hidden
// character the master's name has (a line break at its end).
// parties: { customers, vendors } (NameSets of the masters), optional. With them, each use is also counted by the SIDE
// of the ledger on a voucher that is an invoice or a bill (a sales or purchase voucher, or a journal with exactly one
// vendor credited or one customer debited): asTax counts the vouchers where the ledger is on the other side from the
// party (a tax on the document, which needs a Zoho tax name), partySide the vouchers where it is on the party's side
// (tax deducted at source, the liability side of tax under reverse charge: no Zoho tax name is asked for those).
// infoOf(ledger) (optional): taxLedgerInfo of a tax ledger. With it, the GST RATE each GST ledger is used at is counted
// too, per voucher where it is a tax on the document: rates { '18': vouchers } is the TOTAL GST rate of the line (CGST
// 9% -> 18, IGST 18% -> 18), the rate Zoho's own tax names carry (GST18, IGST18); rateUnknown counts the vouchers where
// no rate can be told. The rate comes from Tally's rate on the lines (ratedetails), else the ledger's own rate, else,
// for a document with one taxable line, from the amounts when exactly one standard GST rate fits within a rupee.
const GST_HEADS = ['CGST', 'SGST', 'IGST'];
export const USAGE_VERSION = 3; // 3: partySideInvoices
export function taxUsageCollector(taxLedgers, parties = null, infoOf = null) {
  const set = taxLedgers instanceof NameSet ? taxLedgers : new NameSet([...taxLedgers]);
  const use = {};
  const partyOf = (voucher, kind, names) => { const p = partyDocParty(voucher, kind, names); return p.party && names.has(p.party.ledger) ? p.party : null; };
  const totalOf = (head, r) => (head === 'IGST' ? r : r.times(2));
  const ratesOn = (a, mine, lines, party, sameSide) => {
    const info = infoOf?.(a);
    if (!info || !GST_HEADS.includes(info.head)) return null;
    const taxable = lines.filter(l => l !== party && !set.has(l.ledger) && l.amount && !l.amount.isZero() && !sameSide(l));
    const onLines = [...new Set(taxable.map(l => l.rates?.[info.head]).filter(Boolean).map(r => totalOf(info.head, r).toString()))];
    if (onLines.length) return onLines;
    if (info.rate) return [totalOf(info.head, info.rate).toString()];
    if (taxable.length !== 1) return [];
    const base = taxable[0].amount.abs(), amount = mine.reduce((t, l) => t.plus(l.amount.abs()), new Decimal(0));
    const fits = STANDARD_GST_RATES.filter(s => base.times(info.head === 'IGST' ? s : s.div(2)).div(100).minus(amount).abs().lessThanOrEqualTo(1));
    return fits.length === 1 ? [fits[0].toString()] : [];
  };
  return {
    add(slot, voucher) {
      if (slot !== 'sales' && slot !== 'purchase' && slot !== 'journal') return;
      const lines = voucherLines(voucher);
      const onLines = lines.filter(l => set.has(l.ledger));
      if (!onLines.length) return;
      const on = [...new Set(onLines.map(l => set.canonical(l.ledger)))];
      const asBill = !parties || slot === 'sales' ? null : partyOf(voucher, 'Bill', parties.vendors);
      const party = !parties ? null : slot === 'sales' ? partyOf(voucher, 'Invoice', parties.customers) : slot === 'purchase' ? asBill
        : asBill || partyOf(voucher, 'Invoice', parties.customers);
      const onInvoice = !!party && !(slot === 'purchase' || (slot === 'journal' && asBill));
      const sameSide = l => !!l.amount && !l.amount.isZero() && l.amount.isNegative() === party.amount.isNegative();
      for (const a of on) {
        const e = (use[a] ||= { vouchers: 0, journals: 0, asTax: 0, partySide: 0, with: {} });
        if (slot === 'journal') e.journals++; else e.vouchers++;
        if (party) {
          const mine = onLines.filter(l => set.canonical(l.ledger) === a);
          const asTax = mine.filter(l => !sameSide(l));
          if (asTax.length) {
            e.asTax++;
            const rates = infoOf ? ratesOn(a, asTax, lines, party, sameSide) : null;
            if (rates) {
              e.rates ||= {};
              if (!rates.length) e.rateUnknown = (e.rateUnknown || 0) + 1;
              for (const r of rates) e.rates[r] = (e.rates[r] || 0) + 1;
            }
          }
          // partySideInvoices: of those, the vouchers that are an invoice (TDS deducted by the customer)
          if (mine.some(sameSide)) { e.partySide++; if (onInvoice) e.partySideInvoices = (e.partySideInvoices || 0) + 1; }
        }
        for (const b of on) if (b !== a) e.with[b] = (e.with[b] || 0) + 1;
      }
    },
    result: () => (infoOf ? { ...use, __version: USAGE_VERSION } : use),
  };
}
export const saveTaxUsage = (db, jobId, usage, at) => db.prepare('INSERT OR REPLACE INTO tax_usage (job_id, data, at) VALUES (?,?,?)').run(jobId, JSON.stringify(usage), at);
// Worked out at the end of processing. For data processed before this existed it is worked out once, on first use.
// v2: worked out again once when the stored counts are older than USAGE_VERSION (they then lack the GST rates, and the
// ledgers named like Zoho's TDS Receivable that hold TDS deducted by customers).
export function taxUsage(db, jobId) {
  const row = db.prepare('SELECT data FROM tax_usage WHERE job_id = ?').get(jobId);
  if (row) { const u = JSON.parse(row.data); if (u.__version === USAGE_VERSION) return u; }
  const names = slot => new NameSet(db.prepare('SELECT name FROM source_records WHERE job_id = ? AND slot = ?').all(jobId, slot).map(r => r.name));
  const infos = new Map(db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'taxes'").all(jobId).map(r => [matchKey(r.name), taxLedgerInfo(JSON.parse(r.data))]));
  const receivable = db.prepare("SELECT name FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND slot = 'accounts'").all(jobId).map(r => r.name)
    .filter(n => builtinAccount(n) === 'TDS Receivable' && !infos.has(matchKey(n)));
  const c = taxUsageCollector([...taxLedgerNames(db, jobId), ...receivable], { customers: names('customers'), vendors: names('vendors') }, n => infos.get(matchKey(n)) || null);
  for (const r of db.prepare("SELECT slot, data FROM source_records WHERE job_id = ? AND slot IN ('sales','purchase','journal') ORDER BY id").iterate(jobId)) {
    const data = JSON.parse(r.data);
    if (!voucherStatus(data)) c.add(r.slot, data); // cancelled, optional and deleted vouchers are not counted
  }
  saveTaxUsage(db, jobId, c.result(), new Date().toISOString());
  return c.result();
}

// The tax mapping of every tax ledger, with how it stands against the user's Zoho tax list.
export function taxMappingList(db, jobId) {
  const list = zohoTaxList(db, jobId);
  const listed = new Set(list.map(l => norm(l.name)));
  const map = Object.fromEntries(mappings(db, jobId).map(m => [m.ledger, m.zoho_tax]));
  const usage = taxUsage(db, jobId);
  // Tally's type of duty/tax for each ledger: one that is neither GST nor TDS (for example "Others") is never a GST
  // tax on a line (vouchers.js writes it as a line of its own), so no Zoho tax name is asked for it.
  const infoByName = new Map(db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'taxes'").all(jobId).map(r => { try { return [r.name, taxLedgerInfo(JSON.parse(r.data))]; } catch { return [r.name, null]; } }));
  const other = new Set([...infoByName].filter(([, i]) => i?.other).map(([n]) => n));
  return taxLedgerNames(db, jobId).map(ledger => {
    const zohoTax = map[ledger] || '';
    const inList = !zohoTax || !list.length ? null : listed.has(norm(zohoTax));
    const listStatus = !zohoTax ? 'unmapped' : !list.length ? 'not_checked' : inList ? 'in_list' : 'not_in_list';
    // v2: the Zoho tax each GST ledger is written with automatically (vouchers.js default 13): Zoho's own tax of the
    // rate of each line (CGST and SGST -> GST<rate>, IGST -> IGST<rate>). A person is needed only when a rate cannot be
    // told from Tally, or Zoho has no tax of its own for it (another rate, a cess). An explicit mapping always wins.
    const info = infoByName.get(ledger);
    // a ledger named like Zoho's TDS Receivable (not GST in Tally) holds TDS deducted by customers: TDS mapping
    const receivable = !info?.tds && builtinAccount(ledger) === 'TDS Receivable' && String(info?.type || '').toUpperCase() !== 'GST';
    const kind = info?.tds || receivable ? 'tds' : info?.other ? 'other' : 'gst';
    const u = usage[ledger];
    const head = info?.head || null;
    const pair = head === 'IGST' ? ['IGST'] : ['CGST', 'SGST'];
    const rates = Object.entries(u?.rates || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([rate, vouchers]) => ({ rate, vouchers, auto: GST_HEADS.includes(head) ? defaultZohoTaxName(pair, rate, list.map(x => x.name)) : null }));
    const autoNames = [...new Set(rates.map(r => r.auto).filter(Boolean))];
    // the saved Zoho tax list (when there is one) must have Zoho's own names, as in vouchers.js
    const autoUsable = autoNames.filter(n => !list.length || listed.has(norm(n)));
    const usedAsTax = (u ? u.asTax ?? u.vouchers : 0) > 0;
    const unknown = u?.rateUnknown || 0;
    const why = kind !== 'gst' || zohoTax || !usedAsTax ? null
      : !GST_HEADS.includes(head) ? (head ? `${head} has no Zoho tax of its own` : 'Tally gives no GST duty head')
        : rates.some(r => !r.auto) ? `Zoho has no tax of its own at ${rates.filter(r => !r.auto).map(r => `${r.rate}%`).join(', ')}`
          : unknown ? `No rate in Tally on ${unknown} voucher${unknown === 1 ? '' : 's'}`
            : autoNames.length && autoUsable.length < autoNames.length ? `${autoNames.filter(n => !autoUsable.includes(n)).join(', ')} not in your Zoho tax list`
              : !autoNames.length ? 'No rate in Tally' : null;
    const source = zohoTax ? 'explicit' : autoUsable.length ? 'auto' : 'none';
    return {
      ledger, zohoTax, mapped: !!zohoTax, notGst: other.has(ledger),
      kind, head, rates, rateUnknownVouchers: unknown, autoNames: autoUsable, source,
      written: zohoTax || autoUsable.join(', '), needsPerson: !!why, needsPersonWhy: why,
      checkedAgainstList: !!zohoTax && list.length > 0, // false when no Zoho tax list was saved: the name is free text
      inList,                                           // true / false when checked; null when unmapped or no list exists
      listStatus,
      note: other.has(ledger) && !zohoTax ? 'Tally gives this ledger a type of duty/tax that is neither GST nor TDS, so it is not a GST tax on a line: it is written as a line of its own, and no Zoho tax is needed.'
        : listStatus === 'not_checked' ?'Not checked against your Zoho tax list, because no list was saved.'
        : listStatus === 'not_in_list' ? `"${zohoTax}" is not in your Zoho tax list. The mapping was kept. Choose a name from the list, or add this name to the list.` : null,
      // vouchers that use this ledger: sales and purchase vouchers, and journal vouchers (whatever their routing)
      vouchers: (usage[ledger]?.vouchers || 0) + (usage[ledger]?.journals || 0),
      salesPurchaseVouchers: usage[ledger]?.vouchers || 0, journalVouchers: usage[ledger]?.journals || 0,
      // On vouchers that are an invoice or a bill (or journals with that pattern): taxRowVouchers where the ledger is a tax
      // on the document and needs a Zoho tax name; partySideVouchers where it is on the party's side (for example tax
      // deducted at source) and needs none. null for data processed before this was counted.
      taxRowVouchers: usage[ledger] ? usage[ledger].asTax ?? null : 0, partySideVouchers: usage[ledger] ? usage[ledger].partySide ?? null : 0,
      appearsWith: Object.entries(usage[ledger]?.with || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([other, vouchers]) => ({ ledger: other, vouchers, zohoTax: map[other] || '', mapped: !!map[other] })),
    };
  });
}

// The tax ledgers that still need the accountant (one rule for the test report and the Prepare migration checklist):
// unmapped: not mapped, and a tax on an invoice or bill somewhere (a ledger only ever on the party's side, such as tax
// deducted at source, needs no Zoho tax name); notInList: mapped to a name that is not in the saved Zoho tax list.
// list: the result of taxMappingList.
// v2: a GST ledger written automatically with Zoho's own tax names (source 'auto') needs nobody; TDS ledgers are
// decided in TDS mapping and other duties post as accounts, so neither is asked for here.
export const taxLedgersToDecide = list => ({
  // one count with the Tax mapping screen: a ledger that needs a person (needsPerson) is open, even when some of its
  // rates are written with Zoho's own tax automatically (source 'auto' for those rates)
  unmapped: list.filter(t => !t.mapped && !t.notGst && (t.kind ?? 'gst') === 'gst' && (t.needsPerson ?? t.source !== 'auto') && (t.taxRowVouchers ?? t.vouchers) > 0),
  notInList: list.filter(t => t.listStatus === 'not_in_list'),
});

// Flagged items raised when the files are created. built: the result of buildVoucherOutput (vouchers.js), so the
// check looks at the tax ledgers of the invoices and bills really written (built.taxOnVouchers): sales and purchase
// vouchers AND journals routed to Invoice or Bill. Vouchers left out of the files, and tax ledgers on the party's side
// (which carry no tax name), are not part of it. Returns [{ kind, name, uses, message }].
//  - tax_pair_incomplete: ONE item per unmapped tax ledger that is on the same voucher as a mapped tax ledger.
//  - tax_not_in_list: a mapping whose Zoho tax name is not in the user's Zoho tax list.
// Nothing is assumed about rates or names.
export function taxGenerateChecks(db, jobId, built, taxLedgers, taxMap) {
  const out = [];
  const pairs = new Map(); // unmapped ledger -> { vouchers, with: Map(mapped ledger -> vouchers) }
  const byVoucher = new Map(); // file|record id -> Map(tax ledger -> Zoho tax name written, '' when not mapped)
  const mappedName = {};
  // the GST tax ledgers of each invoice and bill written (on the other side from the party), with the Zoho tax mapped
  for (const { file, rec, taxes } of built.taxOnVouchers || []) {
    const key = `${file}|${rec.id}`;
    if (!byVoucher.has(key)) byVoucher.set(key, new Map());
    for (const t of taxes) {
      byVoucher.get(key).set(t.ledger, t.zohoTax || '');
      if (t.zohoTax) mappedName[t.ledger] = t.zohoTax;
    }
  }
  for (const on of byVoucher.values()) {
    if (on.size < 2) continue;
    const mapped = [...on.keys()].filter(n => on.get(n)), unmapped = [...on.keys()].filter(n => !on.get(n));
    if (!mapped.length) continue;
    for (const u of unmapped) {
      let p = pairs.get(u);
      if (!p) pairs.set(u, p = { vouchers: 0, with: new Map() });
      p.vouchers++;
      for (const m of mapped) p.with.set(m, (p.with.get(m) || 0) + 1);
    }
  }
  for (const [ledger, p] of pairs) {
    const partners = [...p.with.entries()].map(([m, n]) => `"${m}" (mapped to "${mappedName[m]}", ${plural(n, 'voucher')})`).join(' and ');
    out.push({ kind: 'tax_pair_incomplete', name: ledger, uses: p.vouchers,
      message: `Tax ledger "${ledger}" is not mapped to a Zoho tax, but on ${plural(p.vouchers, 'voucher')} it appears together with ${partners}. `
        + `Map "${ledger}" as well in Mapping Studio, otherwise the tax on ${p.vouchers === 1 ? 'that voucher' : 'those vouchers'} is only partly named in the Zoho file. Nothing was assumed about rates or names.` });
  }
  const list = zohoTaxList(db, jobId);
  if (list.length) {
    const listed = new Set(list.map(l => norm(l.name)));
    for (const ledger of taxLedgers) {
      if (taxMap[ledger] && !listed.has(norm(taxMap[ledger]))) {
        out.push({ kind: 'tax_not_in_list', name: ledger, uses: null,
          message: `Tax ledger "${ledger}" is mapped to Zoho tax "${taxMap[ledger]}", which is not in your Zoho tax list. The name was written in the file as mapped. Choose a name from the list in Mapping Studio, or add this name to the list.` });
      }
    }
  }
  return out;
}

// Why mapping a tax ledger (a row of taxMappingList) to Zoho tax zohoTax contradicts Tally, or null. Only Zoho's own
// GST taxes have a known rate and kind (GSTnn: a group of CGST and SGST within the state; IGSTnn: IGST between states).
export function mappingConflict(t, zohoTax) {
  if (!t || !zohoTax) return null;
  const n = norm(zohoTax);
  const group = ZOHO_DEFAULT_TAXES.gst.find(x => norm(x.name) === n), igst = ZOHO_DEFAULT_TAXES.igst.find(x => norm(x.name) === n);
  const own = group || igst;
  if (!own || (t.kind ?? 'gst') !== 'gst') return null;
  if (igst && (t.head === 'CGST' || t.head === 'SGST')) return `"${zohoTax}" is Zoho's IGST tax (between states), but Tally says "${t.ledger}" is ${t.head}. A ${t.head} ledger is part of a GST group within the state (GST${own.rate}). Nothing was changed.`;
  if (group && t.head === 'IGST') return `"${zohoTax}" is Zoho's GST group of CGST and SGST (within the state), but Tally says "${t.ledger}" is IGST. Use the IGST tax (IGST${own.rate}). Nothing was changed.`;
  const seen = (t.rates || []).map(r => String(r.rate));
  // GST-001: a Zoho tax has one rate; a ledger Tally uses at several rates cannot be one of Zoho's taxes named for a rate
  if (new Set(seen).size > 1) return `"${zohoTax}" is ${own.rate}%, but Tally uses "${t.ledger}" at several rates (${seen.map(r => `${r}%`).join(', ')}). A Zoho tax has one rate, so the lines of the other rates would carry the wrong tax. Leave the ledger unmapped: each line is then written with Zoho's tax of its own rate. Nothing was changed.`;
  if (seen.length &&!seen.includes(String(own.rate))) return `"${zohoTax}" is ${own.rate}%, but Tally uses "${t.ledger}" at ${seen.map(r => `${r}%`).join(', ')}. A Zoho tax has one rate, so every line would carry the wrong tax. Choose the Zoho tax of that rate. Nothing was changed.`;
  return null;
}

export function registerTaxes(app, { db, need, audit, now, tx, markStale = () => {} }) {
  const actor = req => req.user?.email || 'system';
  const notInList = (jobId, list) => {
    if (!list.length) return [];
    const listed = new Set(list.map(l => norm(l.name)));
    return mappings(db, jobId).filter(m => !listed.has(norm(m.zoho_tax))).map(m => ({ ledger: m.ledger, zohoTax: m.zoho_tax }));
  };
  const listView = jobId => {
    const list = zohoTaxList(db, jobId);
    return { exists: list.length > 0, count: list.length, names: list.map(l => l.name), savedBy: list[0]?.saved_by ?? null, savedAt: list[0]?.at ?? null,
      // mappings that use a name which is not in the list: they are kept and flagged, never removed
      mappingsNotInList: notInList(jobId, list) };
  };

  // ----- the user's Zoho tax list -----
  app.get('/api/migrations/:id/zoho-taxes', (req, reply) => { const job = need(req, reply); if (!job) return; return listView(job.id); });

  // Replaces the list. Body: { text: "one name per line" } or { names: [...] }.
  app.put('/api/migrations/:id/zoho-taxes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const body = req.body || {};
    if (body.names !== undefined && !Array.isArray(body.names)) return reply.code(400).send({ error: 'Send the tax names as a list, or as text with one name per line.' });
    const { names, duplicates } = parseTaxList(body.names !== undefined ? body.names : body.text);
    if (!names.length) return reply.code(400).send({ error: 'The list has no tax names. Paste the tax names from Zoho Books, one per line. To remove the list, use Clear list.' });
    const long = names.find(n => n.length > MAX_NAME_LENGTH);
    if (long) return reply.code(400).send({ error: `The tax name "${long.slice(0, 40)}..." is too long. Use ${MAX_NAME_LENGTH} characters or fewer per name.` });
    if (names.length > MAX_LIST) return reply.code(400).send({ error: `The list has ${names.length} names. The most that can be saved is ${MAX_LIST}.` });

    const before = zohoTaxList(db, job.id).map(l => l.name);
    const oldBy = new Map(before.map(n => [norm(n), n])), newBy = new Map(names.map(n => [norm(n), n]));
    const added = names.filter(n => !oldBy.has(norm(n)));
    const removed = before.filter(n => !newBy.has(norm(n)));
    const respelled = names.filter(n => oldBy.has(norm(n)) && oldBy.get(norm(n)) !== n).map(n => ({ from: oldBy.get(norm(n)), to: n }));
    const sameOrder = before.length === names.length && before.every((n, i) => n === names[i]);
    if (sameOrder) return { ...listView(job.id), changed: false, added: [], removed: [], respelled: [], duplicatesDropped: duplicates, mappingsRespelled: [] };

    const mappingsRespelled = [];
    tx(() => {
      db.prepare('DELETE FROM zoho_tax_list WHERE job_id = ?').run(job.id);
      const ins = db.prepare('INSERT INTO zoho_tax_list (job_id, pos, name, saved_by, at) VALUES (?,?,?,?,?)');
      names.forEach((n, i) => ins.run(job.id, i, n, actor(req), now()));
      // A mapping that matches a listed name apart from capital letters is given the listed spelling. This is recorded.
      for (const m of mappings(db, job.id)) {
        const listedName = newBy.get(norm(m.zoho_tax));
        if (listedName && listedName !== m.zoho_tax) {
          db.prepare('UPDATE tax_mappings SET zoho_tax = ? WHERE job_id = ? AND ledger = ?').run(listedName, job.id, m.ledger);
          mappingsRespelled.push({ ledger: m.ledger, from: m.zoho_tax, to: listedName });
        }
      }
      const flagged = notInList(job.id, zohoTaxList(db, job.id));
      const contentChanged = added.length || removed.length || respelled.length;
      audit(job.id, 'zoho_tax_list_saved', `${plural(names.length, 'name')} in the list${before.length ? ` (was ${before.length})` : ' (no list before)'}.`
        + (added.length ? ` Added (${added.length}): ${quote(added)}.` : '')
        + (removed.length ? ` Removed (${removed.length}): ${quote(removed)}.` : '')
        + (respelled.length ? ` Spelling changed (${respelled.length}): ${respelled.map(r => `"${r.from}" to "${r.to}"`).join(', ')}.` : '')
        + (!contentChanged ? ' Only the order changed.' : '')
        + (flagged.length ? ` ${plural(flagged.length, 'tax mapping')} use a name that is not in the list (${flagged.map(f => `"${f.ledger}" -> "${f.zohoTax}"`).join(', ')}); they were kept and are flagged.` : ''));
      for (const m of mappingsRespelled) audit(job.id, 'tax_mapping_respelled', `Tally ledger "${m.ledger}": Zoho tax "${m.from}" is now written as in the Zoho tax list, "${m.to}"`);
      if (contentChanged) {
        const parts = [added.length ? `${added.length} added` : '', removed.length ? `${removed.length} removed` : '', respelled.length ? `${respelled.length} spelled differently` : ''].filter(Boolean).join(', ');
        markStale(job.id, before.length ? `The Zoho tax list was changed (${parts}).` : `A Zoho tax list was saved (${plural(names.length, 'name')}). Tax mappings are now checked against it.`, FILES);
      }
    });
    return { ...listView(job.id), changed: true, added, removed, respelled, duplicatesDropped: duplicates, mappingsRespelled };
  });

  app.delete('/api/migrations/:id/zoho-taxes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const before = zohoTaxList(db, job.id).map(l => l.name);
    if (before.length) {
      db.prepare('DELETE FROM zoho_tax_list WHERE job_id = ?').run(job.id);
      audit(job.id, 'zoho_tax_list_cleared', `The list of ${plural(before.length, 'name')} was removed: ${quote(before)}. Tax mappings were kept and are no longer checked against a list.`);
      markStale(job.id, `The Zoho tax list was cleared (it had ${plural(before.length, 'name')}). Tax mappings are no longer checked against a list.`, FILES);
    }
    return { ...listView(job.id), changed: before.length > 0, removed: before };
  });

  // ----- tax mapping -----
  app.get('/api/migrations/:id/tax-mappings', (req, reply) => { const job = need(req, reply); if (!job) return; return taxMappingList(db, job.id); });
  // The names Tax mapping and TDS mapping offer (pick lists, never typed): Zoho's own GST taxes, the saved Zoho tax list
  // when there is one (then a mapping must be one of its names), and the TDS taxes known from Zoho's samples and docs.
  app.get('/api/migrations/:id/tax-choices', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return { gst: ZOHO_DEFAULT_TAXES.gst, igst: ZOHO_DEFAULT_TAXES.igst, savedList: zohoTaxList(db, job.id).map(l => l.name), tds: TDS_CHOICES };
  });

  app.put('/api/migrations/:id/tax-mappings', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ledger = String(req.body?.ledger || ''); let zohoTax = String(req.body?.zohoTax || '').trim();
    if (!db.prepare("SELECT 1 FROM source_records WHERE job_id = ? AND slot = 'taxes' AND name = ?").get(job.id, ledger)) return reply.code(404).send({ error: 'Tax ledger not found.' });
    if (zohoTax.length > MAX_NAME_LENGTH) return reply.code(400).send({ error: `The Zoho tax name is too long. Use ${MAX_NAME_LENGTH} characters or fewer.` });
    const hadTax = db.prepare('SELECT zoho_tax FROM tax_mappings WHERE job_id = ? AND ledger = ?').get(job.id, ledger)?.zoho_tax ?? null;
    if (!zohoTax) {
      db.prepare('DELETE FROM tax_mappings WHERE job_id = ? AND ledger = ?').run(job.id, ledger);
      if (hadTax !== null) {
        audit(job.id, 'tax_mapping_removed', `${ledger} (was "${hadTax}")`);
        markStale(job.id, `The tax mapping for Tally ledger "${ledger}" was removed (it was "${hadTax}").`, FILES);
      }
      return { ok: true, ledger, zohoTax: '', listStatus: 'unmapped' };
    }
    // With a Zoho tax list, the name must be one of the listed names. It is stored with the listed spelling.
    const list = zohoTaxList(db, job.id).map(l => l.name);
    if (list.length) {
      const listedName = list.find(n => norm(n) === norm(zohoTax));
      if (!listedName) {
        let suggestions = mostSimilar(zohoTax, list, { limit: 3, minScore: 0 });
        const close = suggestions.length > 0;
        if (!close) suggestions = list.slice(0, 3);
        return reply.code(400).send({
          error: `"${zohoTax}" is not in your Zoho tax list. ${close ? 'The closest names in the list are' : 'No name in the list is similar. The list starts with'}: ${quote(suggestions)}. Choose a name from the list, or add "${zohoTax}" to the list first.`,
          notInList: true, suggestions });
      }
      zohoTax = listedName;
    }
    // A mapping to one of Zoho's own GST taxes must fit what Tally says about the ledger: an IGST ledger is not a group
    // of CGST and SGST (and the reverse), and the tax's rate must be a rate the ledger is used at. Otherwise it is
    // refused: it would put the wrong tax on every line and move vouchers between files (audit item 13).
    const conflict = mappingConflict(taxMappingList(db, job.id).find(t => t.ledger === ledger), zohoTax);
    if (conflict) return reply.code(409).send({ error: conflict, conflict: true });
    db.prepare('INSERT OR REPLACE INTO tax_mappings VALUES (?,?,?,?,?)').run(job.id, ledger, zohoTax, actor(req), now());
    audit(job.id, 'tax_mapped', `Tally ledger "${ledger}" -> Zoho tax "${zohoTax}"${hadTax !== null && hadTax !== zohoTax ? ` (was "${hadTax}")` : ''}${list.length ? '' : ' (not checked against a Zoho tax list: none was saved)'}`);
    if (hadTax !== zohoTax) markStale(job.id, `Tally ledger "${ledger}" was mapped to Zoho tax "${zohoTax}"${hadTax !== null ? ` (it was "${hadTax}")` : ''}.`, FILES);
    return { ok: true, ledger, zohoTax, listStatus: list.length ? 'in_list' : 'not_checked' };
  });
}
