// Comparing Zoho Books' Trial Balance with Tally's ledger-wise Trial Balance (Reconciliation), account by account.
//
// ASSUMED REPORT FORMAT. The layout of Zoho Books' Trial Balance export has not been seen yet. The reader is tolerant
// (CSV, XLSX or XLS, see sheet.js) and says what it used:
//  - the heading row is the first of the first 30 rows that holds an account-name heading and an amount heading;
//  - the account column is "Account Name", "Account", "Particulars", "Ledger"... (never a code, number, type or ID);
//  - the figures are a debit and a credit column (preferring "net" or "closing" ones), or one balance column whose
//    figures say Dr or Cr. A balance column without Dr / Cr needs the user to say which sign is a debit: it is never
//    guessed. When more than one column fits, or none, the user picks the columns;
//  - rows with no figure are headings, rows named "Total ..." are totals: both are left out and counted.
//
// The Tally side is the ledger lines of the Tally Trial Balance report (the opening or the closing column, as the user
// chooses), each written under the name the Zoho files give it: customers as one Accounts Receivable total, vendors as
// one Accounts Payable total, every other ledger through the one name resolver (renamed, cleaned, "treat as one", or
// Zoho's own account by the decision under Zoho's own accounts). Tally's sign is kept: a debit is negative.
import Decimal from 'decimal.js';
import { headingKey, readTable } from './sheet.js';
import { parseReportAmount, fileLayout } from './extras.js';
import { accountNameKey, builtinAccount, ZOHO_OPENING_BALANCE_ACCOUNT } from './zohocodes.js';
import { groupSection } from './zoho.js';
import { visibleName } from './namefix.js';
import { matchKey } from './tally.js';

// Checked against one real export (test 2, an XLSX): a title block (organisation, "Trial Balance", "Basis: Accrual", "From dd/mm/yyyy To dd/mm/yyyy"), then
// the columns Account, Net Debit and Net Credit, with the group names (Assets, Liabilities ...) as heading rows and indented accounts.
export const ZOHO_TB_NOTE = "The layout was checked against one real Zoho Books export (an XLSX with the columns Account, Net Debit and Net Credit, and the period \"From ... To ...\" in its title). The columns used are shown; if they are wrong, choose the right ones.";
// A date-range export shows only the activity INSIDE the range (observed in test 2): anything dated before its From date, such as the opening balance journal
// dated the day before the financial year, is left out. The on-screen "as of" view adds everything up to the date.
export const ZOHO_TB_RANGE_NOTE = 'A Zoho Trial Balance exported for a date range shows only what happened inside that range. Balances entered at the opening date (the opening balance journal and the contacts\' opening balances) are left out when the From date is later than that date. Export it again with a From date before the opening balance date (for example the first day of the previous financial year), or use the as-of view of Zoho Books.';
// "From 01/04/2025 To 31/03/2026" anywhere in the title block: { from, to } as yyyy-MM-dd, or null
export function readTbPeriod(rows) {
  const text = rows.slice(0, 12).map(r => r.map(c => String(c ?? '')).join(' ')).join(' ');
  const m = /from\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s+to\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i.exec(text);
  if (!m) return null;
  const p = n => String(n).padStart(2, '0');
  return { from: `${m[3]}-${p(m[2])}-${p(m[1])}`, to: `${m[6]}-${p(m[5])}-${p(m[4])}` };
}
// What the period means for the comparison. Two dates matter: the tool's Migration Date (the date written on the
// opening balance journal) and the Opening Balance Date Zoho Books shows (zohoDate: the date typed in the Import Wizard
// step "Save the Migration Date", '' when not given), which dates the balances of the Chart of Accounts, Customers and
// Vendors files. A warning when either date is outside the export's range: those balances are then not in the report.
export function periodWarning(period, openingDate, zohoDate = '') {
  if (!period) return { period: null, warning: null };
  const out = [];
  if (openingDate && period.from > openingDate) out.push(`This export starts on ${period.from}, after the opening balance date ${openingDate}, so it leaves out the opening balances.`);
  if (zohoDate && zohoDate !== openingDate) {
    if (period.from > zohoDate) out.push(`Zoho Books shows the Opening Balance Date ${zohoDate}, which is before the start of this export (${period.from}): the opening balances of the customers and vendors are left out.`);
    else if (period.to < zohoDate) out.push(`Zoho Books shows the Opening Balance Date ${zohoDate}, which is after the end of this export (${period.to}): the opening balances of the customers and vendors fall outside it, so Opening Balance Adjustments cannot be zero.`);
  }
  return { period, warning: out.length ? `${out.join(' ')} ${ZOHO_TB_RANGE_NOTE}` : null };
}

