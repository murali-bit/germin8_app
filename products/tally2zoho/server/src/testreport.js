// Test run report: everything needed to review a test round of a migration on real data, in one response.
// It only restates facts held in the database. There are no scores and no "readiness" percentages.

import { ALL_FILES, verificationSummary, RECONCILIATION_NOTE } from './extras.js';
import { taxMappingList, zohoTaxList, taxLedgersToDecide } from './taxes.js';
import { SAMPLE_NEEDED } from './payments.js';
import { isAssumption } from './defaults.js';

const EXAMPLES = 3;   // flagged items shown per group
const TOP_FIELDS = 10; // names of fields not transferred shown per dataset
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Items raised before kinds were recorded (and the ones that never had one) are grouped by what their message says.
const KINDS = {
  process: [[/has no name/i, 'no_name'], [/Duplicate record/i, 'duplicate'], [/date .* is not readable/i, 'date_unreadable'], [/differ by/i, 'unbalanced'],
    [/Unreadable amount/i, 'amount_unreadable'], [/no ledger entries/i, 'no_lines']],
  generate: [[/has not been routed/i, 'journal_unrouted'], [/^Left out/i, 'left_out'], [/is not mapped to a Zoho tax\. Map it/i, 'tax_unmapped'],
    [/no approved Zoho account type/i, 'account_type_missing'], [/Zoho's Opening Balance column carries a balance without its sign/i, 'balance_unusual_side'], [/Opening balances do not balance/i, 'opening_balances_unbalanced'],
    [/has no unit/i, 'item_no_unit'], [/is not in the uploaded/i, 'party_not_in_master']],
};
// Flagged kinds that must be resolved before the file is imported: the import is expected to reject rows otherwise.
// zoho_builtin_account_name: a ledger named like one of Zoho's own accounts with no decision in Mapping Studio (the row
// is expected to be rejected as a duplicate, with its opening balance).
// display_name_duplicate / account_name_duplicate: two rows of the Customers, Vendors or Chart of Accounts file WRITTEN
// with the same name (two Tally records with one name, or names the accountant chose to clean into the same one).
// Pick and drop: a name with a line break or hidden character, and names that are the same only once cleaned, are
// passed as in Tally and are WARNINGS (NAME_WARNING_KINDS), never blockers.
// tds_not_mapped: a TDS ledger on the vendor side of bills with no Zoho TDS tax chosen (the TDS is then a negative line,
// expected to be rejected); voucher_layout_outdated: a saved voucher layout made before the files took the official
// sample's headings (columns missing or written empty).
export const BLOCKS_IMPORT = new Set(['display_name_duplicate', 'item_rate_missing', 'account_without_group', 'profit_and_loss_balance_not_written', 'zoho_builtin_account_name',
  'account_name_duplicate', 'tds_not_mapped', 'voucher_layout_outdated',
  // account_type_missing: a Chart of Accounts row with no Account Type, which Zoho requires;
  // place_of_supply_missing_taxed: an invoice or bill with GST on a line but no state, which Zoho needs to tell IGST
  // from CGST + SGST (Fix contacts gives the contact a state)
  'account_type_missing', 'place_of_supply_missing_taxed',
  // v2: a bill line of a registered vendor with no GST and no exemption chosen: Zoho says "Specify either a Tax or Tax
  // Exemption or Reverse Charge" (defaults.js billLineWithoutTax). item_rate_missing and zoho_builtin_account_name are no
  // longer raised for a migration: an item with no rate is written with Rate 0.00 and a ledger named like one of
  // Zoho's own accounts is entered on Zoho's account, both by default and listed as assumptions.
  'bill_line_needs_tax_or_exemption',
  // CGST without SGST (or the reverse): no Zoho tax for half the GST, the line carries none (audit item 13); an invoice
  // whose every line is on an account that is not income (audit item 2)
  'tax_heads_incomplete', 'invoice_line_not_income',
  // an invoice line of a GST-registered (Regular) company with no GST in Tally, while the company's own state is unknown,
  // so the zero-rate tax cannot be chosen (GST-013): Zoho asks a tax, an exemption or a supply type on every line
  'invoice_line_tax_state_unknown',
  // a GST rate Zoho Books creates no tax for (3%, 40% ...) and none in the saved list or chosen: the line carries no tax (GST-011)
  'gst_rate_without_zoho_tax',
  // a document of another of the company's GST registrations than the Zoho organisation's (GST-004)
  'multiple_gst_registrations',
  // GST with cess on a line and no Zoho tax group chosen for it: the whole tax of the line is left out (GST-005)
  'gst_cess_not_mapped',
  // the masters' opening balances do not add up to zero, are the balances of an earlier books-beginning day with no
  // Trial Balance report to check them, or differ from the Trial Balance report's Opening column (OB-011, OB-002)
  'opening_balances_differ_in_tally', 'opening_balances_books_begin_earlier', 'opening_balance_differs_from_trial_balance']);
// Processing flags about names: once the accountant decided the name in Mapping Studio (Names), they are no longer
// listed as something to fix (the flagged items themselves stay until the data is processed again).
const NAME_KINDS = new Set(['name_hidden_characters', 'name_edge_spaces', 'possible_duplicate']);
// Flags about names that are passed exactly as in Tally (pick and drop): warnings only. Names will be filled in from
// the GST portal later; cleaning one in Mapping Studio (Names) is optional, for a name Zoho rejects.
export const NAME_WARNING_KINDS = new Set(['name_hidden_characters', 'name_edge_spaces', 'display_name_hidden_characters', 'account_name_hidden_characters',
  'mailing_name_hidden_characters', 'display_name_collides_after_cleaning', 'account_name_collides_after_cleaning']);
const kindOf = e => e.kind || (KINDS[e.stage] || []).find(([re]) => re.test(e.message || ''))?.[1] || 'other';
const STAGE_NAME = { process: 'Processing (each record)', crosscheck: 'Processing (vouchers against masters)', generate: 'Creating the files' };

// ctx: { db, job, slotByKey, completeness(jobId), importList(jobId), fileList(job), accountTypes(jobId), unitList(jobId), processRun(jobId) }
export function buildTestReport(ctx) {
  const { db, job, slotByKey } = ctx;
  const comp = ctx.completeness(job.id);
  const processed = ['processed', 'generated'].includes(job.status);
  const one = (sql, ...a) => db.prepare(sql).get(job.id, ...a).n;

  // ----- datasets -----
  const datasets = comp.slots.map(s => {
    const kf = s.upload?.keyFields ?? null;
    const unread = s.upload?.fieldsNotRead ?? null;
    return {
      key: s.key, name: s.name, requirement: s.requirement, status: s.status, notApplicableReason: s.waiver?.reason ?? null,
      fileName: s.upload?.fileName ?? null, sha256: s.upload?.sha256 ?? null, sizeBytes: s.upload?.size ?? null, uploadedAt: s.upload?.uploadedAt ?? null,
      records: s.upload?.records ?? null, recordTypes: s.upload?.recordTypes ?? null,
      fromAllMasters: s.upload?.fromAllMasters ?? false, // the records came from the All Masters file (see allMasters)
      fromAllTransactions: s.upload?.fromAllTransactions ?? false, // the vouchers came from the All Transactions file (see allTransactions)
      // set for datasets that are read and kept, but from which no Zoho file is created yet (the reason, in words)
      noZohoFile: s.noZohoFile ?? null,
      // the Trial Balance slot, when a Tally Trial Balance report was uploaded: how it was read at upload
      trialBalanceReport: s.upload?.trialBalance ?? null,
      expectedCount: s.expectedCount, actualCount: s.actualCount, countMatches: s.countMatches,
      // fields present in the file that the platform does not read, so they are not transferred
      fieldsNotTransferred: unread ? { count: unread.count, top: unread.fields.slice(0, TOP_FIELDS), note: unread.note ?? null } : null,
      // key fields the platform depends on: only the ones with something to report
      keyFieldFindings: kf ? kf.fields.filter(f => f.severity).map(f => ({ field: f.field, recordType: f.recordType, level: f.level, present: f.present, total: f.total, status: f.status, similar: f.similar, severity: f.severity, message: f.message })) : null,
      mayNotBeReadable: s.mayNotBeReadable,
      warnings: s.upload?.warnings ?? [],
    };
  });

  // ----- processing -----
  const run = ctx.processRun(job.id);
  const stored = db.prepare('SELECT slot, object_type type, COUNT(*) n FROM source_records WHERE job_id = ? GROUP BY slot, object_type').all(job.id)
    .map(r => ({ slot: r.slot, name: slotByKey[r.slot]?.name ?? r.slot, type: r.type, records: r.n }));
  const totalStored = stored.reduce((t, r) => t + r.records, 0);
  const groups = [];
  const decided = ctx.decidedNames ? ctx.decidedNames(db, job.id) : new Set(); // ledgers whose name was decided in Mapping Studio (Names)
  for (const e of db.prepare('SELECT stage, slot, name, message, kind, uses FROM exceptions WHERE job_id = ? ORDER BY id').all(job.id)) {
    const kind = kindOf(e);
    let g = groups.find(x => x.stage === e.stage && x.kind === kind);
    if (!g) groups.push(g = { stage: e.stage, stageName: STAGE_NAME[e.stage] || e.stage, kind, count: 0, examples: [] });
    g.count++;
    if (NAME_KINDS.has(kind)) { g.undecided = (g.undecided || 0) + (decided.has(e.name) ? 0 : 1); if (decided.has(e.name)) continue; }
    if (g.examples.length < EXAMPLES) g.examples.push({ dataset: slotByKey[e.slot]?.name ?? e.slot ?? null, name: e.name, message: e.message, uses: e.uses ?? null });
  }
  // What the last finished run worked out beyond the records: how voucher ledger names compare with the masters, the
  // vouchers Tally does not post, and the Trial Balance report checks. null for a run made before these were recorded.
  const runResult = (() => { try { return JSON.parse(db.prepare('SELECT result FROM process_runs WHERE job_id = ?').get(job.id)?.result || 'null'); } catch { return null; } })();
  const tbSummary = (() => { const s = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(job.id); return s ? JSON.parse(s.data) : null; })();
  // vouchers per dataset, with the ones that are cancelled, optional or deleted in Tally (flagged, never written to a file)
  const notPosted = db.prepare("SELECT slot, kind, COUNT(*) n FROM exceptions WHERE job_id = ? AND stage = 'process' AND kind IN ('voucher_cancelled','voucher_optional','voucher_deleted') GROUP BY slot, kind").all(job.id);
  const vouchers = stored.filter(r => r.type === 'Voucher').map(r => ({
    slot: r.slot, name: r.name, vouchers: r.records,
    cancelled: notPosted.find(x => x.slot === r.slot && x.kind === 'voucher_cancelled')?.n ?? 0,
    optional: notPosted.find(x => x.slot === r.slot && x.kind === 'voucher_optional')?.n ?? 0,
    deleted: notPosted.find(x => x.slot === r.slot && x.kind === 'voucher_deleted')?.n ?? 0,
    zohoFile: comp.slots.find(s => s.key === r.slot)?.noZohoFile ? 'Read and kept; no Zoho file is created for these yet.' : slotByKey[r.slot]?.zoho ?? null,
  }));
  const processing = {
    status: job.status,
    vouchers,
    // the different ledger names on voucher lines: found in the masters exactly, only after ignoring hidden characters, or not at all
    ledgerNamesOnVouchers: processed ? runResult?.ledgerNames ?? null : null,
    // a Tally Trial Balance report: lines read, matched to ledgers and groups, the totals check and the movement check
    trialBalance: processed ? tbSummary : null,
    lastRun: run, // { state, startedAt, finishedAt, secondsTaken, startedBy, error } or null when the data was never processed (or was processed before runs were recorded)
    recordsStored: stored, totalRecordsStored: totalStored,
    // true when a file was replaced or removed after the data was last processed: what is stored and flagged is from the earlier files
    storedFromEarlierFiles: !processed && job.status !== 'processing' && totalStored > 0,
    // total: the same number as GET /summary counts.flagged; warnings: names passed as in Tally (counts.warnings)
    flaggedItems: { total: groups.reduce((t, g) => t + g.count, 0), warnings: groups.filter(g => NAME_WARNING_KINDS.has(g.kind)).reduce((t, g) => t + g.count, 0), groups },
  };

  // ----- decisions -----
  const at = ctx.accountTypes(job.id).groups;
  const withLedgers = at.filter(g => g.ledgers > 0);
  const taxes = taxMappingList(db, job.id);
  const taxList = zohoTaxList(db, job.id);
  const units = ctx.unitList(job.id);
  // cancelled, optional and deleted journals are never written to a file, so they need no routing
  const journalsNotPosted = ctx.journalsNotPosted ? ctx.journalsNotPosted(job.id) : 0;
  const journalsTotal = one("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = 'journal'") - journalsNotPosted;
  const journalsDecided = one('SELECT COUNT(*) n FROM journal_decisions WHERE job_id = ?');
  const decisions = {
    accountTypes: {
      groupsWithLedgers: withLedgers.length,
      standard: withLedgers.filter(g => g.source === 'standard').length, inherited: withLedgers.filter(g => g.source === 'inherited').length,
      decided: withLedgers.filter(g => g.source === 'decided').length, needingDecision: withLedgers.filter(g => g.needsDecision).length,
      groupsNeedingDecision: withLedgers.filter(g => g.needsDecision).map(g => ({ group: g.group, ledgers: g.ledgers })),
    },
    taxMappings: {
      taxLedgers: taxes.length, mapped: taxes.filter(t => t.mapped).length, unmapped: taxes.filter(t => !t.mapped).length,
      // v2: GST ledgers written with Zoho's own tax names of their rates, with no mapping (taxes.js); and those a person must map
      automatic: taxes.filter(t => t.source === 'auto').length, needPerson: taxLedgersToDecide(taxes).unmapped.length,
      notInList: taxes.filter(t => t.listStatus === 'not_in_list').length, notCheckedAgainstList: taxes.filter(t => t.listStatus === 'not_checked').length,
      zohoTaxListExists: taxList.length > 0, zohoTaxListCount: taxList.length,
      // taxRowVouchers: vouchers where the ledger is a tax on an invoice or bill (it needs a Zoho tax name there);
      // partySideVouchers: vouchers where it is on the party's side (for example tax deducted at source: no tax name is asked)
      unmappedLedgers: taxes.filter(t => !t.mapped).map(t => ({ ledger: t.ledger, vouchers: t.vouchers, taxRowVouchers: t.taxRowVouchers, partySideVouchers: t.partySideVouchers, appearsWithMapped: t.appearsWith.filter(a => a.mapped).map(a => a.ledger) })),
      ledgersNotInList: taxes.filter(t => t.listStatus === 'not_in_list').map(t => ({ ledger: t.ledger, zohoTax: t.zohoTax })),
    },
    unitMappings: {
      units: units.units.length, mapped: units.units.filter(u => u.zohoUnit).length, writtenAsInTally: units.units.filter(u => !u.zohoUnit).length,
      unitsFileUploaded: units.unitsFileUploaded, missingFromUnitsFile: units.units.filter(u => u.missingFromUnitsFile === true).length,
    },
    // total: the journals that need routing (cancelled, optional and deleted ones are counted in processing.vouchers instead)
    // undecided: journals with no decision. v2: they are NOT left out of the files; each is routed by the tool's default
    // (the clear suggestion, else Manual Journal) and listed under assumptions (routedByDefault is the same number).
    journalRouting: { total: journalsTotal, decided: journalsDecided, overridden: one('SELECT COUNT(*) n FROM journal_decisions WHERE job_id = ? AND decision <> suggested'), undecided: Math.max(0, journalsTotal - journalsDecided),
      routedByDefault: Math.max(0, journalsTotal - journalsDecided) },
  };
  // v2: the assumptions (defaults applied) the files created last were built with: [{ kind, title, words, count, check, blocking }]
  const assumptions = ctx.assumptions ? ctx.assumptions(job.id) : null;
  const control = ctx.voucherControl ? ctx.voucherControl(job.id) : null;

  // ----- files, import status -----
  const imports = Object.fromEntries(ctx.importList(job.id).map(i => [i.key, i]));
  const files = ctx.fileList(job).map(f => ({
    key: f.key, module: f.module, fileName: f.fileName, rows: f.rows, sha256: f.sha256, generatedAt: f.generatedAt,
    layoutVersion: f.mappingHash, layoutIsCurrent: f.currentLayout,
    // the column layout matched the official Zoho sample file when the file was created: the standard layout of a template
    // the platform checks against the sample (templateStatement.builtIn), or an admin's statement
    templateMarkedAsMatchingZohoSample: !!f.templateVerified, templateStatement: f.templateAttestation,
    // a reference report that must not be imported (the Opening Balances file)
    referenceOnly: !!f.referenceOnly,
    outOfDate: f.outOfDate, outOfDateReasons: f.outOfDateReasons,
  }));
  const importStatus = ctx.importList(job.id).map(i => ({ step: i.step, key: i.key, module: i.module, fileName: i.fileName, status: i.status, note: i.note, updatedAt: i.updatedAt, ready: i.ready, waitingFor: i.waitingFor, outOfDate: i.outOfDate }));

  // ----- Zoho modules with no import sample: the vouchers held for them when the files were created last -----
  const heldRows = (() => { try { return db.prepare('SELECT file_key, COUNT(*) n FROM held_vouchers WHERE job_id = ? GROUP BY file_key').all(job.id); } catch { return []; } })();
  const waitingForZohoSample = Object.entries(SAMPLE_NEEDED).map(([key, s]) => ({ key, module: s.module, vouchers: heldRows.find(r => r.file_key === key)?.n ?? 0,
    sampleNeeded: s.sample, importAfter: ALL_FILES[s.importAfter]?.module ?? s.importAfter, built: false }));

  // ----- rejections by file and category -----
  const rejections = [];
  for (const r of db.prepare('SELECT key, category, status, COUNT(*) n FROM rejections WHERE job_id = ? GROUP BY key, category, status ORDER BY key, category').all(job.id)) {
    let e = rejections.find(x => x.key === r.key);
    if (!e) rejections.push(e = { key: r.key, module: ALL_FILES[r.key]?.module || r.key, total: 0, open: 0, corrected: 0, retried: 0, unlinked: 0, categories: [] });
    e.total += r.n; if (r.status in e) e[r.status] += r.n;
    let c = e.categories.find(x => x.category === r.category);
    if (!c) e.categories.push(c = { category: r.category, count: 0 });
    c.count += r.n;
  }

  // ----- reconciliation totals per file -----
  const reconciliation = verificationSummary(db, job.id).map(v => ({
    key: v.key, module: v.module, checked: v.checked, expected: v.expected, matched: v.matched, missing: v.missing, extra: v.extra,
    amountsComparable: v.amountsComparable, amountColumn: v.amountColumn, amountsCompared: v.amountsCompared, amountsDiffering: v.amountsDiffering, amountsNotAvailable: v.amountsNotAvailable,
    totalExpected: v.totalExpected, totalExpectedCompared: v.totalExpectedCompared, totalInZoho: v.totalInZoho, note: v.note,
  }));

  // ----- what to fix next: built only from the facts above, in the order of the flow -----
  const fix = [];
  const add = (stage, blocking, message) => fix.push({ order: fix.length + 1, stage, blocking, message });
  // 1. uploads
  for (const s of comp.slots.filter(x => x.requirement === 'required' && x.status === 'missing')) add('Upload', true, `Upload the ${s.name} file. It is required, and processing cannot start without it.`);
  for (const s of comp.slots.filter(x => x.requirement === 'conditional' && x.status === 'missing')) add('Upload', true, `Upload the ${s.name} file, or mark it as not applicable. Processing cannot start until one of the two is done.`);
  for (const m of comp.countMismatches) add('Upload', true, m.message);
  for (const d of datasets.filter(x => x.mayNotBeReadable)) add('Upload', false, `${d.name}: the file "${d.fileName}" may not be readable. Every field the platform needs is missing from every record. Check the export from Tally before going further.`);
  for (const d of datasets.filter(x => !x.mayNotBeReadable)) for (const f of (d.keyFieldFindings || []).filter(x => x.severity === 'warning')) add('Upload', false, f.message);
  // 2. processing
  if (run?.state === 'running' || run?.state === 'queued' || job.status === 'processing') add('Processing', true, 'Processing is running. Wait for it to finish.');
  else if (!processed) {
    if (run?.state === 'failed') add('Processing', true, `The last processing run failed: ${run.error} Nothing is shown as processed. Correct the problem and process again.`);
    else if (processing.storedFromEarlierFiles) add('Processing', true, 'A file was uploaded or removed after the data was last processed. Process the data again: the stored records and flagged items are from the earlier files.');
    else if (comp.ready) add('Processing', true, 'All datasets are in place. Process the uploaded data.');
  }
  if (processed && tbSummary && !tbSummary.atLedgerLevel) add('Processing', false, 'The Trial Balance uploaded is not at ledger level, so no Opening Balances file is created (a reference report; the opening balances themselves are in the Chart of Accounts, Customers and Vendors files). In Tally open the Trial Balance, press Alt+F5 for the detailed view so every ledger is listed, export it again and upload it.');
  for (const g of groups.filter(x => x.stage !== 'generate')) {
    if (NAME_KINDS.has(g.kind)) {
      if (!g.undecided) continue; // every name decided in Mapping Studio (Names)
      const words = NAME_WARNING_KINDS.has(g.kind)
        ? `${g.undecided === 1 ? 'is' : 'are'} a warning: the name${g.undecided === 1 ? ' is' : 's are'} passed exactly as in Tally (cleaning in Mapping Studio, Names, is optional)`
        : `${g.undecided === 1 ? 'is' : 'are'} not decided yet in Mapping Studio (Names)`;
      add('Processing', false, `${plural(g.undecided, 'flagged item')} of kind "${g.kind}" from ${g.stageName.toLowerCase()} ${words}${g.undecided < g.count ? ` (${g.count - g.undecided} decided)` : ''}. The first is: ${g.examples[0].name ? `${g.examples[0].name}: ` : ''}${g.examples[0].message}`);
      continue;
    }
    add('Processing', false, `${plural(g.count, 'flagged item')} of kind "${g.kind}" from ${g.stageName.toLowerCase()}. The first is: ${g.examples[0].name ? `${g.examples[0].name}: ` : ''}${g.examples[0].message}`);
  }
  if (processed) {
    // 3. decisions
    const need = decisions.accountTypes.groupsNeedingDecision;
    if (need.length) add('Decisions', false, `${plural(need.length, 'Tally group')} with ledgers ${need.length === 1 ? 'has' : 'have'} no Zoho account type: ${need.map(g => `"${g.group}"`).join(', ')}. Decide ${need.length === 1 ? 'it' : 'them'} in Mapping Studio, or the accounts are written with a blank type.`);
    // Tax ledgers that are a tax on an invoice or bill somewhere (sales and purchase vouchers, and journals with that
    // pattern). A ledger that is only ever on the party's side (tax deducted at source) needs no Zoho tax name.
    const usedUnmapped = taxLedgersToDecide(taxes).unmapped.map(t => decisions.taxMappings.unmappedLedgers.find(u => u.ledger === t.ledger)).map(t => ({ ...t, vouchers: t.taxRowVouchers ?? t.vouchers }));
    const partySideOnly = decisions.taxMappings.unmappedLedgers.filter(t => t.taxRowVouchers === 0 && t.partySideVouchers > 0);
    if (partySideOnly.length) add('Decisions', false, `${plural(partySideOnly.length, 'tax ledger')} ${partySideOnly.length === 1 ? 'is' : 'are'} used only on the party's side of bills or invoices (for example tax deducted at source): ${partySideOnly.map(t => `"${t.ledger}" (${plural(t.partySideVouchers, 'voucher')})`).join(', ')}. No Zoho tax mapping is needed for ${partySideOnly.length === 1 ? 'it' : 'them'}. A ledger whose Tally type is TDS goes to the bill's TDS columns once its Zoho TDS tax is chosen in Mapping Studio (TDS mapping); for any other, an accountant must decide how to enter it in Zoho Books (vendor credit or separate journal).`);
    if (usedUnmapped.length) add('Decisions', false, `${plural(usedUnmapped.length, 'tax ledger')} used on vouchers ${usedUnmapped.length === 1 ? 'is' : 'are'} not mapped to a Zoho tax: ${usedUnmapped.map(t => `"${t.ledger}" (${plural(t.vouchers, 'voucher')})`).join(', ')}.`);
    for (const t of usedUnmapped.filter(x => x.appearsWithMapped.length)) add('Decisions', false, `Tax ledger "${t.ledger}" is not mapped, but it is on the same vouchers as ${t.appearsWithMapped.map(n => `"${n}"`).join(' and ')}, which ${t.appearsWithMapped.length === 1 ? 'is' : 'are'} mapped. Map it as well.`);
    for (const t of decisions.taxMappings.ledgersNotInList) add('Decisions', false, `Tax ledger "${t.ledger}" is mapped to "${t.zohoTax}", which is not in your Zoho tax list. Choose a listed name or add this name to the list.`);
    if (decisions.journalRouting.undecided) add('Decisions', false, `${plural(decisions.journalRouting.undecided, 'journal voucher')} ${decisions.journalRouting.undecided === 1 ? 'has' : 'have'} no routing decision. ${decisions.journalRouting.undecided === 1 ? 'It is' : 'They are'} not left out: each is written by the tool's default (the clear suggestion, otherwise a Manual Journal), listed under the assumptions. Route them in Voucher Classification if you want another choice.`);
    // M2: a voucher that is in NO file must never pass unnoticed. With the defaults no journal waits for routing; if the
    // files created last still hold some (created by an earlier version), that blocks until the files are created again.
    if (control?.awaitingRouting) add('Files', true, `${plural(control.awaitingRouting, 'journal voucher')} ${control.awaitingRouting === 1 ? 'is' : 'are'} in none of the files created last, because ${control.awaitingRouting === 1 ? 'it was' : 'they were'} waiting for a routing decision. Create the files again: journals with no decision are then routed by default.`);
    if (control?.leftOut) add('Files', false, `${plural(control.leftOut, 'voucher')} ${control.leftOut === 1 ? 'is' : 'are'} left out of the files with a reason (cancelled, optional or deleted in Tally, dated outside the financial year, not balanced, or a reversal). Each has its own flagged item; the Voucher Reconciliation lists them.`);
    // 4. files
    if (!files.length) add('Files', true, 'No files have been created yet. Create the files.');
    const stale = files.filter(f => f.outOfDate);
    if (stale.length) add('Files', true, `${plural(stale.length, 'file')} ${stale.length === 1 ? 'is' : 'are'} out of date and cannot be downloaded or marked as imported: ${stale.map(f => f.module).join(', ')}. ${[...new Set(stale.flatMap(f => f.outOfDateReasons))].join(' ')} Create the files again.`);
    for (const w of waitingForZohoSample.filter(x => x.vouchers)) add('Files', false, `${plural(w.vouchers, 'voucher')} belong in Zoho's ${w.module}, which is not built: its import sample is not in the platform. Needed: ${w.sampleNeeded}. Until it is added, enter ${w.vouchers === 1 ? 'it' : 'them'} in Zoho Books by hand after the ${w.importAfter} file (the Export Center lists them with the invoices or bills they settle).`);
    for (const g of groups.filter(x => x.stage === 'generate')) add('Files', BLOCKS_IMPORT.has(g.kind), `${plural(g.count, 'flagged item')} of kind "${g.kind}" from creating the files${NAME_WARNING_KINDS.has(g.kind) ? ' (a warning: names are passed as in Tally)' : isAssumption(g.kind) ? ' (an assumption the tool made: a default was used because no decision was made)' : ''}. The first is: ${g.examples[0].name ? `${g.examples[0].name}: ` : ''}${g.examples[0].message}`);
    const unmarked = files.filter(f => !f.templateMarkedAsMatchingZohoSample && !f.referenceOnly);
    if (unmarked.length) add('Files', false, `The column headings of ${plural(unmarked.length, 'file')} have not been confirmed against an official Zoho sample file: ${unmarked.map(f => f.module).join(', ')}. Compare each with the sample file from the Zoho Books import page before importing.`);
    // 5. import
    for (const i of importStatus.filter(x => x.status === 'failed' || x.status === 'partial')) add('Import', false, `${i.module}: the import was recorded as ${i.status === 'failed' ? 'failed' : 'partly done'}${i.note ? ` (${i.note})` : ''}.`);
    const waiting = importStatus.filter(x => ['generated', 'downloaded'].includes(x.status));
    if (waiting.length) {
      const next = waiting.find(x => x.ready && !x.outOfDate);
      add('Import', false, `${plural(waiting.length, 'file')} ${waiting.length === 1 ? 'is' : 'are'} not yet recorded as imported: ${waiting.map(x => x.module).join(', ')}.${next ? ` The next one to import is ${next.module}.` : ''}`);
    }
    // 6. rejections
    for (const r of rejections.filter(x => x.open || x.unlinked)) add('Rejections', false, `${r.module}: ${r.open ? `${plural(r.open, 'rejection')} still to be corrected` : ''}${r.open && r.unlinked ? ' and ' : ''}${r.unlinked ? `${plural(r.unlinked, 'rejection')} that could not be linked to a Tally record` : ''}.`);
    // 7. reconciliation
    for (const v of reconciliation) {
      const imported = ['imported', 'partial'].includes(imports[v.key]?.status);
      if (!v.checked) { if (imported) add('Reconciliation', false, `${v.module}: recorded as imported, but no Zoho report has been uploaded to check it.`); continue; }
      if (v.missing) add('Reconciliation', false, `${v.module}: ${plural(v.missing, 'record')} of ${v.expected} ${v.missing === 1 ? 'was' : 'were'} not found in the Zoho report.`);
      if (v.extra) add('Reconciliation', false, `${v.module}: the Zoho report has ${plural(v.extra, 'record')} that ${v.extra === 1 ? 'is' : 'are'} not in the file.`);
      if (v.amountsDiffering) add('Reconciliation', false, `${v.module}: ${plural(v.amountsDiffering, 'amount')} of ${v.amountsCompared} compared ${v.amountsDiffering === 1 ? 'differs' : 'differ'} from the Zoho report.`);
    }
  }

  return {
    reportCreatedAt: new Date().toISOString(),
    migration: { id: job.id, company: job.company, gstin: job.gstin || '', financialYear: job.financial_year, method: job.method, source: job.source, destination: job.destination,
      status: job.status, createdAt: job.created_at, updatedAt: job.updated_at },
    datasets,
    // the two "all in one file" uploads and how each was split into the datasets above (null when not uploaded)
    filesHoldingSeveralDatasets: { allMasters: comp.allMasters, allTransactions: comp.allTransactions },
    processing, decisions, files,
    // the control total of the files created last, over every voucher dataset: stored = written + left out + awaiting
    // routing + kept without a Zoho file (null when no files were created)
    voucherControl: control,
    // v2: "Assumptions the tool made": every default applied to the files created last, per kind (null: no files yet)
    assumptions,
    // Zoho modules the Tally vouchers belong in whose import sample is not in the platform, so no file is built for them
    // (no column is invented): the sample needed, where it goes in the import order and the vouchers held for it
    waitingForZohoSample,
    importStatus, rejections, reconciliation,
    whatToFixNext: fix,
    notes: [
      'Receipt, Payment, Contra, Debit Note and Credit Note vouchers: contra vouchers, payments not to a vendor, receipts not from a customer, notes not to a vendor (debit) or customer (credit), and vouchers whose pattern is not clear are written as Manual Journals in their own file (journals_receipts_payments_contra.csv). Payments to vendors, receipts from customers, debit notes to vendors and credit notes to customers belong in Payments Made, Payments Received, Vendor Credits and Credit Notes, whose Zoho import samples are not in the platform: no column is invented, so those files are not built and the vouchers are held and listed (waitingForZohoSample), with the invoice or bill each amount would be applied to from the bill-wise details in Tally.',
      'Vouchers of other types that post to the ledgers are written as Manual Journals and are in the Trial Balance movement check; those Tally does not post (Memorandum, Reversing Journal, orders, no ledger amount) are stored and counted with no Zoho file.',
      'Cancelled, optional and deleted vouchers are kept and counted as flagged items of their own kind. They are never written to a Zoho file and are left out of every check.',
      'Opening balances are imported once: every ledger that is not a customer or vendor carries its opening balance in the dated opening balance journal (opening_balances_for_zoho_accounts.csv, journal OB-1), not in the Chart of Accounts file, so it does not depend on the Opening Balance Date saved in Zoho Books. The Chart of Accounts file keeps a balance only for a Stock account and, when customers or vendors have opening balances, for ONE account, whose import lets Zoho Books save the Migration Date. Customers and vendors carry theirs in the Opening Balance column of the Customers and Vendors files, and are not in the Chart of Accounts (Zoho Books keeps their balances in Accounts Receivable and Accounts Payable). A customer in credit or a vendor in debit is carried by journal OB-2 of the opening balance journal file.',
      'The Opening Balances file is a reference report only: do not import it. From a Tally Trial Balance report it is created only when the report is at ledger level, from its Opening Balance column; otherwise a flagged item says why.',
      'The standard layouts of the Customers, Vendors, Chart of Accounts, Items, Invoices, Bills and Manual Journals files have every heading of the official Zoho Books (India) sample import files, in the same order; the platform checks this. A layout changed by an admin is confirmed only when an admin marks it as matching, and that mark is the admin\'s own statement.',
      'Invoices and Bills carry the GST of each voucher on the line it belongs to (the mapped Zoho tax, its rate and type), with no separate tax rows. When that cannot be done with certainty the voucher is flagged and its tax cells are left empty. Tax deducted at source on a bill goes to the TDS columns when the Tally ledger\'s type is TDS and a Zoho TDS tax is chosen for it. No real Zoho import of these three files has been tried yet.',
      'The Tally field names the platform reads were confirmed on one real TallyPrime 7.1 export of masters, of transactions and of the Trial Balance report. Stock Summary field names, and inventory lines on vouchers, still come from Tally\'s published sample files and have not been confirmed on real exports.',
      RECONCILIATION_NOTE,
      'This report restates recorded facts only. It contains no score and no measure of readiness.',
    ],
  };
}
