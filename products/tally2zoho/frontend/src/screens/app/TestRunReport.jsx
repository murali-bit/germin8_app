import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileDown, ListChecks } from 'lucide-react';
import { api, downloadFile, formatAmount, formatDuration } from '../../api';
import { readableWhen } from '../../components/OutOfDateBanner';
import { Note, StatusChip, btnPrimary, friendlyError } from '../../components/ui';

// Plain names for the kinds of flagged items.
const KIND = {
  no_name: 'Record has no name', duplicate: 'Duplicate record', date_unreadable: 'Date cannot be read', unbalanced: 'Debits and credits differ',
  amount_unreadable: 'Amount cannot be read', no_lines: 'Voucher has no ledger lines',
  ledger_missing: 'Ledger not in the master files', ledger_blank: 'Voucher line without a ledger', items_not_uploaded: 'Stock items file not uploaded',
  item_missing: 'Stock item not in the master file', unit_missing: 'Unit not in the Units file', trial_balance_ledger_missing: 'Trial balance ledger not in the master files',
  party_missing: 'Customer or vendor not in the master file', party_blank: 'Voucher without a customer or vendor',
  journal_unrouted: 'Journal voucher not routed', left_out: 'Left out of the files', tax_unmapped: 'Tax ledger not mapped',
  account_type_missing: 'Account type not decided', balance_unusual_side: 'Customer in credit or vendor in debit (carried by the opening balance journal)', balance_unusual_side_not_carried: 'Customer in credit or vendor in debit in another currency (in no file)',
  opening_date_anchor: 'One opening balance kept in the Chart of Accounts (for the Migration Date)', opening_date_balance_to_type: 'One opening balance to type (for the Migration Date)', bank_ledger_as_credit_card: 'Credit card kept under Bank Accounts', bank_ledger_credit_balance: 'Bank ledger with a credit opening balance', profit_and_loss_balance_in_journal: 'Profit & Loss A/c balance entered on Retained Earnings', opening_balances_unbalanced: 'Opening balances do not balance',
  item_no_unit: 'Item without a unit', party_not_in_master: 'Party not in the master file', tax_pair_incomplete: 'Tax ledger used with a mapped one, but not mapped',
  tax_not_in_list: 'Tax mapped to a name not in your Zoho tax list', other: 'Other',
  voucher_cancelled: 'Cancelled voucher (kept, never written to a file)', voucher_optional: 'Optional voucher (kept, never written to a file)', voucher_deleted: 'Deleted voucher (kept, never written to a file)',
  voucher_lines_in_both_lists: 'Voucher with lines in both line lists', ledger_name_hidden_characters: 'Ledger name differs from the master only by hidden characters',
  voucher_type_not_resolved: 'Voucher type could not be traced to a Tally voucher type', voucher_type_no_dataset: 'Voucher type with no dataset',
  trial_balance_movement_differs: 'Trial Balance debits or credits differ from the vouchers', trial_balance_closing_differs: 'Trial Balance line does not add up',
  trial_balance_totals: 'Trial Balance does not balance', trial_balance_not_ledger_level: 'Trial Balance does not list every ledger',
  trial_balance_line_unmatched: 'Trial Balance line not in the master files', trial_balance_name_hidden_characters: 'Trial Balance name differs from the master only by hidden characters',
  opening_balances_not_created: 'Opening Balances reference report not created',
  tax_ledger_in_accounts: 'Duties & Taxes ledger written as an account', party_ledger_not_in_contacts: 'Customer or vendor ledger in no file',
  gst_treatment_not_set: 'GST treatment not set in Tally', gst_unregistered_with_gstin: 'Unregistered party with a GSTIN', gst_treatment_not_mapped: 'GST registration type with no Zoho GST treatment',
  place_of_contact_missing: 'No state for the place of contact', state_not_mapped: 'State with no Zoho state code', place_differs_from_gstin: 'Place of supply differs from the GSTIN state',
  payment_terms_not_read: 'Credit period not read', currency_not_rupee: 'Ledger not in rupees', opening_balance_unreadable: 'Opening balance cannot be read',
  product_type_not_mapped: 'Item type of supply not goods or services', item_rate_not_read: 'Item rate cannot be read', item_opening_stock_not_written: 'Opening stock not written (no inventory tracking)',
  item_rate_missing: 'Items without a selling rate (rows expected to be rejected)', item_tax_preference_not_set: 'Item tax preference left empty',
  display_name_hidden_characters: 'Display Name with hidden characters, written as in Tally (warning)', display_name_collides_after_cleaning: 'Display Names the same once cleaned (warning)',
  account_name_hidden_characters: 'Account Name with hidden characters, written as in Tally (warning)', account_name_collides_after_cleaning: 'Account Names the same once cleaned (warning)',
  display_name_duplicate: 'Display Names written the same (blocks the import)', account_name_duplicate: 'Account Names written the same (blocks the import)',
  items_written_as_services: 'Items written as service (business type: services)',
  zoho_builtin_account_name: 'Name of a Zoho built-in account', account_without_group: 'Ledger with no Tally group (no account type)',
  profit_and_loss_ledger_left_out: 'Profit & Loss A/c left out (Zoho uses Retained Earnings)', profit_and_loss_balance_not_written: 'Profit & Loss A/c balance to enter on Retained Earnings',
  left_out_cancelled: 'Left out: cancelled voucher', left_out_optional: 'Left out: optional voucher', left_out_deleted: 'Left out: deleted voucher',
  tax_not_attributable: 'Tax could not be put on its lines (left empty)', tax_rate_unknown: 'GST rate of the line not known (tax left empty)',
  tax_amount_differs: 'Tax differs from the rate by more than rounding', line_tax_names_differ: 'Tax ledgers of one line mapped to different Zoho taxes',
  document_total_differs: 'Invoice or bill total does not tie to Tally', tax_name_rate_mixed: 'One Zoho tax written with several rates',
  tds_not_mapped: 'TDS ledger with no Zoho TDS tax (bills expected to be rejected)', tds_amount_differs: 'TDS differs from the mapped rate',
  tds_several_on_bill: 'Bill with more than one TDS ledger', tds_on_other_side: 'TDS ledger on the other side of a bill',
  place_of_supply_missing: 'Place, source or destination of supply missing',
  place_of_supply_missing_taxed: 'State missing on a document with GST (blocks the import)', tax_type_state_mismatch: 'IGST or CGST + SGST does not fit the two states',
  reverse_charge_bill: 'Bill with GST under reverse charge (GST not written)', non_gst_duty_on_document: 'Duties & Taxes ledger that is neither GST nor TDS',
  line_without_item_name: 'Lines without an Item Name (not confirmed in Zoho)', document_number_too_long: 'Invoice number longer than Zoho allows',
  item_line_rate_differs: 'Stock item quantity and rate do not give the line amount', journal_number_not_usable: 'Journal number cannot be built from the Tally number',
  voucher_layout_outdated: 'Saved voucher layout made for an earlier version (reset it)', negative_row: 'Invoice or bill with a negative line',
  tax_ledger_party_side: 'Tax ledger on the party side (not Zoho TDS)',
  vouchers_waiting_for_zoho_sample: 'Vouchers waiting for a Zoho import sample (no file built)', vouchers_written_as_journals: 'Receipts, payments, contra or notes written as Manual Journals',
  money_voucher_unclear: 'Receipt, payment or note with no clear pattern (written as a Manual Journal)', note_written_as_journal: 'Debit or credit note to the other kind of party (Manual Journal)',
  allocation_bill_not_in_migration: 'Payment set against an invoice or bill from before the period', allocation_document_not_written: 'Payment set against a document not written as an invoice or bill',
  allocation_exceeds_document: 'Payment set against more than is left of the invoice or bill', allocation_sign_unclear: 'Bill-wise allocation on the unexpected side',
  money_voucher_other_lines: 'Payment or note with other lines (bank charges, tax deducted)',
};
export const kindLabel = k => KIND[k] || String(k || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const IMPORT = { generated: 'Created, not downloaded', downloaded: 'Downloaded', imported: 'Imported', partial: 'Partly imported', failed: 'Failed' };
const STATUS = { awaiting_uploads: 'Waiting for uploads', processing: 'Reading your files', processed: 'Data read', generated: 'Files created' };
const RUN = { done: 'Finished', failed: 'Stopped with an error', running: 'Running', queued: 'Waiting to start', idle: 'Not run' };
const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const money = v => (v == null || v === '' ? '' : `${Number(v) < 0 ? '-' : ''}${formatAmount(v)}`);

function Block({ title, children, note }) {
  return (
    <div className="rounded-lg border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line"><h4 className="text-[15px] font-semibold text-ink">{title}</h4></div>
      <div className="px-4 py-3 text-[14px] text-ink">{children}</div>
      {note && <div className="px-4 py-2.5 border-t border-line text-[13px] text-muted">{note}</div>}
    </div>
  );
}

const Muted = ({ children }) => <span className="text-muted">{children}</span>;

// The problems of one dataset, in a few words each.
function datasetProblems(d) {
  const out = [];
  // an optional dataset with no file is not a problem: it never blocks
  if (d.status === 'missing' && d.requirement !== 'optional') out.push(d.requirement === 'required' ? 'Not uploaded (required)' : 'Not uploaded and not marked as not applicable');
  if (d.countMatches === false) out.push(`Tally shows ${Number(d.expectedCount).toLocaleString('en-IN')}, the file has ${Number(d.actualCount).toLocaleString('en-IN')}`);
  if (d.mayNotBeReadable) out.push('The file may not be readable: every field the platform needs is missing');
  const missing = (d.keyFieldFindings || []).filter(f => f.severity === 'warning');
  if (missing.length && !d.mayNotBeReadable) out.push(`Missing from every record: ${missing.map(f => f.field).join(', ')}`);
  const kfMessages = new Set((d.keyFieldFindings || []).map(f => f.message));
  // the description of a Tally Trial Balance report is a problem only when the report does not list every ledger
  const tb = d.trialBalanceReport;
  const other = (d.warnings || []).filter(w => !kfMessages.has(w) && !/may not be readable/i.test(w) && !(tb && w === tb.description && (tb.atLedgerLevel || !tb.mastersAvailable)));
  for (const w of other) out.push(w);
  return out;
}

export default function TestRunReport({ job }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    api.get(`/migrations/${job.id}/test-report`)
      .then(r => { if (!cancelled) { setReport(r); setError(''); } })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [job]);

  const download = async () => {
    setDownloading(true); setDownloadError('');
    try { await downloadFile(`/api/migrations/${job.id}/test-report?download=1`, `test-report-${job.id}.json`); }
    catch (e) { setDownloadError(e.message); }
    finally { setDownloading(false); }
  };

  const r = report;
  const fix = r?.whatToFixNext || [];
  const blocking = fix.filter(f => f.blocking).length;
  const problemSets = (r?.datasets || []).map(d => ({ d, problems: datasetProblems(d) })).filter(x => x.problems.length);
  const p = r?.processing;
  const dec = r?.decisions;

  return (
    <section aria-labelledby="test-report" className="rounded-lg border border-line bg-white shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-10 h-10 rounded-md bg-brand-soft flex items-center justify-center shrink-0">
            <ListChecks className="w-5 h-5 text-info-ink" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="test-report" className="text-[17px] font-semibold tracking-tight text-ink">Test run report</h2>
            <p className="text-[14px] text-muted mt-0.5">Everything needed to review a test round, in one place: what to fix next first, then a short summary of each step. It restates recorded facts only.</p>
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
          <button type="button" onClick={download} disabled={downloading || !job} className={btnPrimary}>
            <FileDown className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {downloading ? 'Downloading…' : 'Download test report'}
          </button>
          {downloadError && <span role="alert" className="text-[13px] text-danger-ink max-w-xs">{friendlyError(downloadError)}</span>}
        </div>
      </div>

      {error && <div role="alert" className="p-4"><Note tone="danger" title="The test run report could not be loaded.">{friendlyError(error)}</Note></div>}
      {!error && !r && <p role="status" className="p-4 text-[14px] text-muted">Loading the test run report…</p>}

      {r && (
        <div className="p-4 sm:p-5 space-y-5">
          {/* What to fix next */}
          <div>
            <h3 className="text-[16px] font-semibold text-ink">What to fix next{fix.length > 0 ? ` (${plural(fix.length, 'thing')} to fix before the import)` : ''}</h3>
            <p className="text-[14px] text-muted mt-0.5">
              {fix.length === 0 ? 'Nothing to fix was found.' : `In the order of the steps. This is a short list of causes, not the flagged items${blocking ? `. ${plural(blocking, 'item')} ${blocking === 1 ? 'blocks' : 'block'} the next step` : ''}.`}
            </p>
            {fix.length > 0 && (
              <ol className="mt-3 rounded-md border border-line divide-y divide-line">
                {fix.map(f => (
                  <li key={f.order} className={`px-4 py-3 flex items-start gap-3 text-[14px] ${f.blocking ? 'bg-soft' : ''}`}>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0 ${f.blocking ? 'bg-danger-ink text-white' : 'bg-soft-2 text-ink'}`}>{f.order}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip>{f.stage}</StatusChip>
                        {f.blocking && (
                          <StatusChip tone="danger" dot>Blocks the next step</StatusChip>
                        )}
                      </div>
                      <p className="mt-1 text-ink break-words">{f.message}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Datasets */}
            <Block title="Datasets with problems" note={`${plural(r.datasets.filter(d => d.status === 'uploaded').length, 'dataset')} uploaded, ${r.datasets.filter(d => d.status === 'not_applicable').length} marked not applicable, of ${r.datasets.length}.`}>
              {problemSets.length === 0 ? <Muted>No dataset has a problem on record.</Muted> : (
                <ul className="space-y-2">
                  {problemSets.map(({ d, problems }) => (
                    <li key={d.key}>
                      <div className="font-medium">{d.name}{d.fileName && <span className="font-normal text-muted"> · {d.fileName}</span>}</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {problems.map((t, i) => <li key={i} className="text-muted break-words">{t}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {/* Processing */}
            <Block
              title="Processing"
              note={p.storedFromEarlierFiles ? 'A file was uploaded or removed after the data was last read, so what is stored and flagged is from the earlier files.' : null}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt className="text-[13px] text-muted">Status</dt><dd>{STATUS[p.status] || p.status}</dd></div>
                <div><dt className="text-[13px] text-muted">Records stored</dt><dd className="tabular-nums">{Number(p.totalRecordsStored).toLocaleString('en-IN')}</dd></div>
                <div>
                  <dt className="text-[13px] text-muted">Last run</dt>
                  <dd>
                    {p.lastRun ? RUN[p.lastRun.state] || p.lastRun.state : 'No run on record'}
                    {p.lastRun?.secondsTaken != null && <Muted>, took {formatDuration(p.lastRun.secondsTaken)}</Muted>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted">Started by</dt>
                  <dd className="break-all">{p.lastRun?.startedBy || '—'}{readableWhen(p.lastRun?.startedAt) && <span className="block text-[13px] text-muted">{readableWhen(p.lastRun.startedAt)}</span>}</dd>
                </div>
              </dl>
              {p.lastRun?.state === 'failed' && p.lastRun.error && <p className="mt-2 text-ink break-words"><strong>Error:</strong> {p.lastRun.error}</p>}
              {p.vouchers?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="font-medium">Vouchers stored, by dataset</div>
                  <ul className="mt-1.5 space-y-1">
                    {p.vouchers.map(v => {
                      const notPosted = v.cancelled + v.optional + v.deleted;
                      return (
                        <li key={v.slot} className="flex flex-wrap justify-between gap-x-3">
                          <span>{v.name}</span>
                          <span className="text-muted text-right">
                            <span className="tabular-nums text-ink">{Number(v.vouchers).toLocaleString('en-IN')}</span>
                            {notPosted > 0 && `, of which ${[v.cancelled && `${v.cancelled} cancelled`, v.optional && `${v.optional} optional`, v.deleted && `${v.deleted} deleted`].filter(Boolean).join(', ')}`}
                            {String(v.zohoFile || '').startsWith('Read and kept') && <span className="block text-[13px]">Read and kept; no Zoho file is created for these yet.</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {p.ledgerNamesOnVouchers && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="font-medium">Ledger names on vouchers, compared with the masters</div>
                  <p className="text-muted">
                    {plural(p.ledgerNamesOnVouchers.names, 'different name')}: {Number(p.ledgerNamesOnVouchers.exact).toLocaleString('en-IN')} found exactly,
                    {' '}{Number(p.ledgerNamesOnVouchers.ignoringHidden).toLocaleString('en-IN')} found only after ignoring hidden characters such as a line break,
                    {' '}{Number(p.ledgerNamesOnVouchers.notFound).toLocaleString('en-IN')} not found.
                  </p>
                </div>
              )}
              {p.trialBalance && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="font-medium">Trial Balance report</div>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    <li>{plural(p.trialBalance.lines, 'line')} read: {Number(p.trialBalance.ledgers).toLocaleString('en-IN')} ledgers, {Number(p.trialBalance.groups).toLocaleString('en-IN')} groups, {Number(p.trialBalance.unmatched).toLocaleString('en-IN')} not matched.</li>
                    <li className={p.trialBalance.atLedgerLevel ? '' : 'text-ink font-medium'}>{p.trialBalance.atLedgerLevel ? 'Every ledger is listed.' : 'Not every ledger is listed, so no Opening Balances file is created. A detailed Trial Balance (Alt+F5 in Tally) is needed.'}</li>
                    <li className={p.trialBalance.totals.openingBalanced && p.trialBalance.totals.closingBalanced ? '' : 'text-ink font-medium'}>
                      Opening balances {p.trialBalance.totals.openingBalanced ? 'balance' : 'do not balance'}; closing balances {p.trialBalance.totals.closingBalanced ? 'balance' : 'do not balance'}.
                    </li>
                    {p.trialBalance.movement && (
                      <li className={p.trialBalance.movement.differ ? 'text-ink font-medium' : ''}>
                        Debits and credits compared with the vouchers: {Number(p.trialBalance.movement.agree).toLocaleString('en-IN')} of {Number(p.trialBalance.movement.checked).toLocaleString('en-IN')} lines agree{p.trialBalance.movement.differ ? `, ${Number(p.trialBalance.movement.differ).toLocaleString('en-IN')} differ` : ''}.
                      </li>
                    )}
                  </ul>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-line">
                <div className="font-medium">Flagged items: {Number(p.flaggedItems.total).toLocaleString('en-IN')}{p.flaggedItems.warnings > 0 && <Muted> ({Number(p.flaggedItems.warnings).toLocaleString('en-IN')} warnings, not blocking)</Muted>}</div>
                {p.flaggedItems.groups.length === 0 ? <Muted>Nothing flagged.</Muted> : (
                  <ul className="mt-1.5 space-y-2">
                    {p.flaggedItems.groups.map(g => (
                      <li key={`${g.stage}-${g.kind}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span>{kindLabel(g.kind)} <Muted>· {g.stageName}</Muted></span>
                          <span className="tabular-nums font-medium">{Number(g.count).toLocaleString('en-IN')}</span>
                        </div>
                        <ul className="mt-0.5 space-y-0.5 text-[13px] text-muted">
                          {g.examples.map((e, i) => <li key={i} className="break-words">For example: {e.name ? `${e.name}${e.dataset ? ` (${e.dataset})` : ''}: ` : ''}{e.message}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Block>

            {/* Decisions */}
            <Block title="Decisions">
              <ul className="space-y-1.5">
                <li>
                  <span className="font-medium">Account types:</span> <Muted>{plural(dec.accountTypes.groupsWithLedgers, 'group')} with ledgers; {dec.accountTypes.standard} standard, {dec.accountTypes.inherited} taken from the group above, {dec.accountTypes.decided} decided by you, </Muted>
                  <span className={dec.accountTypes.needingDecision ? 'font-semibold' : ''}>{dec.accountTypes.needingDecision} still to decide</span>
                  {dec.accountTypes.groupsNeedingDecision.length > 0 && <Muted> ({dec.accountTypes.groupsNeedingDecision.map(g => g.group).join(', ')})</Muted>}
                </li>
                <li>
                  <span className="font-medium">Tax mapping:</span> <Muted>{dec.taxMappings.mapped} of {plural(dec.taxMappings.taxLedgers, 'tax ledger')} mapped. </Muted>
                  {dec.taxMappings.zohoTaxListExists ? <Muted>Zoho tax list saved ({plural(dec.taxMappings.zohoTaxListCount, 'name')}). </Muted> : <Muted>No Zoho tax list saved, so mappings are not checked. </Muted>}
                  {dec.taxMappings.notInList > 0 && <span className="font-semibold">{dec.taxMappings.notInList} not in your Zoho tax list.</span>}
                  {dec.taxMappings.unmappedLedgers.length > 0 && <div className="text-[13px] text-muted">Not mapped: {dec.taxMappings.unmappedLedgers.map(t => `${t.ledger} (${plural(t.vouchers, 'voucher')})`).join(', ')}</div>}
                </li>
                <li>
                  <span className="font-medium">Units:</span> <Muted>{plural(dec.unitMappings.units, 'unit')}; {dec.unitMappings.mapped} changed by you, {dec.unitMappings.writtenAsInTally} written as in Tally.</Muted>
                  {dec.unitMappings.missingFromUnitsFile > 0 && <span className="font-semibold"> {dec.unitMappings.missingFromUnitsFile} not in the Units file.</span>}
                </li>
                <li>
                  <span className="font-medium">Journal vouchers:</span> <Muted>{dec.journalRouting.decided} of {dec.journalRouting.total} routed, {dec.journalRouting.overridden} differ from the suggestion, </Muted>
                  <span className={dec.journalRouting.undecided ? 'font-semibold' : ''}>{dec.journalRouting.undecided} not routed</span>
                </li>
              </ul>
            </Block>

            {/* Files and import status */}
            <Block title="Files and import status">
              {r.files.length === 0 ? <Muted>No files have been created yet.</Muted> : (
                <ul className="divide-y divide-line -my-1">
                  {r.files.map(f => {
                    const imp = r.importStatus.find(i => i.key === f.key);
                    return (
                      <li key={f.key} className="py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">{f.module} <Muted>· {plural(f.rows, 'row')}</Muted></span>
                          {imp ? <StatusChip tone={{ imported: 'success', downloaded: 'info', partial: 'warning', failed: 'danger' }[imp.status] || 'neutral'} dot>{IMPORT[imp.status] || imp.status}</StatusChip> : null}
                        </div>
                        <div className="text-[13px] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
                          {f.outOfDate
                            ? <span className="inline-flex items-center gap-1 font-semibold text-ink"><AlertTriangle className="w-3.5 h-3.5 text-warning-ink" aria-hidden="true" /> Out of date</span>
                            : <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-success-ink" aria-hidden="true" /> Up to date</span>}
                          <span>{f.templateMarkedAsMatchingZohoSample ? 'Layout confirmed by an admin against the Zoho sample file' : 'Layout not confirmed against the Zoho sample file'}</span>
                          {f.layoutIsCurrent === false && <span>Built with an earlier layout</span>}
                          {imp?.note && <span>Note: {imp.note}</span>}
                          {imp && !imp.ready && imp.waitingFor?.length > 0 && <span>Import first: {imp.waitingFor.join(', ')}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Block>

            {/* Rejections */}
            <Block title="Rejections from Zoho Books">
              {r.rejections.length === 0 ? <Muted>No rejections recorded.</Muted> : (
                <ul className="space-y-2">
                  {r.rejections.map(x => (
                    <li key={x.key}>
                      <div className="font-medium">{x.module}: {plural(x.total, 'rejection')}</div>
                      <div className="text-[13px] text-muted">{x.open} still to correct, {x.corrected} corrected, {x.retried} sent again{x.unlinked ? `, ${x.unlinked} not linked to a Tally record` : ''}</div>
                      <div className="text-[13px] text-muted">{x.categories.map(c => `${c.category} (${c.count})`).join(', ')}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {/* Reconciliation */}
            <Block title="Reconciliation with Zoho Books">
              {r.reconciliation.length === 0 ? <Muted>Nothing to compare yet.</Muted> : (
                <ul className="divide-y divide-line -my-1">
                  {r.reconciliation.map(v => (
                    <li key={v.key} className="py-2">
                      <div className="font-medium">{v.module}</div>
                      {!v.checked ? <div className="text-[13px] text-muted">No Zoho report uploaded yet ({plural(v.expected, 'record')} expected)</div> : (
                        <div className="text-[13px] text-muted">
                          {v.matched} of {v.expected} matched, {v.missing} missing, {v.extra} extra
                          {v.amountColumn ? `; ${v.amountsDiffering} of ${v.amountsCompared} amounts differ; expected ${money(v.totalExpectedCompared)}, in Zoho ${money(v.totalInZoho)}` : '; amounts not compared'}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>

          {r.notes?.length > 0 && (
            <div className="rounded-md bg-soft-2 p-4 text-[13px] text-muted">
              <div className="font-semibold text-ink mb-1">Please note</div>
              <ul className="list-disc pl-5 space-y-0.5">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
