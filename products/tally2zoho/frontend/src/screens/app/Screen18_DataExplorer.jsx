import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, useJob, isProcessed, formatAmount, drCr, formatTallyDate } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Blocked, Card, StatusChip, Table, btnPrimary, inputClass } from '../../components/ui';

const list = v => (Array.isArray(v) ? v.filter(x => !(x && typeof x === 'object')) : v ? [v] : []);

// Every voucher line as { ledger, item, qty, amount } with Tally's sign (debit negative). The server reads the lines
// the way the platform does: from "allledgerentries" (accounting view) or "ledgerentries" (invoice view), and the item lines.
const voucherLines = r => r.view?.lines || [];
const voucherTotal = r => r.view?.total ?? 0;
const NOT_POSTED = { cancelled: 'Cancelled in Tally', optional: 'Optional in Tally (not posted)', deleted: 'Deleted in Tally' };

// The name and values as the platform reads them (the server's "view"): real TallyPrime exports keep the name in
// metadata.name and the address, state and GSTIN in dated lists, so they are not read from the raw record here.
const nameOf = r => r.view?.name ?? r.name ?? '';
const v = r => r.view || {};

// Plain-language columns for each kind of record.
const COLUMNS = {
  Ledger: [
    { key: 'name', label: 'Name', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'group', label: 'Tally group', render: r => v(r).parent || '' },
    { key: 'gstin', label: 'GSTIN', render: r => v(r).gstin || '' },
    { key: 'state', label: 'State', render: r => v(r).state || '' },
    { key: 'ob', label: 'Opening balance', align: 'right', render: r => drCr(v(r).openingBalance) },
  ],
  StockItem: [
    { key: 'name', label: 'Item', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'group', label: 'Group', render: r => v(r).parent || '' },
    { key: 'unit', label: 'Unit', render: r => v(r).unit || <span className="text-subtle">None</span> },
    { key: 'hsn', label: 'HSN code', render: r => v(r).hsn || (v(r).hsnSource ? <span className="text-subtle">{v(r).hsnSource}</span> : '') },
    { key: 'qty', label: 'Opening quantity', align: 'right', render: r => (v(r).openingQuantity || '').trim() },
    { key: 'val', label: 'Opening value', align: 'right', render: r => formatAmount(v(r).openingValue) },
  ],
  Group: [
    { key: 'name', label: 'Group', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'parent', label: 'Group above it', render: r => v(r).parent || <span className="text-subtle">None (a top-level group)</span> },
  ],
  Unit: [
    { key: 'name', label: 'Unit', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'formal', label: 'Full name', render: r => r.data.originalname || '' },
    { key: 'kind', label: 'Type', render: r => (r.data.issimpleunit ? 'Simple' : 'Compound') },
  ],
  Voucher: [
    { key: 'date', label: 'Date', render: r => <span className="whitespace-nowrap">{formatTallyDate(r.data.date)}</span> },
    { key: 'no', label: 'Voucher number', render: r => <span className="font-medium">{r.data.vouchernumber}</span> },
    { key: 'type', label: 'Voucher type', render: r => r.view?.voucherType || r.data.vouchertypename || '' },
    { key: 'party', label: 'Party', render: r => r.data.partyledgername || <span className="text-subtle">None</span> },
    { key: 'narr', label: 'Narration', render: r => r.data.narration || '' },
    { key: 'lines', label: 'Lines', align: 'right', render: r => voucherLines(r).length },
    { key: 'amt', label: 'Amount', align: 'right', render: r => formatAmount(voucherTotal(r)) },
    { key: 'status', label: 'Status', render: r => (r.view?.notPosted ? <StatusChip tone="warning" title="Never written to a Zoho file">{NOT_POSTED[r.view.notPosted]}. Never written to a Zoho file</StatusChip> : <StatusChip tone="success">Posted</StatusChip>) },
  ],
  TrialBalanceLine: [
    { key: 'name', label: 'Ledger', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'group', label: 'Tally group', render: r => v(r).parent || '' },
    { key: 'dr', label: 'Debit', align: 'right', render: r => (Number(r.data.closingbalance) < 0 ? formatAmount(r.data.closingbalance) : '') },
    { key: 'cr', label: 'Credit', align: 'right', render: r => (Number(r.data.closingbalance) > 0 ? formatAmount(r.data.closingbalance) : '') },
  ],
  StockSummaryLine: [
    { key: 'name', label: 'Item', render: r => <span className="font-medium">{nameOf(r)}</span> },
    { key: 'qty', label: 'Closing quantity', align: 'right', render: r => (r.data.closingquantity || '').trim() },
    { key: 'val', label: 'Closing value', align: 'right', render: r => formatAmount(r.data.closingvalue) },
  ],
};

