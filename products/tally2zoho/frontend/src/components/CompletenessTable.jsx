import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronDown, CircleDashed, Download, TriangleAlert } from 'lucide-react';
import { api, downloadFile, formatAmount } from '../api';
import { count, completenessRowState, countDifferenceWords } from '../importWizard';
import { Card, StatusChip, btnSecondary } from './ui';

// "This was in Tally, this is what goes into Zoho, the difference should be zero."
// One row per dataset, from GET /completeness-table (the server works everything out). refreshKey: read again when it changes.
// The same table is on several screens, so it starts folded (the headline only) unless defaultOpen, or a row is not
// matched or has vouchers in no file yet.
const money = f => (f ? `${formatAmount(f.amount)}${f.side ? ` ${f.side}` : ''}` : '–');
const th = 'py-2.5 px-3 font-semibold whitespace-nowrap';
const td = 'py-2.5 px-3 align-top';
const num = `${td} text-right tabular-nums whitespace-nowrap`;
// a reason's count in words: the service items the tool adds are rows MORE in Zoho, said as a plain number
const reasonCount = r => (r.count == null ? '' : `: ${count(Math.abs(r.count))}`);

function Status({ row, onNavigate }) {
  const state = completenessRowState(row);
  if (state === 'matches') return <StatusChip tone="success"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Matches</StatusChip>;
  if (state === 'no_files') return <span className="text-muted">Files not created yet</span>;
  const notMatched = state === 'not_matched';
  const open = state === 'not_in_file';
  return (
    <div className="min-w-[14rem]">
      <div className={`inline-flex items-center gap-1.5 font-medium ${notMatched ? "text-danger-ink" : open ? "text-warning-ink" : "text-success-ink"}`}>
        {notMatched && <TriangleAlert className="w-4 h-4" aria-hidden="true" />}
        {open && <CircleDashed className="w-4 h-4" aria-hidden="true" />}
        {notMatched ? 'Not matched' : open ? 'Not in any file yet' : 'Explained'}
      </div>
      <ul className="text-[13px] text-muted mt-0.5 space-y-0.5">
        {row.reasons.map(r => (
          <li key={r.kind} className={r.explained === false || r.kind.startsWith('held:') ? 'text-ink font-medium' : ''}>
            {r.label}{reasonCount(r)}{r.amount ? ` (${money(r.amount)})` : ''}
          </li>
        ))}
      </ul>
      {open && onNavigate && (
        <button type="button" onClick={() => onNavigate('screen-40', { step: 'held' })} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink underline">
          What to do <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      {notMatched && row.detail?.screen && onNavigate && (
        <button type="button" onClick={() => onNavigate(row.detail.screen)} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink underline">
          See the detail <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function CompletenessTable({ job, onNavigate, refreshKey = '', defaultOpen = false }) {
  const [table, setTable] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null); // null: folded or open as the rows say; true / false: chosen
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return undefined;
    let live = true;
    api.get(`/migrations/${jobId}/completeness-table`).then(t => { if (live) { setTable(t); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [jobId, job?.status, job?.updated_at, refreshKey]);

  if (error) return <div role="alert" className="p-4 rounded-xl border border-line bg-white text-[14px] text-ink">The Tally and Zoho comparison could not be read. {error}</div>;
  if (!table?.available) return null;

  const download = async () => {
    setBusy(true); setError('');
    try { await downloadFile(`/api/migrations/${jobId}/completeness-table.csv`, `completeness_${jobId}.csv`); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const states = table.rows.map(completenessRowState);
  const notMatched = states.filter(s => s === 'not_matched').length;
  const notInFile = states.filter(s => s === 'not_in_file').length;
  const matches = states.filter(s => s === 'matches').length;
  const explained = states.filter(s => s === 'explained').length;
  const headline = !table.filesCreated ? 'Create the files to compare them with Tally.'
    : [notMatched ? `${notMatched} of ${table.rows.length} rows are not matched.` : '',
      notInFile ? `${notInFile} ${notInFile === 1 ? 'row has' : 'rows have'} vouchers in no file yet (an open item).` : '',
      !notMatched && !notInFile ? (explained ? `${matches} rows match. ${explained} have a difference that is explained.` : 'Every row matches.') : ''].filter(Boolean).join(' ');
  const open = shown ?? (defaultOpen || notMatched > 0 || notInFile > 0);
  const groups = [['masters', 'Masters'], ['vouchers', 'Vouchers']];

  return (
    <Card
      title="Tally and Zoho files"
      subtitle={`What was in Tally and what is in the Zoho files. The difference should be zero. ${headline}`}
      right={(
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={() => setShown(!open)} aria-expanded={open} className={btnSecondary}>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /> {open ? 'Hide the table' : 'Show the table'}
          </button>
          <button type="button" onClick={download} disabled={busy} className={btnSecondary}><Download className="w-4 h-4" aria-hidden="true" /> {busy ? 'Downloading…' : 'Download CSV'}</button>
        </div>
      )}
    >
      {table.outOfDate && <div className="px-4 py-2.5 border-b border-line text-[14px] text-ink">The files are out of date. Create them again to compare the current data.</div>}
      {open && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className={th}>Dataset</th>
                  <th scope="col" className={`${th} text-right`}>In Tally</th>
                  <th scope="col" className={`${th} text-right`}>In Zoho files</th>
                  <th scope="col" className={`${th} text-right`}>Difference</th>
                  <th scope="col" className={`${th} text-right`}>Amount in Tally</th>
                  <th scope="col" className={`${th} text-right`}>Amount in Zoho files</th>
                  <th scope="col" className={`${th} text-right`}>Difference</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              {groups.map(([key, label]) => (
                <tbody key={key} className="divide-y divide-line">
                  <tr><th scope="colgroup" colSpan={8} className="py-1.5 px-3 text-[13px] font-semibold text-muted bg-white border-t border-line">{label}</th></tr>
                  {table.rows.filter(r => r.group === key).map(r => (
                    <tr key={r.key}>
                      <th scope="row" className={`${td} font-medium text-ink`}>
                        {r.name}
                        {r.note && <div className="text-[13px] font-normal text-muted max-w-[18rem]">{r.note}</div>}
                      </th>
                      <td className={num}>{count(r.tally.count)}</td>
                      <td className={num}>{count(r.zoho.count)}</td>
                      <td className={`${num} ${r.difference.count ? 'font-semibold' : ''}`}>{countDifferenceWords(r.difference.count)}</td>
                      <td className={num}>{money(r.tally.amount)}</td>
                      <td className={num}>{money(r.zoho.amount)}</td>
                      <td className={`${num} ${r.difference.amount && Number(r.difference.amount.signed) !== 0 ? 'font-semibold' : ''}`}>{money(r.difference.amount)}</td>
                      <td className={td}><Status row={r} onNavigate={onNavigate} /></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-line text-[13px] text-muted">
            Masters: count of ledgers and items, and the net opening balance. Vouchers: count of vouchers, and the total of their debits. Difference: Tally less Zoho.
          </div>
        </>
      )}
    </Card>
  );
}