// Why Opening Balance Adjustments is not zero in Zoho's trial balance. Zoho puts the other side of every opening
// balance there, so when everything is in (and inside the report's dates) it nets to zero. What is left is explained
// from the tool's own files:
//  groups: [{ key, label, amount }]: what each source of opening balances puts on Opening Balance Adjustments (Decimal,
//    Tally's sign: a credit is positive): the Customers file, the Vendors file, the Chart of Accounts file, journal
//    OB-1 and journal OB-2;
//  singles: [{ key, label, name, amount }]: the same for one row of the Customers and Vendors files;
//  left: the balance of Opening Balance Adjustments in Zoho's report (Decimal, Tally's sign).
// Returns { expected, left, cause: 'none' | 'groups' | 'single' | 'unknown', missing: [label], words }.
export function explainAdjustment(left, groups, singles = []) {
  const expected = groups.reduce((t, g) => t.plus(g.amount), new Decimal(0));
  const gap = left.minus(expected); // what Zoho's figure has less (or more) than the files say
  const fig2 = d => `${d.abs().toFixed(2)} ${d.isZero() ? '' : d.isNegative() ? 'Dr' : 'Cr'}`.trim();
  if (gap.isZero()) {
    return { expected: expected.toFixed(2), left: left.toFixed(2), cause: 'none', missing: [],
      words: expected.isZero() ? 'Opening Balance Adjustments is zero, as it should be.' : `Opening Balance Adjustments shows ${fig2(left)}, which is what the files themselves leave there: Tally's own opening balances do not add up to zero.` };
  }
  // one source, or two together, missing from the report (not imported, or dated outside the report)
  const live = groups.filter(g => !g.amount.isZero());
  const sets = [...live.map(g => [g]), ...live.flatMap((a, i) => live.slice(i + 1).map(b => [a, b])), ...(live.length > 2 ? [live] : [])];
  const hit = sets.find(set => set.reduce((t, g) => t.plus(g.amount), new Decimal(0)).negated().equals(gap));
  if (hit) {
    const names = hit.map(g => g.label);
    return { expected: expected.toFixed(2), left: left.toFixed(2), cause: 'groups', missing: names,
      words: `Opening Balance Adjustments shows ${fig2(left)}. That is exactly what is left when ${names.join(' and ')} ${hit.length === 1 && !/s$/.test(names[0]) ? 'is' : 'are'} not in this report: not imported, or dated outside its From and To dates. `
        + (hit.some(g => ['customers', 'vendors', 'accounts'].includes(g.key)) ? 'Zoho Books dates the balances of the Chart of Accounts, Customers and Vendors files with its Opening Balance Date: check that date on Settings > Setup & Configurations > Opening Balances (Import Wizard, step "Save the Migration Date"), press Sync, and export the report again with a From date before it.' : 'Import the opening balance journal file, or export the report again with a From date before the Migration Date.') };
  }
  const one = singles.filter(x => !x.amount.isZero() && x.amount.negated().equals(gap));
  if (one.length) {
    return { expected: expected.toFixed(2), left: left.toFixed(2), cause: 'single', missing: one.map(x => x.name),
      words: `Opening Balance Adjustments shows ${fig2(left)}. That is exactly the opening balance of ${one.length === 1 ? `one row of the ${one[0].label} file: "${one[0].name}"` : `one of ${one.length} rows with this balance (${one.map(x => `"${x.name}"`).join(', ')})`}. That contact, or its opening balance, did not reach Zoho Books: look for it there, and import the row again if it is missing.` };
  }
  return { expected: expected.toFixed(2), left: left.toFixed(2), cause: 'unknown', missing: [],
    words: `Opening Balance Adjustments shows ${fig2(left)}${expected.isZero() ? '' : ` (the files themselves leave ${fig2(expected)} there)`}. The tool cannot tie this to one file. Check, in this order: the Opening Balance Date on Settings > Setup & Configurations > Opening Balances; that Sync was pressed; that the Customers, Vendors and opening balance journal files were imported in full; and the Accounts Receivable and Accounts Payable rows of the comparison below.` };
}
export const BASES = ['closing', 'opening'];
export const BALANCE_SIGNS = ['debit_positive', 'credit_positive'];
const HEADER_SCAN = 30;
const RECEIVABLE = 'Accounts Receivable', PAYABLE = 'Accounts Payable';

const lc = h => String(h ?? '').trim().toLowerCase();
const isNameHeading = h => /account|particular|ledger|name/.test(lc(h)) && !/code|number|\bno\b|#|\bid\b|type|group|currency/.test(lc(h));
const isDebit = h => /debit|\bdr\b/.test(lc(h));
const isCredit = h => /credit|\bcr\b/.test(lc(h));
const isBalance = h => /balance|net|amount|closing|total/.test(lc(h)) && !isDebit(h) && !isCredit(h);
const NAME_PREFERENCE = [/^account name$/, /^account$/, /^accounts$/, /^particulars$/, /^ledger( name)?$/, /account/, /particular|ledger/, /name/];
const prefer = (list, res) => { for (const re of res) { const hit = list.filter(h => re.test(lc(h))); if (hit.length) return hit; } return list; };