// Friendly labels for the detail panel. Anything not listed is shown under "Other source fields".
const LABELS = {
  name: 'Name', parent: 'Tally group', mailingname: 'Mailing name', partygstin: 'GSTIN', incometaxnumber: 'PAN', ledstatename: 'State', pincode: 'PIN code',
  countryname: 'Country', email: 'Email', openingbalance: 'Opening balance', baseunits: 'Unit', hsncode: 'HSN code', openingvalue: 'Opening value',
  originalname: 'Full name', date: 'Date', vouchertypename: 'Voucher type', vouchernumber: 'Voucher number', partyledgername: 'Party', narration: 'Narration',
  closingbalance: 'Closing balance', closingquantity: 'Closing quantity', closingvalue: 'Closing value', taxtype: 'Tax type', gstdutyhead: 'GST duty head',
};
const HIDDEN = new Set(['metadata', 'guid', 'ledgerentries', 'allledgerentries', 'allinventoryentries', 'address', 'issimpleunit']);
const showValue = (k, v) => (k === 'date' ? formatTallyDate(v) : /balance$|value$/.test(k) ? (k.includes('balance') ? drCr(v) || '0.00' : formatAmount(v)) : String(v));

// What the platform reads from a ledger (customers and vendors: these values are written to the Zoho file).
const VIEW_LABELS = [
  ['mailingName', 'Mailing name'], ['state', 'State'], ['pincode', 'PIN code'], ['country', 'Country'], ['gstin', 'GSTIN'],
  ['registrationType', 'GST registration type'], ['placeOfSupply', 'Place of supply'], ['pan', 'PAN'], ['email', 'Email'], ['phone', 'Phone'], ['mobile', 'Mobile'],
  ['zohoGstTreatment', 'GST Treatment written for Zoho'], ['zohoStateCode', 'State code written for Zoho (Place Of Contact / Source Of Supply)'],
];

// Zoho's GST treatment codes in words (the code itself stays visible in small text).
const GST_TREATMENT_WORDS = {
  business_gst: 'Registered (regular)', business_registered_regular: 'Registered (regular)', business_registered_composition: 'Registered (composition)',
  business_sez: 'SEZ', business_none: 'Unregistered', business_unregistered: 'Unregistered', consumer: 'Consumer', overseas: 'Overseas',
};
const viewValue = (k, v) => (k === 'zohoGstTreatment' && GST_TREATMENT_WORDS[v]
  ? <>{GST_TREATMENT_WORDS[v]} <span className="text-[13px] text-subtle">({v})</span></>
  : v);

function Detail({ rec, onClose }) {
  const d = rec.data;
  const view = rec.view || {};
  const fields = Object.entries(d).filter(([k, val]) => !HIDDEN.has(k) && val !== '' && val != null && typeof val !== 'object' && !(typeof val === 'string' && val.includes('\u0004')));
  const known = fields.filter(([k]) => LABELS[k] && !(rec.type === 'Ledger' && VIEW_LABELS.some(([, label]) => label === LABELS[k])));
  const other = fields.filter(([k]) => !LABELS[k]);
  const lines = rec.type === 'Voucher' ? voucherLines(rec) : [];
  const address = rec.type === 'Ledger' && view.address ? view.address : list(d.address);
  const readValues = rec.type === 'Ledger' ? VIEW_LABELS.filter(([k]) => view[k]) : [];
  return (
    <Card title={nameOf(rec)} subtitle={`Tally record ID: ${rec.sourceId}`}
      right={<button onClick={onClose} className="text-[14px] text-muted hover:text-ink inline-flex items-center gap-1 min-h-8 px-2 rounded-md hover:bg-soft focus-visible:outline-2 focus-visible:outline-brand"><X className="w-4 h-4" aria-hidden="true" /> Close</button>}>
      <div className="p-4 space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[14px]">
          {known.map(([k, val]) => (
            <div key={k}><dt className="text-[13px] text-subtle">{LABELS[k]}</dt><dd className="text-ink">{showValue(k, val)}</dd></div>
          ))}
          {readValues.map(([k, label]) => (
            <div key={k}><dt className="text-[13px] text-subtle">{label}</dt><dd className="text-ink">{viewValue(k, view[k])}</dd></div>
          ))}
          {address.length > 0 && <div><dt className="text-[13px] text-subtle">Address</dt><dd className="text-ink">{address.join(', ')}</dd></div>}
        </dl>
        {rec.type === 'Ledger' && (
          <p className="text-[13px] text-muted">
            Mailing name, address, state, PIN code, country and GST details are taken from the latest dated details in Tally on or before the end of the financial year.
            {view.legacy?.length > 0 && ` Some values were found only in Tally's older fields (${view.legacy.join(', ')}).`}
          </p>
        )}

        {lines.length > 0 && (
          <div className="border border-line rounded-md overflow-hidden">
            <Table
              columns={[
                { key: 'ledger', label: 'Ledger' },
                { key: 'item', label: 'Item', render: l => l.item || '' },
                { key: 'qty', label: 'Quantity', render: l => l.qty || '' },
                { key: 'dr', label: 'Debit', align: 'right', render: l => (Number(l.amount) < 0 ? formatAmount(l.amount) : '') },
                { key: 'cr', label: 'Credit', align: 'right', render: l => (Number(l.amount) > 0 ? formatAmount(l.amount) : '') },
              ]}
              rows={lines}
            />
          </div>
        )}

        {other.length > 0 && (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-muted">Other source fields ({other.length})</summary>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {other.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-subtle font-mono text-[13px]">{k}</dt><dd className="text-ink">{String(v)}</dd></div>)}
            </dl>
          </details>
        )}
      </div>
    </Card>
  );
}

