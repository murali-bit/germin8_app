import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Info } from 'lucide-react';
import { api, useJob } from '../../api';
import { Card, EmptyState, Note, PageHeader, StatusChip, btnPrimary, btnSecondary, btnSmall, friendlyError } from '../../components/ui';
import { ALL_MASTERS_STEPS, ALL_TRANSACTIONS_STEPS, COMMON_STEPS, TRIAL_BALANCE_STEPS, UPLOAD_HELP } from './uploadHelp';

const CATEGORY_ORDER = ['Masters', 'Vouchers', 'Inventory', 'Balances'];
const CATEGORY_HINT = {
  Masters: 'The lists the vouchers depend on: customers, vendors, accounts, items, units and taxes.',
  Vouchers: 'The transactions for the financial year. One Transactions export fills all of these; each can also be uploaded on its own.',
  Inventory: 'Stock quantities and values. Only for companies that keep inventory.',
  Balances: 'The Trial Balance report: opening balance, debits, credits and closing balance of every ledger. Used for checks and for the Opening Balances file.',
};
const STATUS = {
  uploaded: { label: 'Uploaded' },
  missing: { label: 'Not uploaded yet' },
  not_applicable: { label: 'Not applicable' },
};
// Datasets that are read and checked but have no Zoho file of their own (see README). Receipts, payments, contra and
// notes DO reach Zoho Books: they are Manual Journals in the journals file of receipts, payments and contra.
const NO_FILE_OF_ITS_OWN = ['other_vouchers', 'taxes', 'units', 'stock_summary'];
const KEPT_ONLY = ['other_vouchers'];
const AS_JOURNALS = ['receipt', 'payment', 'contra', 'debit_note', 'credit_note'];
const NEEDED = { required: 'Required', conditional: 'If applicable', optional: 'Optional' };

const focusRing = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

function Detail({ label, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-x-4 gap-y-0.5">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="text-[14px] text-ink min-w-0">{children}</dd>
    </div>
  );
}

