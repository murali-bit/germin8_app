import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, formatAmount } from '../api';
import { Card } from './ui';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// Receipts, payments and notes that belong in a Zoho module whose import sample is not in the platform yet (Payments
// Received, Payments Made, Vendor Credits, Credit Notes). No file is built for them; this says which sample is needed,
// where the file would go in the import order, and (full) every voucher held with the invoice or bill it would settle.
// mode: 'compact' (Dependency Manager, Import Instructions) or 'full' (Export Center).
export default function WaitingForSample({ job, mode = 'compact' }) {
  const [data, setData] = useState(null);
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!job) return;
    let live = true;
    api.get(`/migrations/${job.id}/payments${mode === 'full' ? `?limit=500${file ? `&file=${file}` : ''}` : ''}`)
      .then(d => { if (live) { setData(d); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [job, mode, file, job?.status, job?.updated_at]);

  if (error) return <div className="text-[14px] text-ink">{error}</div>;
  if (!data) return null;
  // what the files created last hold; before any file, what the data holds now
  const counts = data.files?.held || data.now?.summary || {};
  const modules = data.samplesNeeded.filter(s => counts[s.key]?.vouchers);
  if (!modules.length && mode === 'compact') return null;

  return (
    <Card title="Payments files from Zoho's import sample (optional)"
      subtitle={modules.length
        ? `${plural(modules.reduce((t, s) => t + counts[s.key].vouchers, 0), 'voucher')} are held for Zoho modules whose import sample is not in the platform, because Payments files were chosen in Voucher files. No column is invented, so these files are not created. Choose the default, Manual Journals, in Voucher files to write them into the journals file now, or add the sample so the file can be built.`
        : 'Nothing waits for these samples: with the default route (Manual Journals, in Voucher files) receipts, payments and notes are in the journals file of receipts, payments and contra. A sample is needed only if you choose Payments files there.'}>
      <div className="divide-y divide-line">
        {data.samplesNeeded.filter(s => mode === 'full' || counts[s.key]?.vouchers).map(s => {
          const c = counts[s.key];
          return (
            <div key={s.key} className="px-4 py-3 text-[14px] text-muted">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium text-ink">{s.module}</span>
                <span>{c ? `${plural(c.vouchers, 'voucher')} held (${s.what})` : `none in this migration (${s.what})`}</span>
              </div>
              {c && (
                <div className="tabular-nums">
                  Amount {formatAmount(c.amount)} · set against {s.key === 'payments_received' || s.key === 'credit_notes' ? 'invoices' : 'bills'} in the files: {formatAmount(c.applied)}
                  {' '}({plural(c.allocationsApplied, 'allocation')}) · unapplied {formatAmount(c.unapplied)}
                  {c.flagged ? ` · ${plural(c.flagged, 'voucher')} with something to check` : ''}
                </div>
              )}
              <div>Sample needed: {s.sample}.</div>
              <div>In the import order: after the {s.importAfterModule} file.</div>
            </div>
          );
        })}
      </div>
      {mode === 'full' && data.now && (
        <>
          {data.now.journalGroups.length > 0 && (
            <div className="px-4 py-3 border-t border-line text-[14px] text-muted">
              <div className="font-medium text-ink">Written as Manual Journals instead ({plural(data.now.journals, 'voucher')} in journals_receipts_payments_contra.csv)</div>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {data.now.journalGroups.map(g => <li key={`${g.slot}|${g.category}`}>{g.slotName}: {plural(g.vouchers, 'voucher')}. {g.words}</li>)}
                {data.now.needALook.length > 0 && <li>{plural(data.now.needALook.length, 'voucher')} whose pattern is not clear, or a note to the other kind of party: written as Manual Journals and listed under "Rows that need review before import".</li>}
              </ul>
            </div>
          )}
          {data.now.total > 0 && (
            <div className="border-t border-line">
              <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-[14px]">
                <span className="font-medium text-ink">Held vouchers</span>
                <label className="flex items-center gap-2 text-muted">
                  <span>Show</span>
                  <select value={file} onChange={e => setFile(e.target.value)} className="min-h-9 border border-line-strong rounded-lg px-2 text-[14px] text-ink bg-white">
                    <option value="">All modules</option>
                    {data.samplesNeeded.map(s => <option key={s.key} value={s.key}>{s.module}</option>)}
                  </select>
                </label>
                <span className="text-muted">{data.now.total > data.now.vouchers.length ? `First ${data.now.vouchers.length} of ${data.now.total}` : plural(data.now.total, 'voucher')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead className="bg-soft text-muted text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">Voucher</th><th className="px-4 py-2 font-medium">Module</th><th className="px-4 py-2 font-medium">Party</th>
                      <th className="px-4 py-2 font-medium">Bank or cash</th><th className="px-4 py-2 font-medium text-right">Amount</th>
                      <th className="px-4 py-2 font-medium">Set against</th><th className="px-4 py-2 font-medium text-right">Unapplied</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.now.vouchers.map(h => (
                      <tr key={h.id} className="align-top">
                        <td className="px-4 py-2 text-ink whitespace-nowrap">{h.number}<span className="block text-[13px] text-muted">{h.date}</span></td>
                        <td className="px-4 py-2 text-muted">{h.module}</td>
                        <td className="px-4 py-2 text-ink">{h.party}</td>
                        <td className="px-4 py-2 text-muted">{h.bank || '-'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatAmount(h.amount)}</td>
                        <td className="px-4 py-2 text-muted">
                          {h.applied.length ? h.applied.map(a => <span key={`${a.number}|${a.ref}`} className="block tabular-nums">{a.number}: {formatAmount(a.amount)}</span>) : 'Nothing'}
                          {h.flags.map((f, i) => <span key={i} className="flex items-start gap-1.5 mt-1 text-[13px] text-ink"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{f.message}</span>)}
                          {h.notes.map((n, i) => <span key={`n${i}`} className="block mt-1 text-[13px]">{n.words}</span>)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatAmount(h.unapplied)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