// ---------- the Trial Balance report: an indented table with the checks ----------
const KIND = { ledger: 'Ledger', group: 'Group' };
function TrialBalanceReport({ tb }) {
  const s = tb.summary;
  const Fact = ({ ok, children }) => (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-success" strokeWidth={1.75} aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning" strokeWidth={1.75} aria-hidden="true" />}
      <span className={ok ? 'text-muted' : 'text-warning-ink font-medium'}>{children}</span>
    </li>
  );
  const th = 'py-2.5 px-3 font-semibold whitespace-nowrap';
  return (
    <Card title="Trial Balance" subtitle={`${s.lines.toLocaleString()} lines from the Tally Trial Balance report, shown as in Tally: groups with the lines under them. Dr is a debit balance, Cr a credit balance.`}>
      <div className="p-4 border-b border-line text-[14px] bg-soft/40">
        <ul className="space-y-1.5">
          <Fact ok>{s.ledgers.toLocaleString()} lines are ledgers and {s.groups.toLocaleString()} are groups{s.unmatched > 0 ? `; ${s.unmatched.toLocaleString()} could not be matched to the masters` : ''}.</Fact>
          <Fact ok={s.atLedgerLevel}>
            {s.atLedgerLevel
              ? 'Every ledger is listed, so the Opening Balances file is created from the Opening balance column.'
              : `Not every ledger is listed: ${s.lowestGroups.toLocaleString()} of the ${s.lowestLines.toLocaleString()} lowest lines are groups. No Opening Balances file is created from this report. In Tally press Alt+F5 for the detailed view, export the Trial Balance again and upload it.`}
          </Fact>
          <Fact ok={s.totals.openingBalanced}>Opening balances: debits {formatAmount(s.totals.openingDebit)}, credits {formatAmount(s.totals.openingCredit)}. {s.totals.openingBalanced ? 'They agree.' : 'They do not agree.'}</Fact>
          <Fact ok={s.totals.closingBalanced}>Closing balances: debits {formatAmount(s.totals.closingDebit)}, credits {formatAmount(s.totals.closingCredit)}. {s.totals.closingBalanced ? 'They agree.' : 'They do not agree.'}</Fact>
          {s.movement && (
            <Fact ok={s.movement.differ === 0}>
              Debits and credits of the year compared with the {s.movement.vouchers.toLocaleString()} vouchers stored: {s.movement.agree.toLocaleString()} of {s.movement.checked.toLocaleString()} lines agree
              {s.movement.differ > 0 ? `, ${s.movement.differ.toLocaleString()} differ (marked below, and listed as flagged items with the figures)` : ''}.
              {s.movement.excludedVouchers > 0 && ` ${s.movement.excludedVouchers.toLocaleString()} cancelled, optional or deleted voucher(s) are not counted.`}
              {s.movement.otherVouchers > 0 && ` ${s.movement.otherVouchers.toLocaleString()} voucher(s) of other voucher types are not counted.`}
            </Fact>
          )}
          <Fact ok={s.closingArithmetic.differ === 0}>
            Opening balance plus the year's movement gives the closing balance on {s.closingArithmetic.agree.toLocaleString()} of {s.lines.toLocaleString()} lines{s.closingArithmetic.differ > 0 ? `; ${s.closingArithmetic.differ.toLocaleString()} do not add up` : ''}.
          </Fact>
        </ul>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Kind</th>
              <th className={`${th} text-right`}>Opening balance</th>
              <th className={`${th} text-right`}>Debit</th>
              <th className={`${th} text-right`}>Credit</th>
              <th className={`${th} text-right`}>Closing balance</th>
              <th className={th}>Check against vouchers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-soft">
            {tb.lines.map(l => (
              <tr key={l.lineNo} className="align-top hover:bg-soft/60">
                <td className="py-2 px-3 text-ink">
                  <span style={{ paddingLeft: `${l.depth * 1.25}rem` }} className={`block ${l.hasChildren ? 'font-semibold' : ''}`}>{l.name}</span>
                  {l.notes.map(n => <span key={n} style={{ paddingLeft: `${l.depth * 1.25}rem` }} className="block text-[13px] text-muted">{n}</span>)}
                </td>
                <td className="py-2 px-3 text-muted whitespace-nowrap">{KIND[l.matchType] || <StatusChip tone="warning">Not in the masters</StatusChip>}</td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{drCr(l.opening)}</td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{l.debit === '' ? '' : formatAmount(l.debit)}</td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{l.credit === '' ? '' : formatAmount(l.credit)}</td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{drCr(l.closing)}</td>
                <td className="py-2 px-3 text-[13px]">
                  {l.movementOk === true && <StatusChip tone="success">Agrees</StatusChip>}
                  {l.movementOk === false && (
                    <span className="text-danger-ink font-medium">
                      Differs: the vouchers give debits {formatAmount(l.movementDebit)} and credits {formatAmount(l.movementCredit)}
                    </span>
                  )}
                  {l.movementOk === null && <span className="text-subtle">Not checked</span>}
                  {!l.closingOk && <span className="block text-danger-ink font-medium">Opening, debits and credits do not give this closing balance</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Screen18_DataExplorer({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [slot, setSlot] = useState(null);
  const [data, setData] = useState({ total: 0, records: [] });
  const [open, setOpen] = useState(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [tb, setTb] = useState(null); // the Trial Balance report as matched and checked, when one was uploaded

  const uploaded = job?.completeness.slots.filter(s => s.status === 'uploaded') || [];
  const active = slot || uploaded[0]?.key;
  const processed = isProcessed(job);

  useEffect(() => {
    if (!job || !active || !processed) return;
    setOpen(null); setSearch('');
    api.get(`/migrations/${job.id}/records?slot=${active}${active === 'accounts' ? '&type=Ledger' : ''}&limit=500`).then(setData).catch(e => setLoadError(e.message));
    if (active === 'trial_balance') api.get(`/migrations/${job.id}/trial-balance`).then(setTb).catch(e => setLoadError(e.message));
  }, [job, active, processed]);
  const showReport = active === 'trial_balance' && tb?.shape === 'report';

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.records.filter(r => JSON.stringify(r.data).toLowerCase().includes(q)) : data.records;
  }, [data, search]);
  const columns = COLUMNS[data.records[0]?.type] || [{ key: 'name', label: 'Name' }];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <JobHeader
        title="Data Explorer"
        subtitle="The records read from your Tally files. Values are shown exactly as they are in Tally."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={<button onClick={() => onNavigate('screen-19')} className={`${btnPrimary} self-start`}><span>Mapping Studio</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>}
      />

      {job && !processed && <Blocked title="Data has not been processed yet" text="Upload the Tally files and run processing first." button="Open Completeness Check" onClick={() => onNavigate('screen-16')} />}

      {job && processed && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a dataset to look at">
            {uploaded.map(s => (
              <button key={s.key} type="button" onClick={() => setSlot(s.key)} aria-pressed={active === s.key}
                className={`min-h-9 px-3 py-1.5 rounded-md text-[13px] font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${active === s.key ? 'bg-action text-white border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>
                {s.name} <span className={active === s.key ? 'text-white/80 tabular-nums' : 'text-subtle tabular-nums'}>{s.actualCount ?? s.upload.records}</span>
              </button>
            ))}
          </div>

          {open && !showReport && <Detail rec={open} onClose={() => setOpen(null)} />}

          {showReport && <TrialBalanceReport tb={tb} />}

          {!showReport && <Card
            title={uploaded.find(s => s.key === active)?.name}
            subtitle={`Showing ${rows.length.toLocaleString()} of ${data.total.toLocaleString()} records. Click a row for full details.`}
            right={
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search these records" aria-label="Search these records" className={`${inputClass} pl-9`} />
              </div>
            }
          >
            <Table columns={columns} rows={rows} rowKey={r => r.id} onRowClick={r => { setOpen(r); document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' }); }} empty="No records match your search." />
          </Card>}
        </>
      )}
    </div>
  );
}
