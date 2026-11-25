import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, FileDown, X, XCircle } from 'lucide-react';
import { api, downloadFile, useJob } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Blocked, Card, Note, StatusChip, Table, btnPrimary, btnSecondary, inputClass } from '../../components/ui';

// Amounts come from the server as decimal strings ("12345.60"). They are only grouped for reading (Indian style), never recalculated.
const money = s => {
  if (s == null || s === '') return '';
  const [int, dec = '00'] = String(s).replace(/^-/, '').split('.');
  const last3 = int.slice(-3), rest = int.slice(0, -3);
  return `${String(s).startsWith('-') ? '-' : ''}${rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},` : ''}${last3}.${dec}`;
};
const isZero = s => /^-?0+(\.0+)?$/.test(String(s ?? '0'));
const day = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '');
const count = n => (n || 0).toLocaleString('en-IN');

// Short column headings for the destinations (the server's labels are longer and are used in the drill-down title).
const SHORT = {
  'written:invoices': 'Invoices', 'written:bills': 'Bills', 'written:journals': 'Manual Journals', 'written:other_journals': 'Journals (receipts, payments, contra)',
  'held:payments_received': 'Held: Payments Received', 'held:payments_made': 'Held: Payments Made', 'held:vendor_credits': 'Held: Vendor Credits', 'held:credit_notes': 'Held: Credit Notes',
  awaiting_routing: 'Waiting for routing', left_out: 'Left out', no_file: 'No Zoho file', not_handled: 'Not handled',
};

function Status({ ok }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <StatusChip tone={ok ? 'success' : 'danger'}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" /> {ok ? 'Matches' : 'Does not match'}
    </StatusChip>
  );
}

// A number in a table that opens the vouchers behind it.
function Cell({ n, onOpen, label }) {
  if (!n) return <span className="text-subtle">0</span>;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onOpen(); }} aria-label={label} className="text-info-ink underline underline-offset-2 tabular-nums font-medium hover:text-action-hover">
      {count(n)}
    </button>
  );
}

export default function VoucherReconciliation({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [rec, setRec] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [pick, setPick] = useState(null); // { slot, bucket, title }
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState(null); // { key, list } or { key, error }: the answer for one query
  const listRef = useRef(null);

  useEffect(() => {
    if (!job) return undefined;
    let stop = false;
    api.get(`/migrations/${job.id}/voucher-reconciliation`)
      .then(r => { if (!stop) { setRec(r); setLoadError(''); } })
      .catch(e => { if (!stop) setLoadError(e.message); });
    return () => { stop = true; };
  }, [job]);

  // the vouchers behind the cell picked; only the answer to the current query is shown
  const query = job && pick ? `/migrations/${job.id}/voucher-reconciliation/vouchers?${new URLSearchParams({ slot: pick.slot, bucket: pick.bucket, page: String(page), pageSize: String(pageSize) })}` : null;
  useEffect(() => {
    if (!query) return undefined;
    let stop = false;
    api.get(query)
      .then(r => { if (!stop) setResult({ key: query, list: r }); })
      .catch(e => { if (!stop) setResult({ key: query, error: e.message }); });
    return () => { stop = true; };
  }, [query]);
  const list = result?.key === query ? result.list || null : null;
  const listError = result?.key === query ? result.error || '' : '';

  const open = (slot, bucket, title) => {
    setPick({ slot, bucket, title }); setPage(1);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const download = async () => {
    setDownloading(true); setLoadError('');
    try { await downloadFile(`/api/migrations/${job.id}/voucher-reconciliation/report.csv`, 'voucher_reconciliation.csv'); } catch (e) { setLoadError(e.message); } finally { setDownloading(false); }
  };

  const available = rec?.available;
  // the headline, from the server's own counts: written to a file, in no file yet (held for a Zoho sample or waiting
  // for routing), left out with a reason, kept with no Zoho file
  const dests = available ? rec.total.destinations : {};
  const written = Object.entries(dests).filter(([k]) => k.startsWith('written:')).reduce((t, [, n]) => t + n, 0);
  const notInFile = available ? (rec.notInAnyFile?.heldForZohoSample || 0) + (rec.notInAnyFile?.awaitingRouting || 0) : 0;
  const leftOut = available ? rec.notInAnyFile?.leftOut || 0 : 0;
  const noFile = available ? rec.notInAnyFile?.noZohoFile || 0 : 0;
  const destCols = available ? rec.destinations.filter(d => rec.total.destinations[d.key]) : [];
  const typeName = slot => (slot === 'all' ? 'All voucher types' : rec?.rows.find(r => r.slot === slot)?.name || slot);

  const countRows = available ? [...rec.rows, { slot: 'all', name: 'Total', in: rec.total.in, destinations: rec.total.destinations, out: rec.total.out, matches: rec.total.matches, total: true }] : [];
  const countColumns = [
    { key: 'name', label: 'Voucher type', render: r => <span className={r.total ? 'font-semibold' : 'font-medium'}>{r.name}</span> },
    { key: 'in', label: 'In the Tally JSON', align: 'right', render: r => <Cell n={r.in} label={`${r.name}: all ${r.in} vouchers`} onOpen={() => open(r.slot, 'all', `${typeName(r.slot)}: every voucher`)} /> },
    ...destCols.map(d => ({ key: d.key, label: SHORT[d.key] || d.label, align: 'right',
      render: r => <Cell n={r.destinations[d.key]} label={`${r.name}: ${d.label}`} onOpen={() => open(r.slot, d.key, `${typeName(r.slot)}: ${d.label}`)} /> })),
    { key: 'out', label: 'Accounted for', align: 'right', render: r => <span className="tabular-nums font-semibold">{count(r.out)}</span> },
    { key: 'status', label: 'Status', render: r => <Status ok={r.matches} /> },
  ];

  const roleKeys = available ? [...Object.keys(rec.roleLabels).filter(k => rec.lines.total.roles[k]), ...(rec.lines.total.roles.missing ? ['missing'] : [])] : [];
  const roleLabel = k => (k === 'missing' ? 'Not recorded' : rec.roleLabels[k]);
  const lineRows = available ? [...rec.lines.rows, { slot: 'all', name: 'Total', linesIn: rec.lines.total.linesIn, linesOut: rec.lines.total.linesOut, roles: rec.lines.total.roles, matches: rec.lines.total.matches, total: true }] : [];
  const lineColumns = [
    { key: 'name', label: 'Voucher type', render: r => <span className={r.total ? 'font-semibold' : 'font-medium'}>{r.name}</span> },
    { key: 'linesIn', label: 'Tally lines in', align: 'right', render: r => <span className="tabular-nums">{count(r.linesIn)}</span> },
    ...roleKeys.map(k => ({ key: k, label: roleLabel(k), align: 'right',
      render: r => <Cell n={r.roles[k]} label={`${r.name}: lines written as ${roleLabel(k)}`} onOpen={() => open(r.slot, `role:${k}`, `${typeName(r.slot)}: vouchers with a line written as "${roleLabel(k)}"`)} /> })),
    { key: 'linesOut', label: 'Accounted for', align: 'right', render: r => <span className="tabular-nums font-semibold">{count(r.linesOut)}</span> },
    { key: 'status', label: 'Status', render: r => <Status ok={r.matches} /> },
  ];

  const amountRows = available ? [...rec.amounts.rows, { ...rec.amounts.total, slot: 'all', name: 'Total', total: true }] : [];
  const pair = p => (p ? <span className="tabular-nums whitespace-nowrap">{money(p.debit)} Dr<br />{money(p.credit)} Cr</span> : '');
  const amountColumns = [
    { key: 'name', label: 'Voucher type', render: r => <span className={r.total ? 'font-semibold' : 'font-medium'}>{r.name}</span> },
    { key: 'in', label: 'In Tally', align: 'right', render: r => pair(r.in) },
    { key: 'notWritten', label: 'Not written (held, waiting, left out)', align: 'right', render: r => pair(r.notWritten) },
    { key: 'writtenTally', label: 'Vouchers written, in Tally', align: 'right', render: r => pair(r.writtenTally) },
    { key: 'written', label: 'As written in the files', align: 'right', render: r => pair(r.written) },
    { key: 'difference', label: 'Difference', align: 'right',
      render: r => (isZero(r.difference.debit) && isZero(r.difference.credit) ? <span className="text-muted">None</span>
        : <button type="button" className="text-info-ink underline underline-offset-2 text-right font-medium" onClick={() => open(r.slot, 'difference', `${typeName(r.slot)}: vouchers whose amounts differ`)}>{pair(r.difference)}</button>) },
  ];

  const voucherColumns = [
    { key: 'date', label: 'Date', render: v => <span className="whitespace-nowrap">{day(v.date)}</span> },
    { key: 'number', label: 'Voucher number', render: v => <span className="font-medium break-all">{v.number || '(none)'}</span> },
    { key: 'type', label: 'Tally type', render: v => v.type || v.slotName },
    { key: 'went', label: 'Where it went', render: v => v.went },
    { key: 'file', label: 'Zoho file', render: v => v.file || <span className="text-subtle">None</span> },
    { key: 'doc', label: 'Document number written', render: v => <span className="break-all">{v.documentNumber || ''}</span> },
    { key: 'amount', label: 'Tally amount', align: 'right', render: v => pair(v.tally) },
    { key: 'written', label: 'As written', align: 'right', render: v => (v.written ? pair(v.written) : '') },
    { key: 'notes', label: 'Notes', render: v => (
      <div className="space-y-1 text-[13px] text-muted max-w-md">
        {v.reason && <div><span className="font-medium text-ink">Left out:</span> {v.reason}</div>}
        {v.differenceText && <div><span className="font-medium text-ink">Difference {money(v.difference.debit)} Dr / {money(v.difference.credit)} Cr:</span> {v.differenceText}</div>}
        {v.problem && <div className="text-danger-ink"><span className="font-medium">Does not add up:</span> {v.problem}</div>}
        {v.flags.length > 0 && (
          <details>
            <summary className="cursor-pointer text-info-ink">{v.flags.length === 1 ? '1 flagged item' : `${v.flags.length} flagged items`}</summary>
            <ul className="mt-1 space-y-1 list-disc pl-4">{v.flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
          </details>
        )}
      </div>
    ) },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <JobHeader
        title="Voucher Reconciliation"
        subtitle="Every voucher in the Tally JSON, and where it went in the Zoho files. Click a number to see the vouchers behind it."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={available ? (
          <button type="button" onClick={download} disabled={downloading} className={btnSecondary}>
            <FileDown className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {downloading ? 'Downloading…' : 'Download report (CSV)'}
          </button>
        ) : null}
      />

      {job && !rec && !loadError && <Note>Loading the reconciliation…</Note>}

      {job && rec && !available && (
        <Blocked title="Nothing to reconcile yet" text={rec.message} button="Open Export Center" onClick={() => onNavigate('screen-25')} />
      )}

      {available && (
        <>
          {rec.outOfDate && (
            <Note tone="warning" title="Out of date: these figures are for files that are out of date">
              <div role="status">
                <p className="text-muted">{rec.outOfDateReasons.slice(0, 5).join(' ')} Create the files again to bring this page up to date.</p>
                <button type="button" onClick={() => onNavigate('screen-25')} className="mt-2 text-info-ink hover:underline font-medium">Open Export Center</button>
              </div>
            </Note>
          )}

          <div className={`p-4 rounded-lg border flex items-start gap-3 text-[15px] ${notInFile > 0 ? 'border-warning-line bg-warning-soft' : rec.allChecksPass ? 'border-success-line bg-success-soft' : 'border-danger-line bg-danger-soft'}`}>
            {notInFile > 0 ? <CircleDashed className="w-5 h-5 shrink-0 mt-0.5 text-warning-ink" strokeWidth={1.75} aria-hidden="true" />
              : rec.allChecksPass ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-success-ink" strokeWidth={1.75} aria-hidden="true" /> : <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-danger-ink" strokeWidth={1.75} aria-hidden="true" />}
            <div>
              {/* never "all accounted for" while vouchers are in no file: they are an open item */}
              <div className="font-semibold text-ink">
                {count(written)} written to files, {count(notInFile)} not in any file yet{leftOut ? `, ${count(leftOut)} left out with a reason` : ''}{noFile ? `, ${count(noFile)} kept with no Zoho file` : ''}.
                {' '}{!rec.total.matches ? `${count(rec.total.in)} vouchers in, ${count(rec.total.out)} counted: does not match.` : notInFile > 0 ? 'Open item: they must still reach Zoho Books.' : rec.allChecksPass ? 'Every check passes.' : ''}
                {!rec.allChecksPass && ' Some checks do not pass (see Checks below).'}
              </div>
              {notInFile > 0 && <button type="button" onClick={() => onNavigate('screen-40', { step: 'held' })} className="mt-1 text-info-ink hover:underline font-medium text-[14px]">What to do: Import Wizard, "Not in any file yet"</button>}
              <div className="text-[14px] text-muted">Files created {new Date(rec.createdAt).toLocaleString('en-IN')}.{rec.checks.find(c => c.key === 'no_voucher_twice')?.ok ? ' No voucher is counted in two places.' : ''}</div>
            </div>
          </div>

          <Card title="Vouchers by type" subtitle="Each voucher is counted once: written to one Zoho file, held, waiting, left out with a reason, or kept with no Zoho file.">
            <Table columns={countColumns} rows={countRows} rowKey={r => r.slot} sticky />
            {Object.keys(rec.total.leftOutReasons).length > 0 && (
              <div className="px-4 py-3 border-t border-line text-[14px]">
                <div className="font-medium text-ink mb-1">Why vouchers were left out</div>
                <ul className="flex flex-wrap gap-x-5 gap-y-1">
                  {Object.entries(rec.total.leftOutReasons).map(([k, n]) => (
                    <li key={k}><span className="text-muted">{rec.leftOutReasonLabels[k] || k}:</span> <Cell n={n} label={`Left out: ${rec.leftOutReasonLabels[k]}`} onOpen={() => open('all', `left_out:${k}`, `Left out: ${rec.leftOutReasonLabels[k] || k}`)} /></li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {rec.held?.length > 0 && (
            <Card title="Held, waiting for a Zoho sample" subtitle="An open item: these vouchers are not in any file yet, because Payments files were chosen in Voucher files. Choose the default there, Manual Journals, to write them into the journals file now, or add Zoho's sample for the module in the Import Wizard (step &quot;Not in any file yet&quot;).">
              <ul className="divide-y divide-line">
                {rec.held.map(h => (
                  <li key={h.key} className="px-4 py-3 text-[14px] space-y-1">
                    <div className="font-medium text-ink">
                      {h.module}: <Cell n={h.vouchers} label={`Held for ${h.module}`} onOpen={() => open('all', `held:${h.key}`, `Held: waiting for the Zoho ${h.module} sample`)} />{' '}
                      {h.vouchers === 1 ? 'voucher' : 'vouchers'}, <span className="tabular-nums">{money(h.debit)} Dr / {money(h.credit)} Cr</span>
                    </div>
                    <div className="text-muted">Sample needed: {h.sample}.</div>
                    <div className="text-muted">Import after: {h.importAfterModule}.</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Tally lines" subtitle="Every ledger line of every voucher, and how it appears in the files. Lines of held, waiting and left-out vouchers are counted with their voucher, not checked one by one.">
            <Table columns={lineColumns} rows={lineRows} rowKey={r => r.slot} />
          </Card>

          <Card title="Amounts" subtitle="Debits and credits from Tally, and what the files post once imported. Differences are listed with their reason.">
            <Table columns={amountColumns} rows={amountRows} rowKey={r => r.slot} />
            <div className="px-4 py-3 border-t border-line text-[14px]">
              {rec.amounts.total.differences.length === 0 ? (
                <div className="text-muted">The files post exactly what Tally posted for every voucher written.</div>
              ) : (
                <>
                  <div className="font-medium text-ink mb-1">Why the amounts differ</div>
                  <ul className="space-y-1.5">
                    {rec.amounts.total.differences.map(d => (
                      <li key={d.reason} className="flex flex-col sm:flex-row sm:items-start gap-x-3">
                        <button type="button" className="text-info-ink underline underline-offset-2 text-left whitespace-nowrap font-medium" onClick={() => open('all', `difference:${d.reason}`, `Amounts differ: ${d.label}`)}>
                          {d.vouchers === 1 ? '1 voucher' : `${count(d.vouchers)} vouchers`}, {money(d.debit)} Dr / {money(d.credit)} Cr
                        </button>
                        <span className="text-muted">{d.label}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>

          <Card title="Checks">
            <ul className="divide-y divide-line">
              {rec.checks.map(c => (
                <li key={c.key} className="px-4 py-3 flex items-start gap-3 text-[14px]">
                  {c.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-success-ink" strokeWidth={1.75} aria-label="Passes" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-danger-ink" strokeWidth={1.75} aria-label="Does not pass" />}
                  <span className="text-ink">{c.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div ref={listRef}>
            {!pick ? (
              <Note>Click any number above to see the vouchers behind it: date, voucher number, the Zoho file and the document number written.</Note>
            ) : (
              <Card
                title={pick.title}
                subtitle={list ? `${count(list.total)} ${list.total === 1 ? 'voucher' : 'vouchers'}${list.outOfDate ? ' (files out of date)' : ''}` : 'Loading…'}
                right={<button type="button" onClick={() => setPick(null)} className={btnSecondary}><X className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Close</button>}
              >
                {listError && <div role="alert" className="px-4 py-3 text-[14px] text-danger-ink">{listError}</div>}
                {list && <Table columns={voucherColumns} rows={list.vouchers} rowKey={v => v.id} empty="No vouchers here." sticky compact />}
                {list && list.total > 0 && (
                  <div className="px-4 py-3 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[14px]">
                    <label className="flex items-center gap-2 text-muted">
                      Show
                      <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`${inputClass} w-24 min-h-9 py-1`}>
                        {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      per page
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="button" className={btnSecondary} disabled={list.page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous</button>
                      <span className="text-muted tabular-nums">Page {list.page} of {list.pages}</span>
                      <button type="button" className={btnSecondary} disabled={list.page >= list.pages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate('screen-25')} className={btnPrimary}>Open Export Center</button>
            <button type="button" onClick={() => onNavigate('screen-20')} className={btnSecondary}>Decide where each journal goes</button>
          </div>
        </>
      )}
    </div>
  );
}