// rows: [[cell]]. picks: { accountColumn?, debitColumn?, creditColumn?, balanceColumn? } (headings chosen by the user).
// Returns { headerRow, headers, account, debit, credit, balance (headings or null), how } or { error, needsColumns, headers, detected }.
export function detectTbColumns(rows, picks = {}) {
  const hasPick = ['accountColumn', 'debitColumn', 'creditColumn', 'balanceColumn'].some(k => picks[k]);
  let headerRow = rows.slice(0, HEADER_SCAN).findIndex(r => {
    const hs = r.map(String);
    if (hasPick && picks.accountColumn) return hs.some(h => headingKey(h) === headingKey(picks.accountColumn));
    return hs.some(isNameHeading) && hs.some(h => isDebit(h) || isCredit(h) || isBalance(h));
  });
  if (headerRow < 0) headerRow = Math.max(0, rows.slice(0, HEADER_SCAN).findIndex(r => r.filter(c => String(c).trim()).length >= 2));
  const headers = (rows[headerRow] || []).map(h => String(h ?? '').trim());
  const named = headers.filter(Boolean);
  const pickOf = k => { const v = picks[k]; if (!v) return undefined; return headers.find(h => headingKey(h) === headingKey(v)) ?? null; };
  const fail = (error, detected = {}) => ({ error, needsColumns: true, headers: named, detected });
  for (const k of ['accountColumn', 'debitColumn', 'creditColumn', 'balanceColumn']) {
    if (pickOf(k) === null) return fail(`The column "${picks[k]}" is not in the file. Found: ${named.join(', ') || 'nothing'}.`);
  }
  // the account name
  let account = pickOf('accountColumn');
  if (!account) {
    const cands = prefer(named.filter(isNameHeading), NAME_PREFERENCE);
    if (cands.length !== 1) return fail(cands.length ? `More than one column could hold the account name (${cands.join(', ')}). Choose the one to use.` : `No column for the account name was found. Found: ${named.join(', ') || 'nothing'}. Choose the column that holds the account names.`);
    account = cands[0];
  }
  const rest = named.filter(h => h !== account);
  // the figures: picked, else a debit and a credit column, else one balance column
  let debit = pickOf('debitColumn') || null, credit = pickOf('creditColumn') || null, balance = pickOf('balanceColumn') || null;
  const how = { account: picks.accountColumn ? 'chosen by you' : 'found by its heading' };
  if (balance && (debit || credit)) return fail('Choose either a debit and a credit column, or one balance column, not both.');
  if ((debit && !credit) || (credit && !debit)) return fail('Choose both the debit column and the credit column.');
  if (debit || balance) { how.figures = 'chosen by you'; return { headerRow, headers, account, debit, credit, balance, how }; }
  const pickOne = (list, words) => { const p = prefer(list, [/net/, /closing/, /balance/]); return p.length === 1 ? p[0] : p.length ? { many: p, words } : null; };
  const d = pickOne(rest.filter(isDebit), 'debit'), c = pickOne(rest.filter(isCredit), 'credit');
  if (d && c) {
    if (d.many || c.many) return fail(`More than one ${d.many ? 'debit' : 'credit'} column was found (${(d.many || c.many).join(', ')}). Choose the debit and credit columns of the balance to compare.`, { account });
    return { headerRow, headers, account, debit: d, credit: c, balance: null, how: { ...how, figures: 'found by their headings' } };
  }
  const b = rest.filter(isBalance);
  const bp = prefer(b, [/net/, /closing/, /balance/]);
  if (bp.length === 1 && !d && !c) return { headerRow, headers, account, debit: null, credit: null, balance: bp[0], how: { ...how, figures: 'found by its heading' } };
  return fail(bp.length > 1 ? `More than one column could hold the balance (${bp.join(', ')}). Choose the columns to use.`
    : `No debit and credit columns, and no single balance column, were found. Found: ${named.join(', ') || 'nothing'}. Choose the columns that hold the figures.`, { account });
}

// A figure with an optional Dr / Cr marker ("1,234.00 Dr", "Cr 50", "100.00 (Cr)"). Returns { value: Decimal|null, side: 'dr'|'cr'|null, blank }.
export function parseDrCr(v) {
  let s = String(v ?? '').trim();
  if (!s) return { value: null, side: null, blank: true };
  let side = null;
  const m = s.match(/^(dr|cr)\.?\s+(.*)$/i) || s.match(/^(.*?)\s*\(?\b(dr|cr)\b\.?\)?$/i);
  if (m) {
    const [mark, rest] = /^(dr|cr)$/i.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    side = mark.toLowerCase(); s = rest.trim();
  }
  const value = parseReportAmount(s);
  return { value, side, blank: false };
}