function DatasetRow({ d, status, open, onToggle }) {
  const help = UPLOAD_HELP[d.key] || {};
  const required = d.requirement === 'required';
  const st = STATUS[status];
  const panelId = `export-guide-panel-${d.key}`;
  const buttonId = `export-guide-button-${d.key}`;
  return (
    <li>
      <h3>
        <button
          type="button" id={buttonId} aria-expanded={open} aria-controls={panelId} onClick={onToggle}
          className={`w-full text-left px-4 py-3 flex items-start sm:items-center gap-3 hover:bg-soft ${focusRing}`}
        >
          <ChevronDown className={`w-5 h-5 shrink-0 mt-0.5 sm:mt-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1">
            <span className="sm:w-60 shrink-0 flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{d.name}</span>
              <StatusChip tone={required ? 'info' : 'neutral'}>{NEEDED[d.requirement] || 'If applicable'}</StatusChip>
            </span>
            <span className="min-w-0 flex-1 text-[14px] text-muted">{d.report}</span>
            {st && (
              <span className="shrink-0">
                <StatusChip tone={status === 'uploaded' ? 'success' : status === 'missing' ? 'warning' : 'neutral'} dot>{st.label}</StatusChip>
              </span>
            )}
          </span>
        </button>
      </h3>
      {open && (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="px-4 pb-5 pt-1 sm:pl-12">
          <dl className="space-y-3">
            <Detail label="Tally report to export">{d.report}</Detail>
            <Detail label="What goes in the file">{help.contains || d.desc}</Detail>
            {help.checks?.length > 0 && (
              <Detail label="What the platform checks">
                <ul className="list-disc pl-5 space-y-1">
                  {help.checks.map(c => <li key={c}>{c}</li>)}
                </ul>
              </Detail>
            )}
            {help.tip && <Detail label="Tip">{help.tip}</Detail>}
            <Detail label="Where it goes in Zoho Books">
              {d.zoho}
              {AS_JOURNALS.includes(d.key) && (
                <span className="block text-[13px] text-muted mt-0.5">
                  Written as Manual Journals in the journals file of receipts, payments and contra, with the customer or vendor named, so the balances match Tally.
                </span>
              )}
              {NO_FILE_OF_ITS_OWN.includes(d.key) && (
                <span className="block text-[13px] text-muted mt-0.5">
                  {KEPT_ONLY.includes(d.key)
                    ? 'Read and kept; no Zoho file is created for these yet. The vouchers are counted, checked and shown in the Data Explorer.'
                    : 'No separate Zoho file is created from this dataset yet. It is read and used for checks.'}
                </span>
              )}
            </Detail>
            {d.requirement === 'conditional' && (
              <Detail label="If you do not have it">Mark this dataset "Not applicable" in Completeness Check and give a reason.</Detail>
            )}
            {d.requirement === 'optional' && (
              <Detail label="If you do not have it">Nothing to do. This dataset is optional and never blocks processing. The "All transactions in one file" export fills it for you.</Detail>
            )}
            {d.category === 'Vouchers' && required && (
              <Detail label="If you do not have it">Upload "All transactions in one file". When that file has no vouchers of this type, the dataset is marked not applicable for you, with the reason.</Detail>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

export default function Screen13_TallyExportGuide({ onNavigate }) {
  const { job, loading: jobLoading, error: jobError } = useJob();
  const [catalogue, setCatalogue] = useState(null);
  const [catError, setCatError] = useState('');
  const [open, setOpen] = useState({});

  const loadCatalogue = useCallback(() => {
    setCatError('');
    api.get('/catalogue').then(list => setCatalogue(Array.isArray(list) ? list : [])).catch(e => setCatError(e.message));
  }, []);
  useEffect(() => { loadCatalogue(); }, [loadCatalogue]);

  const slots = job?.completeness?.slots;
  // The selected migration already carries the same list, so the guide still shows if only the catalogue request fails.
  const datasets = catalogue?.length ? catalogue : slots || catalogue;
  const status = Object.fromEntries((slots || []).map(s => [s.key, s.status]));
  const uploaded = (slots || []).filter(s => s.status === 'uploaded').length;
  const notApplicable = (slots || []).filter(s => s.status === 'not_applicable').length;

  const categories = datasets
    ? [...CATEGORY_ORDER, ...new Set(datasets.map(d => d.category).filter(c => !CATEGORY_ORDER.includes(c)))]
      .map(name => ({ name, items: datasets.filter(d => d.category === name) }))
      .filter(c => c.items.length)
    : [];
  const allOpen = !!datasets?.length && datasets.every(d => open[d.key]);
  const toggleAll = () => setOpen(allOpen ? {} : Object.fromEntries(datasets.map(d => [d.key, true])));

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Tally Export Guide"
        breadcrumb={[{ label: 'Dashboard', onClick: () => onNavigate('screen-11') }, { label: 'Tally Export Guide' }]}
        help="What to export from TallyPrime, and how, one dataset at a time."
        actions={(
          <button type="button" onClick={() => onNavigate('screen-15')} className={btnPrimary}>
            <span>Go to Upload Center</span><ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      >
        {job && (
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line bg-white px-3 py-1 text-[13px] text-muted">
            <span className="font-semibold text-ink">{job.company}</span>
            <span aria-hidden="true">·</span>
            <span>Financial year {job.financial_year}</span>
            {slots && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-ink">{uploaded} of {slots.length} uploaded{notApplicable > 0 ? `, ${notApplicable} not applicable` : ''}</span>
              </>
            )}
          </p>
        )}
      </PageHeader>

      {jobError && (
        <div role="alert">
          <Note tone="danger">The selected migration could not be loaded, so upload statuses are not shown. {friendlyError(jobError)}</Note>
        </div>
      )}

      <Card title="Masters: one file for all of them (confirmed on TallyPrime 7.1)" subtitle="The quickest way to export customers, vendors, accounts, taxes and stock items.">
        <div className="p-4 text-[14px] text-ink space-y-3">
          <ol className="space-y-2 list-decimal pl-5">
            {ALL_MASTERS_STEPS.slice(0, -1).map(s => <li key={s}>{s}</li>)}
            <li>Export, then upload the file into "All masters in one file" at the top of the Upload Center.</li>
          </ol>
          <p className="text-muted">
            Tally saves this file in UTF-16, a text format that some programs show as strange characters. That is fine: upload it as it is, without opening or re-saving it.
          </p>
          <p className="text-muted">
            The platform sorts the file for you: ledgers under Sundry Debtors become customers, ledgers under Sundry Creditors become vendors, and ledgers
            under Duties &amp; Taxes become tax ledgers, also when they sit in your own sub-groups. Every ledger and group also goes to the Chart of Accounts.
            Stock items and units go to their own datasets. Other lists in the file, such as currencies, voucher types and godowns, are kept for reference and not used.
          </p>
          <p className="text-muted">
            The Upload Center then shows how many records went to each dataset, for example how many customers and vendors, so you can compare them with Tally.
            You can still export any master list on its own and upload it into its own slot; the file you upload last wins for that dataset.
          </p>
        </div>
      </Card>

      <Card title="Vouchers: one file for all of them (confirmed on TallyPrime 7.1)" subtitle="One export holds every voucher of the year, whatever its type.">
        <div className="p-4 text-[14px] text-ink space-y-3">
          <ol className="space-y-2 list-decimal pl-5">
            {ALL_TRANSACTIONS_STEPS.slice(0, -1).map(s => <li key={s}>{s}</li>)}
            <li>Export, then upload the file into "All transactions in one file" at the top of the Upload Center.</li>
          </ol>
          <div role="note" className="rounded-md border border-warning-line bg-warning-soft p-3">
            <strong>Check the period before you export.</strong> Tally offers only the last month by default. Change it to the whole financial year, from its first day to its last
            {job ? <> (for the selected migration: <strong>{job.financial_year}</strong>)</> : ''}.
            A file that covers only one month is accepted, but most of the year's vouchers would be missing, and the Trial Balance check would show differences.
          </div>
          <p className="text-muted">
            The platform sorts the vouchers by voucher type into Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Notes and Credit Notes. A voucher type of
            your own, for example "Sales - Export", is followed up to the Tally voucher type it was created under, using the voucher type list in your All Masters file.
            A voucher type that cannot be traced is not guessed: its vouchers are kept under Other Voucher Types and flagged.
          </p>
          <p className="text-muted">
            A voucher type with no vouchers in the file, for example Purchase when purchases are entered as journals, is marked not applicable for you with the reason.
            Cancelled, optional and deleted vouchers are kept and counted, but never written to a Zoho file. Receipt, Payment and Contra vouchers, Debit Notes and
            Credit Notes are written as Manual Journals (the journals file of receipts, payments and contra), with the customer or vendor named.
          </p>
        </div>
      </Card>

      <Card title="Trial Balance (confirmed on TallyPrime 7.1)" subtitle="Export the detailed report, so that every ledger is listed.">
        <div className="p-4 text-[14px] text-ink space-y-3">
          <ol className="space-y-2 list-decimal pl-5">
            {TRIAL_BALANCE_STEPS.slice(0, -1).map(s => <li key={s}>{s}</li>)}
            <li>Export, then upload the file into the Trial Balance slot in the Upload Center.</li>
          </ol>
          <div role="note" className="rounded-md border border-warning-line bg-warning-soft p-3">
            <strong>Press Alt+F5 before you export.</strong> Without the detailed view the report lists groups, not ledgers. Such a report can still be checked
            against your vouchers, but an opening balance can only be entered per ledger, so no Opening Balances file is created from it.
          </div>
          <p className="text-muted">
            The platform matches every line to a ledger or a group in your masters, checks that opening debits equal opening credits and closing debits equal
            closing credits, and compares the debits and credits of each line with the vouchers you uploaded. Differences are flagged with the figures.
            The Opening Balances file is taken from the Opening Balance column.
          </p>
        </div>
      </Card>

      <Note>
        <strong>Stock Summary: not yet confirmed on a real Tally installation.</strong> The steps below for the Stock Summary, and for exporting one voucher
        type at a time from the Day Book, are general guidance. Menu names can differ between Tally versions, so follow the export option your own version shows.
      </Note>

      <Card title="Before you start">
        <ul className="p-4 text-[14px] text-ink space-y-2 list-disc pl-9">
          <li>
            Open the right company in TallyPrime.
            {job && <> For the selected migration that is <strong>{job.company}</strong>.</>}
          </li>
          <li>
            Use the same financial year as the migration for every report.
            {job && <> For the selected migration that is <strong>{job.financial_year}</strong>.</>}
          </li>
          <li>Export every report as JSON. Other formats are not accepted. Files saved by Tally in UTF-16 or UTF-8 are both fine.</li>
          <li>Masters come in one file, vouchers in one file, and the Trial Balance in its own file (see above). Give each file a name you will recognise when you upload it.</li>
          {!jobLoading && !job && !jobError && (
            <li className="text-muted">No migration is selected, so this guide shows what to export without your upload progress. Choose a migration on the Dashboard to see it.</li>
          )}
        </ul>
      </Card>

      <Card title="How to export a report on its own" subtitle="The same steps apply to every dataset below, if you do not use the one-file options for masters and vouchers.">
        <ol className="p-4 text-[14px] text-ink space-y-2 list-decimal pl-9">
          {/* The last shared step says "choose it here", which only makes sense on the Upload Center. */}
          {COMMON_STEPS.slice(0, -1).map(s => <li key={s}>{s}</li>)}
          <li>Save the file, then upload it into its slot in the Upload Center.</li>
        </ol>
      </Card>

      {!datasets && !catError && (
        <div role="status" className="px-4 py-6 rounded-lg border border-line bg-white text-[14px] text-muted">Loading the list of datasets…</div>
      )}

      {!datasets?.length && catError && (
        <div role="alert">
          <Note tone="danger">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span>The list of datasets could not be loaded. {friendlyError(catError)}</span>
              <button type="button" onClick={loadCatalogue} className={`${btnSecondary} ${btnSmall}`}>Try again</button>
            </div>
          </Note>
        </div>
      )}

      {datasets && datasets.length === 0 && !catError && (
        <div className="rounded-lg border border-line bg-white"><EmptyState icon={Info} title="No datasets are listed" text="The list of datasets is empty. Try again in a moment, or ask your admin." /></div>
      )}

      {categories.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-ink">What to export</h2>
              <p className="text-[14px] text-muted mt-0.5">
                {datasets.length} datasets. Select a dataset to see what goes in the file and what is checked.
                {slots && <> <span className="text-ink font-medium">{uploaded} of {slots.length} uploaded{notApplicable > 0 ? `, ${notApplicable} marked not applicable` : ''}.</span></>}
              </p>
            </div>
            <button type="button" onClick={toggleAll} aria-pressed={allOpen} className={`${btnSecondary} ${btnSmall} self-start sm:self-auto`}>{allOpen ? 'Close all' : 'Open all'}</button>
          </div>

          {categories.map(c => (
            <Card key={c.name} title={c.name} subtitle={CATEGORY_HINT[c.name]}>
              <ul className="divide-y divide-line">
                {c.items.map(d => (
                  <DatasetRow key={d.key} d={d} status={status[d.key]} open={!!open[d.key]} onToggle={() => setOpen(o => ({ ...o, [d.key]: !o[d.key] }))} />
                ))}
              </ul>
            </Card>
          ))}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border border-line bg-white shadow-xs">
            <p className="text-[14px] text-ink">
              When the files are ready, upload them in the Upload Center. The platform checks every file as it is uploaded.
            </p>
            <button type="button" onClick={() => onNavigate('screen-15')} className={`${btnPrimary} shrink-0`}>
              <span>Go to Upload Center</span><ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
