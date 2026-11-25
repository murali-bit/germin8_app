// "Prepare migration": one checklist from the upload of the three Tally files to the files to download, in the order
// of the work. It only RESTATES what the other parts of the platform hold: every count comes from the same function
// the screen where it is decided uses (its own GET answer), so the checklist and those screens cannot disagree. Nothing
// is decided or changed here.
//
// ctx: {
//   job, user, comp (completeness), processing (processStatus), active (a run is queued or running),
//   views: { accountTypes, taxes (taxMappingList), tds (tdsView), units (unitList), items (itemView), clashes (clashView),
//            names (namesView), contacts (contactView), journals (listJournals), gst ({ codeSet, label, unregisteredConsumerAs }) },
//   files (fileList), imports (importList),
// }
// Each view is a function called only when the data has been processed (before that nothing can be decided).

import { taxLedgersToDecide } from './taxes.js';

export const THREE_FILES = [
  { slot: 'all_masters', name: 'All masters', tally: 'Gateway of Tally > E: Export > Masters, Type of Masters: All Masters, File Format: JSON (Data Exchange)' },
  { slot: 'all_transactions', name: 'All transactions', tally: 'Gateway of Tally > E: Export > Transactions, Period: the full financial year, File Format: JSON (Data Exchange)' },
  { slot: 'trial_balance', name: 'Trial Balance', tally: 'Display More Reports > Trial Balance, Alt+F5 (detailed), with opening, transactions and closing columns, Export, File Format: JSON (Data Exchange)' },
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The open decisions, grouped by the screen where each is made. open: what is still to be decided (null before
// processing); blocksImport: undecided items of this kind are expected to be rejected by Zoho or left out of the files
// (the test report's blocking flags, or vouchers left out); info: nothing to decide, shown so the setting is visible.
export function decisionItems(views) {
  // tax ledgers that may belong on a Zoho system account and have no decision yet (taxaccounts.js asks)
  const taxAskOf = clashes => (clashes.clashes || []).filter(c => c.needsDecision);
  const at = views.accountTypes();
  const withLedgers = at.groups.filter(g => g.ledgers > 0);
  const atOpen = withLedgers.filter(g => g.needsDecision).length;

  const taxes = views.taxes();
  const tOpen = taxLedgersToDecide(taxes);

  const tds = views.tds();
  const units = views.units();
  const items = views.items();
  const clashes = views.clashes();
  const taxAsk = taxAskOf(clashes);
  const names = views.names();
  const contacts = views.contacts();
  const journals = views.journals().filter(j => !j.notPosted);
  const jOpen = journals.filter(j => !j.decision);
  const gst = views.gst();
  const unitsMapped = units.units.filter(u => u.zohoUnit).length;
  // v2: an unmapped TDS ledger makes Zoho refuse rows only where a BILL carries it as a negative line: a purchase
  // voucher, or a journal written as a Bill (by a decision, or by default). A journal whose Bill suggestion would carry
  // such a line is a Manual Journal by default, which posts the TDS exactly as Tally did and needs no mapping.
  // v2: a ledger with a suggested Zoho TDS tax (source 'auto') is written with it by default and is not open
  const tdsOpen = new Set((tds.ledgers || []).filter(l => (l.source ? l.source === 'none' : !l.tdsName) && (l.partySideVouchers || 0) > 0).map(l => l.ledger));
  const tdsOnPurchases = taxes.some(t => tdsOpen.has(t.ledger) && (t.salesPurchaseVouchers || 0) > 0);
  const tdsOnBillJournals = journals.filter(j => (j.decision || j.defaultDecision) === 'Bill' && j.needsCheck).length;
  const tdsBlocks = tds.unmapped > 0 && (tdsOnPurchases || tdsOnBillJournals > 0 || !tds.ledgers?.some(l => 'partySideVouchers' in l));
  // how the TDS ledgers used on the party's side are written (voucheropts.js tdsView source)
  const tdsUsed = (tds.ledgers || []).filter(l => (l.partySideVouchers || 0) > 0);
  const tdsWritten = { explicit: tdsUsed.filter(l => l.source === 'explicit').length, auto: tdsUsed.filter(l => l.source === 'auto').length,
    customerDefault: tdsUsed.filter(l => l.source === 'customer_default').length };
  // HSN/SAC values Zoho does not accept (not 4, 6 or 8 digits) with no correction: written empty (audit item 15)
  const hsn = views.hsn ? views.hsn() : null;
  const hsnOpen = hsn ? hsn.values.filter(v => v.status === 'not_written') : [];
  // Pick and drop: only names WRITTEN the same block the import; names the same only once cleaned are warnings
  const sameNameUndecided = names.duplicates.filter(d => !d.decision && d.sameWrittenName).length;
  const onlyOnceCleaned = names.counts.duplicatesOnlyOnceCleaned ?? 0;
  // v2: the steps accepted as per Tally ({ key: { by, at } }), shown on each item
  const reviews = views.reviews ? views.reviews() : {};

  return withReviews(reviews, [
    { key: 'account_types', screen: 'screen-19', anchor: 'ms-account-types', place: 'Mapping Studio, Account types', title: 'Account types',
      open: atOpen, total: withLedgers.length, blocksImport: false,
      // v2 (defaults.js account_type_default): an undecided group takes the type from the nature Tally records on it
      byDefault: atOpen,
      words: atOpen ? `${plural(atOpen, 'Tally group')} with ledgers ${atOpen === 1 ? 'has' : 'have'} no Zoho account type decided: by default the type is taken from the nature of the Tally group (asset, liability, income or expense). Choose one here to change it.` : `All ${plural(withLedgers.length, 'group')} with ledgers have a Zoho account type.` },
    { key: 'tax_mapping', screen: 'screen-19', anchor: 'ms-tax-mapping', place: 'Mapping Studio, Tax mapping', title: 'Tax mapping',
      open: tOpen.unmapped.length + tOpen.notInList.length, total: taxes.length, blocksImport: false,
      words: tOpen.unmapped.length + tOpen.notInList.length
        ? [tOpen.unmapped.length ? `${plural(tOpen.unmapped.length, 'tax ledger')} used on invoices or bills ${tOpen.unmapped.length === 1 ? 'is' : 'are'} not mapped to a Zoho tax, so the tax is not put on the lines.` : '',
          tOpen.notInList.length ? `${plural(tOpen.notInList.length, 'tax ledger')} ${tOpen.notInList.length === 1 ? 'is' : 'are'} mapped to a name that is not in your Zoho tax list.` : ''].filter(Boolean).join(' ')
        : taxes.length ? 'Every tax ledger used on invoices or bills is mapped.' : 'No tax ledgers.' },
    { key: 'tds_mapping', screen: 'screen-19', anchor: 'ms-tds-mapping', place: 'Mapping Studio, TDS mapping', title: 'TDS mapping',
      open: tds.unmapped, total: tds.ledgers.length, blocksImport: tdsBlocks, byDefault: tdsWritten.auto + tdsWritten.customerDefault,
      words: tds.unmapped
        ? `${plural(tds.unmapped, 'TDS ledger')} deducted from vendors ${tds.unmapped === 1 ? 'has' : 'have'} no Zoho TDS tax, and Tally gives no section to suggest one. `
          + (tdsBlocks ? 'On those bills the TDS is a negative line, which Zoho may refuse. ' : '')
          + 'Journals that deduct it are written as Manual Journals by default: the TDS posts as in Tally, but not through Zoho\'s TDS columns, so it is missing from Zoho\'s TDS reports. Choose the Zoho TDS tax here: those journals then become bills with the TDS in the TDS columns.'
        : tds.ledgers.length
          ? `Every TDS ledger is written in the TDS columns of its bills and invoices (Zoho's TDS reports have it): ${[tdsWritten.explicit ? `${tdsWritten.explicit} with the Zoho TDS tax chosen here` : '', tdsWritten.auto ? `${tdsWritten.auto} with the one suggested from its section in Tally` : '', tdsWritten.customerDefault ? `${tdsWritten.customerDefault} deducted by customers with no section in Tally, with ${tds.customerDefault || 'the default for customers'}` : ''].filter(Boolean).join(', ') || 'none is used on a bill or invoice'}. Check that these TDS taxes exist in Zoho Books with these names.`
          : 'No ledger is of type TDS in Tally.' },
    { key: 'units', screen: 'screen-19', anchor: 'ms-units', place: 'Mapping Studio, Units', title: 'Units',
      open: 0, total: units.units.length, blocksImport: false, info: true,
      words: units.units.length ? `${plural(units.units.length, 'unit')}: ${unitsMapped} written as a different Zoho unit, ${units.units.length - unitsMapped} as in Tally. Nothing has to be decided.` : 'No units.' },
    // v2: an item with no selling rate is written with Rate 0.00 by default (an assumption), so it no longer blocks
    { key: 'item_rates', screen: 'screen-19', anchor: 'ms-item-rates', place: 'Mapping Studio, Rates', title: 'Item rates',
      open: items.counts.withoutSellingRate, total: items.counts.items, blocksImport: false, byDefault: items.counts.withoutSellingRate,
      words: items.counts.items
        ? `${items.counts.withoutSellingRate ? `${plural(items.counts.withoutSellingRate, 'item')} ${items.counts.withoutSellingRate === 1 ? 'has' : 'have'} no selling rate: Rate 0.00 is written by default, because Zoho requires one. Enter the real rates if you have them.` : 'Every item has a selling rate.'} ${items.counts.withoutPurchaseRate} without a purchase rate, ${items.counts.withoutTaxPreference} without a tax preference.`
          + (items.business ? ` Business type: ${items.business.value === 'services' ? 'services' : 'goods (trading or manufacturing)'}${items.business.source === 'default' ? ' (the default)' : ''}, so ${plural(items.counts.services ?? 0, 'item')} ${(items.counts.services ?? 0) === 1 ? 'is' : 'are'} written as service and ${items.counts.goods ?? 0} as goods.` : '')
        : 'No stock items.' },
    { key: 'builtin_accounts', screen: 'screen-19', anchor: 'ms-zoho-accounts', place: "Mapping Studio, Zoho's own accounts", title: "Zoho's own accounts",
      // v2: with no decision Zoho's own account is used (the default), so an undecided clash no longer blocks
      open: clashes.undecided, total: clashes.clashes.length, blocksImport: false, byDefault: clashes.undecided, warnings: taxAsk.length,
      words: (taxAsk.length ? `${plural(taxAsk.length, 'tax ledger')} (reverse charge, cess or TDS) ${taxAsk.length === 1 ? 'stays' : 'stay'} as ${taxAsk.length === 1 ? 'an account' : 'accounts'} of ${taxAsk.length === 1 ? 'its' : 'their'} own until you decide. Zoho posts those taxes to its own accounts, so the Zoho trial balance will differ from Tally on ${taxAsk.length === 1 ? 'it' : 'them'} unless you choose Zoho's own account for ${taxAsk.length === 1 ? 'it' : 'them'} or accept the difference. ` : '') + (clashes.undecided ? `${plural(clashes.undecided, 'account')} ${clashes.undecided === 1 ? 'has' : 'have'} the name of an account Zoho creates itself and no decision: Zoho's own account is used by default, and the opening balance goes to the opening balance journal. Rename ${clashes.undecided === 1 ? 'it' : 'any of them'} if it must stay an account of its own.` : clashes.clashes.length ? 'Every clash is decided.' : "No account has the name of one of Zoho's own accounts.") },
    // Pick and drop: names are passed as in Tally. A name with a line break is a warning (info, nothing to decide);
    // cleaning it is optional, for a name Zoho rejects.
    { key: 'names', screen: 'screen-19', anchor: 'ms-names', place: 'Mapping Studio, Names', title: 'Names with hidden characters',
      open: 0, total: names.counts.names, blocksImport: false, info: true, warnings: names.counts.notCleaned,
      // one wording with Mapping Studio, Names: written as in Tally unless cleaned (by you, or by default)
      words: names.counts.names
        ? `${plural(names.counts.names, 'name')} with a line break or hidden character: ${names.counts.notCleaned} written as in Tally, ${names.counts.cleaned ?? 0} cleaned by you${names.counts.cleanedByDefault ? `, ${names.counts.cleanedByDefault} cleaned by default` : ''}. A warning only. If Zoho rejects a name with a line break, clean it here.`
        : 'No name has hidden characters.' },
    { key: 'duplicates', screen: 'screen-19', anchor: 'ms-names', place: 'Mapping Studio, Names, Possible duplicates', title: 'Possible duplicates',
      open: names.counts.duplicatesUndecided, total: names.counts.duplicates, blocksImport: sameNameUndecided > 0, warnings: onlyOnceCleaned,
      words: [names.counts.duplicatesUndecided
        ? `${plural(names.counts.duplicatesUndecided, 'group')} of possible duplicates ${names.counts.duplicatesUndecided === 1 ? 'is' : 'are'} not decided${sameNameUndecided ? `; ${sameNameUndecided} of them would be written with the same name, which Zoho does not accept` : ''}.`
        : names.counts.duplicates ? 'Every group of possible duplicates that needs a decision is decided.' : 'No possible duplicates.',
        onlyOnceCleaned ? `${plural(onlyOnceCleaned, 'group')} ${onlyOnceCleaned === 1 ? 'is' : 'are'} the same only once cleaned: a warning, written as in Tally.` : '',
        names.counts.duplicatesMergedByDefault ? `${plural(names.counts.duplicatesMergedByDefault, 'group')} of contacts with the same name ${names.counts.duplicatesMergedByDefault === 1 ? 'is' : 'are'} written as one party by default.` : ''].filter(Boolean).join(' ') },
    { key: 'contact_fixes', screen: 'screen-19', anchor: 'ms-fix-contacts', place: 'Mapping Studio, Fix contacts', title: 'Contact details',
      open: contacts.counts.withProblems, total: contacts.counts.contacts, blocksImport: false,
      words: contacts.counts.withProblems
        ? `${plural(contacts.counts.withProblems, 'customer or vendor', 'customers or vendors')} still ${contacts.counts.withProblems === 1 ? 'has' : 'have'} a GST or state problem: ${contacts.problems.filter(p => p.remaining).map(p => `${p.words.toLowerCase()} (${p.remaining})`).join(', ')}.`
        : 'No customer or vendor has a GST or state problem left.' },
    { key: 'hsn', screen: 'screen-19', anchor: 'ms-hsn', place: 'Mapping Studio, HSN/SAC corrections', title: 'HSN/SAC codes',
      open: hsnOpen.length, total: hsn ? hsn.values.length : 0, blocksImport: false,
      words: hsnOpen.length
        ? `${plural(hsnOpen.length, 'HSN/SAC code')} ${hsnOpen.length === 1 ? 'needs' : 'need'} correcting: ${hsnOpen.slice(0, 5).map(v => `"${v.value}" (${v.value.length} digits, on ${plural(v.lines + v.items, 'line or item', 'lines or items')})`).join(', ')}${hsnOpen.length > 5 ? ', ...' : ''}. `
          + 'Zoho accepts 4, 6 or 8 digits, so it is written empty and Zoho\'s HSN summary (GSTR-1) would miss those lines. Type the right code once in HSN/SAC corrections: it is written on every line and item that carries the value.'
        : hsn && hsn.values.length ? 'Every HSN/SAC code is one Zoho accepts (or corrected).' : 'No HSN/SAC codes in the data.' },
    { key: 'journal_routing', screen: 'screen-20', anchor: 'journal-review', place: 'Voucher Classification', title: 'Journal routing',
      // v2: a journal with no decision is routed by default (never left out), so it no longer blocks. The numbers are
      // the routing the files are built with (the same build: index.js listJournals), the breakdown only of the
      // journals that are Manual Journals by default.
      open: jOpen.length, total: journals.length, blocksImport: false, byDefault: jOpen.length,
      words: jOpen.length ? (() => {
        const mj = jOpen.filter(j => j.defaultDecision === 'Manual Journal');
        const docs = jOpen.filter(j => j.defaultDecision && j.defaultDecision !== 'Manual Journal').length;
        const plain = mj.filter(j => j.suggested === 'Manual Journal' && j.clear !== false).length;
        const reimb = mj.filter(j => j.defaultKind === 'journal_default_reimbursement').length;
        const refused = mj.filter(j => j.defaultFallback).length;
        const negative = mj.filter(j => j.defaultKind === 'journal_default_manual' && !j.defaultFallback && j.clear !== false && j.needsCheck).length;
        const unclear = mj.filter(j => j.clear === false).length;
        const otherMj = mj.length - plain - reimb - refused - negative - unclear;
        const parts = [plain ? `${plain} plain journals (no customer or vendor)` : '', unclear ? `${unclear} with no clear pattern` : '', negative ? `${negative} whose Bill or Invoice would carry a negative row` : '',
          refused ? `${refused} whose Bill or Invoice Zoho would refuse or that would lose GST` : '', reimb ? `${reimb} reimbursements` : '', otherMj > 0 ? `${otherMj} that cannot be written as a Bill or Invoice` : ''].filter(Boolean);
        return `${plural(jOpen.length, 'journal voucher')} ${jOpen.length === 1 ? 'has' : 'have'} no routing decision and ${jOpen.length === 1 ? 'is' : 'are'} written by default: ${docs} as the Invoice or Bill the tool suggests, ${mj.length} as a Manual Journal${parts.length ? ` (${parts.join(', ')})` : ''}. None is left out.`;
      })()
        : journals.length ? 'Every journal voucher is routed.' : 'No journal vouchers.' },
    { key: 'gst_codes', screen: 'screen-32', anchor: 'gst-codes', place: 'Company Settings, GST treatment codes', title: 'GST treatment codes',
      open: 0, total: null, blocksImport: false, info: true,
      words: `In use: ${gst.label}.${gst.codeSet === 'help' && !gst.unregisteredConsumerAs ? ' A party marked "Unregistered/Consumer" in Tally is left empty and flagged until an admin chooses how such parties are written.' : ''} If Zoho rejects these codes on the first import, an admin can switch the set.` },
  ]);
}
const withReviews = (reviews, items) => items.map(i => ({ ...i, reviewed: reviews[i.key] || null }));

export function buildPrepareState(ctx) {
  const { job, comp, processing, active } = ctx;
  const processed = ['processed', 'generated'].includes(job.status);
  const slot = key => comp.slots.find(s => s.key === key);
  const canChange = ctx.user?.role !== 'viewer';

  // ----- 1. the three Tally files -----
  const tb = slot('trial_balance');
  const three = THREE_FILES.map(f => {
    if (f.slot === 'trial_balance') {
      return { ...f, uploaded: tb?.status === 'uploaded', notApplicable: tb?.status === 'not_applicable', fileName: tb?.upload?.fileName ?? null,
        records: tb?.upload?.records ?? null, uploadedAt: tb?.upload?.uploadedAt ?? null, warnings: tb?.upload?.warnings ?? [] };
    }
    const b = f.slot === 'all_masters' ? comp.allMasters : comp.allTransactions;
    return { ...f, uploaded: !!b, fileName: b?.fileName ?? null, records: b?.records ?? null, uploadedAt: b?.uploadedAt ?? null, warnings: b?.messages ?? [],
      datasets: b ? b.datasets.filter(d => d.current).map(d => ({ name: d.name, records: d.records })) : [] };
  });
  // the masters and the vouchers can also come from files uploaded one by one (Upload Center): then nothing is missing
  const uploadDone = three.every(f => f.uploaded || f.notApplicable) || (comp.missingRequired.length === 0 && comp.uploaded > 0);

  // ----- 2. datasets with no file -----
  const datasets = comp.slots.filter(s => s.requirement !== 'optional' && (s.status === 'missing' || s.status === 'not_applicable'))
    .map(s => ({ key: s.key, name: s.name, requirement: s.requirement, status: s.status, reason: s.waiver?.reason ?? null, auto: s.autoNotApplicable,
      canMarkNotApplicable: s.canMarkNotApplicable, confirmedEmpty: s.confirmedEmptyByAllTransactions }));
  const datasetsDone = comp.missingRequired.length === 0 && comp.awaitingConfirmation.length === 0;

  // ----- 3. processing -----
  const blockers = [
    ...comp.missingRequired.map(n => `${n}: no file yet. It is required.`),
    ...comp.awaitingConfirmation.map(n => `${n}: upload the file, or mark it as not applicable.`),
    ...comp.countMismatches.map(m => m.message),
  ];
  const storedEarlier = !processed && job.status !== 'processing' && !!ctx.recordsStored;

  // ----- 4. decisions -----
  const decisions = processed ? decisionItems(ctx.views) : null;
  const open = decisions ? decisions.filter(d => !d.info).reduce((t, d) => t + d.open, 0) : null;

  // ----- 5. and 6. files -----
  const files = processed ? ctx.files() : [];
  const imports = processed ? ctx.imports() : [];
  const outOfDate = files.filter(f => f.outOfDate);
  const importKeys = new Set(imports.map(i => i.key));
  const downloads = imports.map(i => ({ step: i.step, key: i.key, module: i.module, fileName: i.fileName, rows: i.rows, status: i.status,
    downloaded: i.status !== 'generated', outOfDate: i.outOfDate, outOfDateReasons: i.outOfDateReasons, waitingFor: i.waitingFor, zohoSetup: i.zohoSetup }));
  const reference = files.filter(f => !importKeys.has(f.key)).map(f => ({ key: f.key, module: f.module, fileName: f.fileName, rows: f.rows, referenceOnly: !!f.referenceOnly, note: f.referenceNote || null, outOfDate: f.outOfDate }));

  const steps = [
    { key: 'upload', title: 'Upload the three Tally files', done: uploadDone, files: three },
    { key: 'datasets', title: 'Mark what does not apply', done: datasetsDone, datasets, countMismatches: comp.countMismatches },
    { key: 'process', title: 'Read the files (processing)', done: processed && !active, active, processing, ready: comp.ready, blockers, storedEarlier, canStart: canChange && comp.ready && !active },
    // v2 (the zero-decision path): every open decision has a default, so this step is OPTIONAL. It is done as soon as
    // nothing is open that would make Zoho reject rows (blockingOpen); open counts what still runs on a default or
    // is flagged for checking. byDefault: the decisions left to the tool's defaults (listed as assumptions).
    { key: 'decisions', title: 'Review the decisions (optional)', optional: true, done: processed && (decisions ? decisions.filter(d => d.blocksImport).reduce((t, d) => t + d.open, 0) : 0) === 0, open, items: decisions,
      blockingOpen: decisions ? decisions.filter(d => d.blocksImport).reduce((t, d) => t + d.open, 0) : null,
      byDefault: decisions ? decisions.reduce((t, d) => t + (d.byDefault || 0), 0) : null },
    { key: 'files', title: 'Create the Zoho files', done: processed && files.length > 0 && outOfDate.length === 0, created: files.length, outOfDate: outOfDate.map(f => ({ key: f.key, module: f.module, reasons: f.outOfDateReasons })),
      canCreate: canChange && processed && !active && comp.countMismatches.length === 0, lastCreatedAt: files.map(f => f.generatedAt).sort().pop() || null },
    { key: 'download', title: 'Download the files in import order', done: downloads.length > 0 && downloads.every(d => d.downloaded && !d.outOfDate), files: downloads, reference },
  ];
  // Vouchers in no file yet (held for a missing Zoho sample): an OPEN item, never "done", until a file carries them.
  // The numbers are those of GET held-vouchers (heldvouchers.js), read from the voucher control total.
  const held = files.length && ctx.held ? ctx.held() : null;
  if (held?.available) {
    steps.splice(steps.findIndex(s => s.key === 'download'), 0, { key: 'held', title: 'Vouchers not in any file yet', done: held.notInAnyFile === 0, open: held.notInAnyFile, written: held.written,
      words: held.notInAnyFile ? [`${held.words}.`,
        held.modules.length ? `${held.modules.map(m => `${m.module}: ${m.vouchers}`).join(', ')}. They are held because Payments files were chosen in Voucher files instead of the default, Manual Journals: each needs Zoho's import sample (Import Wizard, "Not in any file yet"). Choose Manual Journals there to write them into the journals file now.` : '',
        held.awaitingRouting ? `${held.awaitingRouting} journal ${held.awaitingRouting === 1 ? 'voucher waits' : 'vouchers wait'} for a decision in Voucher Classification.` : ''].filter(Boolean).join(' ') : 'Every voucher is in a file or left out with a reason.',
      modules: held.modules });
  }
  // What the Zoho check expects (the same numbers as the Zoho check screen): rows Zoho will refuse and may refuse.
  const zc = files.length && ctx.zohoCheck ? ctx.zohoCheck() : null;
  const zohoCheck = zc?.available ? { rowsWill: zc.overall.rowsWill, rowsMay: zc.overall.rowsMay, rows: zc.overall.rows, causesWill: zc.overall.causesWill, causesMay: zc.overall.causesMay, outOfDate: zc.outOfDate,
    // the contacts Zoho will refuse (registered without a GSTIN and the like), from the Customers and Vendors files
    contactsWill: zc.files.filter(f => f.key === 'customers' || f.key === 'vendors').reduce((t, f) => t + (f.rowsWill || 0), 0),
    // what to do by hand in Zoho Books before an import (the Zoho check's own list, shown as "Do this first in Zoho Books")
    preSteps: zc.preSteps || [] } : null;
  // When the Zoho check expects contacts to be refused, the contact details are not "nothing blocks": say so with the
  // check's own count, and the decisions step is not done.
  const dStep = steps.find(s => s.key === 'decisions');
  const contactItem = dStep?.items?.find(i => i.key === 'contact_fixes');
  if (contactItem && zohoCheck?.contactsWill > 0) {
    contactItem.blocksImport = true;
    contactItem.zohoWill = zohoCheck.contactsWill;
    contactItem.words = `${contactItem.words} The Zoho check expects Zoho to refuse ${zohoCheck.contactsWill} contact row${zohoCheck.contactsWill === 1 ? '' : 's'}, and the documents of those contacts with them.`;
    dStep.blockingOpen = dStep.items.filter(d => d.blocksImport).reduce((t, d) => t + d.open, 0);
    dStep.done = processed && dStep.blockingOpen === 0;
  }
  return {
    job: { id: job.id, company: job.company, financialYear: job.financial_year, status: job.status },
    canChange, steps, current: steps.find(s => !s.done)?.key ?? null,
    held: held?.available ? { written: held.written, notInAnyFile: held.notInAnyFile, words: held.words, modules: held.modules } : null,
    zohoCheck,
  };
}