const TOTAL_ROW = /^(grand\s+)?total\b|^net\s+total\b|^total\s+for\b/i;
// Reads the accounts of a Zoho Trial Balance. Returns { accounts: [{ name, amount: Decimal (Tally sign), rows }],
//   headings: [name] (rows with no figure), totals: [{ name, debit, credit, amount }], unreadable: [{ name, value }],
//   needsSign: [name] (a balance with no Dr/Cr and no sign chosen), repeated: [name] }.
export function readZohoTb(rows, cols, { balanceSign = null } = {}) {
  const idx = h => (h ? cols.headers.indexOf(h) : -1);
  const ai = idx(cols.account), di = idx(cols.debit), ci = idx(cols.credit), bi = idx(cols.balance);
  const accounts = new Map(), headings = [], totals = [], unreadable = [], needsSign = [], repeated = new Set();
  for (const r of rows.slice(cols.headerRow + 1)) {
    const name = String(r[ai] ?? '').trim();
    if (!name) continue;
    let amount = null;
    if (bi >= 0) {
      const p = parseDrCr(r[bi]);
      if (p.blank) { headings.push(name); continue; }
      if (!p.value) { unreadable.push({ name, value: String(r[bi]) }); continue; }
      if (p.side) amount = p.side === 'dr' ? p.value.abs().negated() : p.value.abs();
      else if (p.value.isZero()) amount = new Decimal(0);
      else if (balanceSign === 'debit_positive') amount = p.value.negated();
      else if (balanceSign === 'credit_positive') amount = p.value;
      else { if (!TOTAL_ROW.test(name)) needsSign.push(name); continue; }
    } else {
      const d = parseDrCr(r[di]), c = parseDrCr(r[ci]);
      if (d.blank && c.blank) { headings.push(name); continue; }
      if ((!d.blank && !d.value) || (!c.blank && !c.value)) { unreadable.push({ name, value: `${String(r[di] ?? '')} / ${String(r[ci] ?? '')}` }); continue; }
      amount = (c.value || new Decimal(0)).minus(d.value || new Decimal(0));
    }
    if (TOTAL_ROW.test(name)) { totals.push({ name, amount }); continue; }
    const k = accountNameKey(name);
    if (accounts.has(k)) { repeated.add(name); const a = accounts.get(k); a.amount = a.amount.plus(amount); a.rows++; } else accounts.set(k, { name, amount, rows: 1 });
  }
  return { accounts: [...accounts.values()], headings, totals, unreadable, needsSign, repeated: [...repeated] };
}

// The name a Tally ledger has in Zoho Books' Trial Balance. info: { parent (its Tally group), customer, vendor, tax }.
// ctx: makeContext (groupParents, groupReserved, clashDecisions, nameDecisions, outputName).
// Returns { zohoName, how } or { notCompared: reason }.
export function zohoAccountOf(ledger, info, ctx) {
  const section = info.customer ? 'customers' : info.vendor ? 'vendors' : groupSection(info.parent, ctx);
  if (section === 'customers') return { zohoName: RECEIVABLE, how: 'customer' };
  if (section === 'vendors') return { zohoName: PAYABLE, how: 'vendor' };
  if (!info.parent && /^profit\s*&\s*loss\s*a\/c$/i.test(String(ledger).trim())) {
    return { notCompared: "Tally's Profit & Loss A/c is not written to Zoho Books: Zoho keeps the accumulated profit in Retained Earnings and works out the current year's profit itself." };
  }
  const clash = ctx.clashDecisions?.[ledger];
  const name = ctx.outputName ? ctx.outputName(ledger) : ledger;
  const how = clash?.decision === 'zoho' && clash.taxLedger ? 'zoho_tax_account' : clash?.decision === 'zoho' ? 'zoho_account' : clash?.decision === 'rename' ? 'renamed'
    : ctx.nameDecisions?.[ledger]?.action === 'merge' ? 'merged' : ctx.nameDecisions?.[ledger]?.action ? 'cleaned_or_renamed' : 'ledger';
  return { zohoName: visibleName(name).trim() || name, how, tax: section === 'taxes' || !!info.tax };
}

const sideWords = d => (d.isZero() ? '' : d.isNegative() ? 'Debit' : 'Credit');
const fig = d => ({ amount: d.abs().toFixed(2), side: sideWords(d), signed: d.toFixed(2) });
const TAX_NOTE = "GST put on invoice and bill lines posts to Zoho's own tax accounts (for example Output CGST), not to this account, so part of a difference here may be on those accounts.";
const HOW_WORDS = { zoho_tax_account: "Tally GST ledger entered on Zoho's own tax account", customer: 'customers in total', vendor: 'vendors in total', zoho_account: "on Zoho's own account (decision under Zoho's own accounts)", renamed: 'renamed (decision under Zoho\'s own accounts)',
  merged: 'treated as one with another ledger (Names)', cleaned_or_renamed: 'name cleaned or renamed (Names)', ledger: 'same name' };

// tally: [{ ledger, amount: Decimal, zohoName, how, tax }], zoho: readZohoTb().accounts.
// Returns { matched, differing, onlyTally, onlyZoho, counts, totals }.
export function compareTb(tally, zoho) {
  const t = new Map();
  for (const e of tally) {
    const k = accountNameKey(e.zohoName);
    if (!t.has(k)) t.set(k, { name: e.zohoName, amount: new Decimal(0), ledgers: [], hows: new Set(), tax: false });
    const x = t.get(k); x.amount = x.amount.plus(e.amount); x.ledgers.push(visibleName(e.ledger)); x.hows.add(e.how); x.tax ||= !!e.tax;
  }
  const z = new Map(zoho.map(a => [accountNameKey(a.name), a]));
  const matched = [], differing = [], onlyTally = [], onlyZoho = [];
  const noteOf = x => [
    x.hows.has('customer') ? `${x.ledgers.length} customer ledger(s) of Tally compared as one total.` : '',
    x.hows.has('vendor') ? `${x.ledgers.length} vendor ledger(s) of Tally compared as one total.` : '',
    x.hows.has('zoho_tax_account') ? `${x.ledgers.length} Tally GST ledger(s) are entered on this one Zoho tax account (invoices, bills and journals all post here), so they are compared as one total.` : '',
    x.tax && !x.hows.has('zoho_tax_account') ? TAX_NOTE : '',
  ].filter(Boolean).join(' ') || null;
  for (const [k, x] of t) {
    const row = { account: x.name, tallyLedgers: x.ledgers.slice(0, 50), ledgerCount: x.ledgers.length, how: [...x.hows].map(h => HOW_WORDS[h] || h), tally: fig(x.amount), note: noteOf(x) };
    const zz = z.get(k);
    if (!zz) {
      if (x.amount.isZero()) matched.push({ ...row, zoho: null, note: [row.note, 'Zero in Tally and not listed in Zoho.'].filter(Boolean).join(' ') });
      else onlyTally.push(row);
      continue;
    }
    const zr = { ...row, zohoAccount: zz.name, zoho: fig(zz.amount), sameSpelling: zz.name === x.name };
    if (zz.amount.equals(x.amount)) matched.push(zr);
    else differing.push({ ...zr, difference: fig(zz.amount.minus(x.amount)) });
  }
  for (const [k, a] of z) {
    if (t.has(k)) continue;
    if (a.amount.isZero()) continue; // a Zoho account with nothing on it
    const own = builtinAccount(a.name);
    onlyZoho.push({ account: a.name, zoho: fig(a.amount),
      note: accountNameKey(a.name) === accountNameKey(ZOHO_OPENING_BALANCE_ACCOUNT) ? 'Zoho puts the other side of every opening balance here. After all opening balances are imported it should be zero; what is left is a difference between the opening balances in Zoho and in Tally.'
        : own ? "One of Zoho's own accounts (for example a tax account Zoho posts to itself). No Tally ledger is written to it." : null });
  }
  const sum = (list, pick) => list.reduce((s, r) => s.plus(pick(r) ? new Decimal(pick(r).signed) : 0), new Decimal(0));
  const all = [...matched, ...differing, ...onlyTally];
  const tallyTotal = sum(all, r => r.tally), zohoTotal = sum([...matched, ...differing, ...onlyZoho], r => r.zoho);
  const sides = list => list.reduce((s, r) => { if (!r) return s; const d = new Decimal(r.signed); return d.isNegative() ? { ...s, debit: s.debit.plus(d.abs()) } : { ...s, credit: s.credit.plus(d) }; }, { debit: new Decimal(0), credit: new Decimal(0) });
  const ts = sides(all.map(r => r.tally)), zs = sides([...matched, ...differing, ...onlyZoho].map(r => r.zoho));
  const byAmount = (a, b) => new Decimal(b.difference?.amount ?? b.tally?.amount ?? b.zoho?.amount ?? 0).comparedTo(a.difference?.amount ?? a.tally?.amount ?? a.zoho?.amount ?? 0) || a.account.localeCompare(b.account);
  return {
    matched: matched.sort((a, b) => a.account.localeCompare(b.account)), differing: differing.sort(byAmount), onlyTally: onlyTally.sort(byAmount), onlyZoho: onlyZoho.sort(byAmount),
    counts: { matched: matched.length, differing: differing.length, onlyTally: onlyTally.length, onlyZoho: onlyZoho.length },
    totals: {
      tally: { debit: ts.debit.toFixed(2), credit: ts.credit.toFixed(2), net: fig(tallyTotal) },
      zoho: { debit: zs.debit.toFixed(2), credit: zs.credit.toFixed(2), net: fig(zohoTotal) },
      agree: ts.debit.equals(zs.debit) && ts.credit.equals(zs.credit),
    },
  };
}

// What each file of the migration puts on Opening Balance Adjustments, read from the files as created (for
// explainAdjustment). Tally's sign: a credit is positive. available false: no file was created yet.
export function openingSources(db, jobId) {
  const groups = [], singles = [];
  let any = false;
  const rowsOf = key => { try { return db.prepare('SELECT row_no, source_record_id, source_id, row_data, ident FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(jobId, key); } catch { return []; } };
  const dec = v => { const s = String(v ?? '').replace(/,/g, '').trim(); try { return s ? new Decimal(s) : new Decimal(0); } catch { return new Decimal(0); } };
  const add = (key, label, rows, amount) => { groups.push({ key, label, rows, amount }); };
  try {
    // a customer owes money (a debit): Zoho credits Opening Balance Adjustments; a vendor is owed (a credit): Zoho debits it
    for (const [key, label, sign] of [['customers', 'the opening balances of the Customers file', 1], ['vendors', 'the opening balances of the Vendors file', -1]]) {
      const rows = rowsOf(key);
      if (!rows.length) continue;
      any = true;
      const layout = fileLayout(db, jobId, key);
      let total = new Decimal(0), n = 0;
      for (const g of rows) {
        const a = dec(layout.values(g).opening_balance);
        if (a.isZero()) continue;
        n++; total = total.plus(a.times(sign));
        singles.push({ key, label: key === 'customers' ? 'Customers' : 'Vendors', name: String(g.ident ?? ''), amount: a.times(sign) });
      }
      add(key, label, n, total);
    }
    const chart = rowsOf('accounts');
    if (chart.length) {
      any = true;
      const layout = fileLayout(db, jobId, 'accounts');
      let total = new Decimal(0), n = 0;
      for (const g of chart) {
        const v = layout.values(g), a = dec(v.opening_balance);
        if (a.isZero()) continue;
        n++; total = total.plus(/^debit$/i.test(String(v.debit_or_credit ?? '').trim()) ? a : a.negated());
      }
      add('accounts', 'the opening balances of the Chart of Accounts file', n, total);
    }
    const journal = rowsOf('opening_balances_for_zoho_accounts');
    if (journal.length) {
      any = true;
      const layout = fileLayout(db, jobId, 'opening_balances_for_zoho_accounts');
      const by = { 1: { total: new Decimal(0), n: 0 }, 2: { total: new Decimal(0), n: 0 } };
      for (const g of journal) {
        const v = layout.values(g);
        const j = String(v.journal_number_suffix ?? '1').trim() === '2' ? 2 : 1;
        if (accountNameKey(String(v.account ?? '')) === accountNameKey(ZOHO_OPENING_BALANCE_ACCOUNT)) by[j].total = by[j].total.plus(dec(v.credit)).minus(dec(v.debit));
        else by[j].n++;
      }
      if (by[1].n) add('journal_ob1', 'the opening balance journal OB-1', by[1].n, by[1].total);
      if (by[2].n) add('journal_ob2', 'the journal OB-2 of customer and vendor advances', by[2].n, by[2].total);
    }
  } catch { return { available: false, groups: [], singles: [] }; }
  return { available: any, groups, singles };
}

// ---------- routes ----------
// deps: tallyTrialBalance(jobId) -> { summary, lines } | null; ledgerInfo(jobId) -> (name) => { parent, customer, vendor, tax };
// context(jobId) -> makeContext.
export function registerZohoTb(app, { db, need, audit, now, tx, tallyTrialBalance, ledgerInfo, context }) {
  db.exec(`CREATE TABLE IF NOT EXISTS zoho_tb_checks (job_id TEXT PRIMARY KEY, file_name TEXT, format TEXT, header_row INTEGER, columns TEXT, basis TEXT, balance_sign TEXT,
    accounts TEXT, headings TEXT, totals TEXT, unreadable TEXT, repeated TEXT, uploaded_by TEXT, at TEXT)`);
  try { db.exec('ALTER TABLE zoho_tb_checks ADD COLUMN period TEXT'); } catch { /* exists */ }
  const actor = req => req.user?.email || 'system';

  // The Tally side: the ledger lines of the Tally Trial Balance report, under their Zoho names.
  const tallySide = (jobId, basis) => {
    const tb = tallyTrialBalance(jobId);
    if (!tb || !tb.lines.length) return { problem: 'The Tally Trial Balance report has not been read yet. Upload it and process the data first.' };
    const ctx = context(jobId);
    const infoOf = ledgerInfo(jobId);
    const entries = [], notCompared = [], groupLines = [];
    let noFigure = 0;
    for (const l of tb.lines) {
      if (l.hasChildren) continue;
      const raw = basis === 'opening' ? l.opening : l.closing;
      if (l.matchType !== 'ledger') {
        if (l.matchType === 'group') { groupLines.push(visibleName(l.name)); continue; }
        // round 1 (issue 1): the line's figure is kept, so a balance on a line no file creates is never hidden
        let a = null; try { a = new Decimal(raw === '' || raw == null ? 0 : String(raw)); } catch { a = null; }
        notCompared.push({ ledger: visibleName(l.name), ...(a ? { amount: fig(a) } : {}), reason: a && !a.isZero()
          ? `The line matches no ledger of the masters, and no file creates it: its balance ${fig(a).amount} ${fig(a).side} is not in Zoho Books, so the account it belongs to will differ from Tally by that amount.`
          : 'The line matches no ledger of the masters.' });
        continue;
      }
      if (raw === '' || raw == null) noFigure++;
      let amount; try { amount = new Decimal(raw === '' || raw == null ? 0 : String(raw)); } catch { notCompared.push({ ledger: visibleName(l.matchName), reason: `The ${basis} figure "${raw}" could not be read.` }); continue; }
      const z = zohoAccountOf(l.matchName, infoOf(l.matchName), ctx);
      if (z.notCompared) { notCompared.push({ ledger: visibleName(l.matchName), amount: fig(amount), reason: z.notCompared }); continue; }
      entries.push({ ledger: l.matchName, amount, ...z });
    }
    return { entries, notCompared, groupLines, noFigure, atLedgerLevel: !!tb.summary?.atLedgerLevel };
  };

  const view = jobId => {
    const row = db.prepare('SELECT * FROM zoho_tb_checks WHERE job_id = ?').get(jobId);
    if (!row) return { note: ZOHO_TB_NOTE, check: null };
    const P = (v, d) => { try { return JSON.parse(v ?? 'null') ?? d; } catch { return d; } };
    const accounts = P(row.accounts, []).map(a => ({ ...a, amount: new Decimal(a.amount) }));
    const basis = BASES.includes(row.basis) ? row.basis : 'closing';
    const t = tallySide(jobId, basis);
    const check = { fileName: row.file_name, format: row.format, headerRow: row.header_row, columns: P(row.columns, {}), basis, balanceSign: row.balance_sign || null,
      period: P(row.period, null), zohoAccounts: accounts.length, headingsLeftOut: P(row.headings, []), totalsLeftOut: P(row.totals, []), unreadable: P(row.unreadable, []), repeated: P(row.repeated, []),
      uploadedBy: row.uploaded_by, at: row.at };
    const opening = (() => { try { return context(jobId).openingJournalDate || ''; } catch { return ''; } })();
    // the Opening Balance Date Zoho Books shows, as typed in the Import Wizard (step "Save the Migration Date")
    const zohoDate = (() => { try { const v = String(db.prepare("SELECT value FROM wizard_ticks WHERE job_id = ? AND step = 'date' AND item = 'd.zohoDate'").get(jobId)?.value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; } catch { return ''; } })();
    const sources = openingSources(db, jobId);
    const datedByZoho = sources.groups.some(g => ['accounts', 'customers', 'vendors'].includes(g.key) && g.rows > 0);
    // a blocking finding, not a note: with another date the balances Zoho dates itself cannot be inside the year
    const dateProblem = !datedByZoho ? null
      : zohoDate && zohoDate !== opening ? `Zoho Books shows the Opening Balance Date ${zohoDate}, but the Migration Date of the tool is ${opening}. The opening balances of the Chart of Accounts, Customers and Vendors files are dated ${zohoDate}, so Opening Balance Adjustments cannot reach zero and the trial balance cannot match Tally. Set the date to ${opening} on Settings > Setup & Configurations > Opening Balances and press Sync (Zoho Books lets the date be changed only while no customer or vendor opening balance exists: otherwise delete those balances first, or start a new organisation). Then export the report again.`
        : !zohoDate ? `The Opening Balance Date of Zoho Books was not checked (Import Wizard, step "Save the Migration Date"). It must be ${opening}: the opening balances of the Customers and Vendors files take that date. Check it on Settings > Setup & Configurations > Opening Balances before you rely on this comparison.` : null;
    const pw = periodWarning(check.period, opening, zohoDate);
    if (t.problem) return { note: ZOHO_TB_NOTE, check, problem: t.problem, comparison: null, rangeNote: ZOHO_TB_RANGE_NOTE, periodWarning: pw.warning, openingDate: opening, zohoOpeningDate: zohoDate || null, dateProblem };
    const comparison = compareTb(t.entries, accounts);
    // the Zoho side must balance by itself (a real export does): a total that does not is a sign of a cut-off or a wrong column
    const zDebit = accounts.reduce((s, a) => (a.amount.isNegative() ? s.plus(a.amount.abs()) : s), new Decimal(0)), zCredit = accounts.reduce((s, a) => (a.amount.isNegative() ? s : s.plus(a.amount)), new Decimal(0));
    // Opening Balance Adjustments in Zoho's report: zero when every opening balance is in, else explained from the files
    const oba = accounts.filter(a => accountNameKey(a.name) === accountNameKey(ZOHO_OPENING_BALANCE_ACCOUNT)).reduce((s, a) => s.plus(a.amount), new Decimal(0));
    const adjustment = sources.available ? { account: ZOHO_OPENING_BALANCE_ACCOUNT, ...explainAdjustment(oba, sources.groups, sources.singles),
      sources: sources.groups.map(g => ({ key: g.key, label: g.label, rows: g.rows, amount: fig(g.amount) })) } : null;
    return { note: ZOHO_TB_NOTE, check, rangeNote: ZOHO_TB_RANGE_NOTE, periodWarning: pw.warning, openingDate: opening, zohoOpeningDate: zohoDate || null, dateProblem, adjustment,
      zohoBalanced: zDebit.equals(zCredit), comparison: { ...comparison, notCompared: t.notCompared, groupLinesNotCompared: t.groupLines, tallyAtLedgerLevel: t.atLedgerLevel,
      basisWords: basis === 'opening' ? "Tally's opening balances (Opening column of the Tally Trial Balance) against a Zoho Trial Balance dated the day before the financial year starts."
        : "Tally's closing balances (Closing column of the Tally Trial Balance) against a Zoho Trial Balance dated the last day of the financial year. Receipts from customers, payments to vendors, debit notes to vendors and credit notes to customers have no Zoho file yet (Zoho's import samples for Payments Received, Payments Made, Vendor Credits and Credit Notes are needed), and vouchers of other types have none either, so closing balances differ until they are entered. Contra vouchers and the other receipts, payments and notes are in the journals file of these vouchers.",
      ...(t.noFigure ? { linesWithoutFigure: t.noFigure } : {}) } };
  };

  app.get('/api/migrations/:id/zoho-trial-balance', (req, reply) => { const job = need(req, reply); if (!job) return; return view(job.id); });
  // Body: the file. Query: basis=closing|opening, accountColumn, debitColumn, creditColumn, balanceColumn, balanceSign=debit_positive|credit_positive.
  app.put('/api/migrations/:id/zoho-trial-balance', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    const q = req.query || {};
    const basis = String(q.basis || 'closing');
    if (!BASES.includes(basis)) return reply.code(400).send({ error: 'Choose the closing or the opening balances to compare.' });
    const balanceSign = String(q.balanceSign || '') || null;
    if (balanceSign && !BALANCE_SIGNS.includes(balanceSign)) return reply.code(400).send({ error: 'Say whether a positive balance is a debit or a credit.' });
    const table = readTable(req.body);
    if (table.error) return reply.code(422).send({ error: table.error });
    const picks = Object.fromEntries(['accountColumn', 'debitColumn', 'creditColumn', 'balanceColumn'].map(k => [k, String(q[k] || '').trim() || null]));
    const cols = detectTbColumns(table.rows, picks);
    if (cols.error) return reply.code(422).send({ ...cols, note: ZOHO_TB_NOTE });
    const read = readZohoTb(table.rows, cols, { balanceSign });
    if (read.needsSign.length) {
      return reply.code(422).send({ error: `The column "${cols.balance}" has figures without Dr or Cr (for example "${read.needsSign[0]}"). Say whether a positive figure in it is a debit or a credit.`,
        needsSign: true, headers: cols.headers.filter(Boolean), detected: { account: cols.account, balance: cols.balance }, note: ZOHO_TB_NOTE });
    }
    if (!read.accounts.length) return reply.code(422).send({ error: `No account with a figure was found under "${cols.account}". Check the columns.`, needsColumns: true, headers: cols.headers.filter(Boolean), note: ZOHO_TB_NOTE });
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    const columns = { account: cols.account, debit: cols.debit, credit: cols.credit, balance: cols.balance, how: cols.how };
    tx(() => {
      db.prepare('INSERT OR REPLACE INTO zoho_tb_checks (job_id, file_name, format, header_row, columns, basis, balance_sign, accounts, headings, totals, unreadable, repeated, uploaded_by, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(job.id, fileName || null, table.format, cols.headerRow + 1, JSON.stringify(columns), basis, balanceSign,
          JSON.stringify(read.accounts.map(a => ({ name: a.name, amount: a.amount.toFixed(), rows: a.rows }))), JSON.stringify(read.headings.slice(0, 200)),
          JSON.stringify(read.totals.map(x => ({ name: x.name, amount: fig(x.amount) }))), JSON.stringify(read.unreadable.slice(0, 200)), JSON.stringify(read.repeated), actor(req), now());
      db.prepare('UPDATE zoho_tb_checks SET period = ? WHERE job_id = ?').run(JSON.stringify(readTbPeriod(table.rows)), job.id);
      audit(job.id, 'zoho_trial_balance_uploaded', `Zoho Trial Balance${fileName ? ` "${fileName}"` : ''} (${table.format.toUpperCase()}): ${read.accounts.length} account(s) read from "${cols.account}" and `
        + `${cols.balance ? `"${cols.balance}"${balanceSign ? ` (a positive figure is a ${balanceSign === 'debit_positive' ? 'debit' : 'credit'})` : ''}` : `"${cols.debit}" / "${cols.credit}"`}; compared with Tally's ${basis} balances. `
        + `${read.headings.length} heading row(s) and ${read.totals.length} total row(s) left out${read.unreadable.length ? `, ${read.unreadable.length} row(s) could not be read` : ''}. ${readTbPeriod(table.rows) ? `Period of the export: ${readTbPeriod(table.rows).from} to ${readTbPeriod(table.rows).to}.` : ''}`);
    });
    return view(job.id);
  });
  // { basis }: compare the same Zoho report with Tally's other column.
  app.put('/api/migrations/:id/zoho-trial-balance/basis', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const basis = String(req.body?.basis || '');
    if (!BASES.includes(basis)) return reply.code(400).send({ error: 'Choose the closing or the opening balances to compare.' });
    const row = db.prepare('SELECT basis FROM zoho_tb_checks WHERE job_id = ?').get(job.id);
    if (!row) return reply.code(404).send({ error: 'Upload the Zoho Trial Balance first.' });
    if (row.basis !== basis) {
      db.prepare('UPDATE zoho_tb_checks SET basis = ? WHERE job_id = ?').run(basis, job.id);
      audit(job.id, 'zoho_trial_balance_basis_changed', `The Zoho Trial Balance is now compared with Tally's ${basis} balances (was ${row.basis}).`);
    }
    return view(job.id);
  });
  app.delete('/api/migrations/:id/zoho-trial-balance', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const row = db.prepare('SELECT file_name FROM zoho_tb_checks WHERE job_id = ?').get(job.id);
    if (row) {
      db.prepare('DELETE FROM zoho_tb_checks WHERE job_id = ?').run(job.id);
      audit(job.id, 'zoho_trial_balance_removed', `The Zoho Trial Balance${row.file_name ? ` "${row.file_name}"` : ''} was removed.`);
    }
    return view(job.id);
  });
  // tallySide: also what the expected trial balance (predictedtb.js) compares the files with, before any import
  return { zohoTbView: view, tallySide };
}

// For the made-up and real-data checks: a ledger info function from plain lists.
export const ledgerInfoFrom = ({ parents, customers, vendors, taxes }) => name => ({
  parent: parents.get(matchKey(name)) || '', customer: customers.has(name), vendor: vendors.has(name), tax: taxes.has(name) });
