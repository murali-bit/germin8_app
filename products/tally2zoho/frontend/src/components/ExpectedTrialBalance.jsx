import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Download, TriangleAlert } from 'lucide-react';
import { api, downloadFile, formatAmount } from '../api';
import { count, expectedTbState } from '../importWizard';
import { Card, StatusChip, btnSecondary } from './ui';

// The trial balance Zoho Books should show after the files are imported, worked out by the tool from the files
// themselves (GET /predicted-trial-balance, server predictedtb.js) and compared with Tally's closing trial balance,
// account by account and customer by customer. Seen BEFORE the import, so a difference is found while it is still
// cheap to fix. A report: it never blocks a download. refreshKey: read again when it changes.
const money = f => (f ? `${formatAmount(f.amount)}${f.side ? ` ${f.side}` : ''}` : '–');
const th = 'py-2.5 px-3 font-semibold whitespace-nowrap';
const td = 'py-2.5 px-3 align-top';
const num = `${td} text-right tabular-nums whitespace-nowrap`;
const SHOWN = 50;

export default function ExpectedTrialBalance({ job, refreshKey = '', defaultOpen = false }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return undefined;
    let live = true;
    api.get(`/migrations/${jobId}/predicted-trial-balance`).then(r => { if (live) { setP(r); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [jobId, job?.status, job?.updated_at, refreshKey]);

  if (error) return <div role="alert" className="p-4 rounded-xl border border-line bg-white text-[14px] text-ink">The expected Zoho Books trial balance could not be worked out. {error}</div>;
  const s = expectedTbState(p);
  if (s.state === 'none') return null;
  const download = async () => {
    setBusy(true); setError('');
    try { await downloadFile(`/api/migrations/${jobId}/predicted-trial-balance.csv`, 'predicted_trial_balance.csv'); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const open = shown ?? (defaultOpen || s.state === 'differs');
  const c = p.comparison;
  return (
    <Card
      title="The trial balance Zoho Books should show"
      subtitle="Worked out from the files before you import them, and compared with Tally's closing trial balance, account by account and for every customer and vendor."
      right={s.state === 'problem' ? null : (
        <div className="flex flex-wrap gap-2 shrink-0">
          {s.rows.length > 0 && (
            <button type="button" onClick={() => setShown(!open)} aria-expanded={open} className={btnSecondary}>
              <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /> {open ? 'Hide the differences' : 'Show the differences'}
            </button>
          )}
          <button type="button" onClick={download} disabled={busy} className={btnSecondary}><Download className="w-4 h-4" aria-hidden="true" /> {busy ? 'Downloading…' : 'Download CSV'}</button>
        </div>
      )}
    >
      <div className="px-4 py-3 text-[14px] text-ink space-y-2">
        <p className="flex items-start gap-2">
          {s.state === 'agrees' ? <Check className="w-5 h-5 shrink-0 text-success-ink" aria-hidden="true" /> : s.state === 'differs' ? <TriangleAlert className="w-5 h-5 shrink-0 text-warning-ink" aria-hidden="true" /> : null}
          <span className={s.state === 'agrees' ? 'font-medium text-success-ink' : 'font-medium'}>{s.headline}</span>
        </p>
        {c?.totals && (
          <p className="text-[13px] text-muted">
            Zoho Books: debit {formatAmount(c.totals.zoho.debit)}, credit {formatAmount(c.totals.zoho.credit)}{c.totals.zoho.balanced ? ' (balanced)' : ' (NOT balanced)'}. Tally: debit {formatAmount(c.totals.tally.debit)}, credit {formatAmount(c.totals.tally.credit)}.
          </p>
        )}
        {(c?.mustBeZero || []).length > 0 && (
          <ul className="text-[13px] text-muted space-y-0.5">
            {c.mustBeZero.map(z => (
              <li key={z.account}>
                {z.ok ? <StatusChip tone="success">Zero</StatusChip> : <StatusChip tone="warning">Not zero</StatusChip>} <span className="text-ink">{z.account}</span>: {z.words} {z.ok ? '' : `Expected ${money(z.predicted)}.`}
              </li>
            ))}
          </ul>
        )}
        {(p.leftOut || []).map((l, k) => <p key={`l${k}`} className="text-[13px] font-medium">{l}</p>)}
        {(p.notModelled || []).map((l, k) => <p key={`n${k}`} className="text-[13px] text-muted">Not worked out: {l}</p>)}
      </div>
      {open && s.rows.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className={th}>Account or contact</th>
                <th scope="col" className={`${th} text-right`}>Tally closing</th>
                <th scope="col" className={`${th} text-right`}>Zoho Books expected</th>
                <th scope="col" className={`${th} text-right`}>Difference</th>
                <th scope="col" className={th}>Comes from</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.rows.slice(0, SHOWN).map((r, k) => (
                <tr key={`${r.part}-${r.name}-${k}`}>
                  <th scope="row" className={`${td} font-medium text-ink break-words`}>
                    <span className="block text-[12px] font-normal text-muted">{r.part}{r.rounding ? ' (rounding)' : ''}</span>{r.name}
                  </th>
                  <td className={num}>{money(r.tally)}</td>
                  <td className={num}>{money(r.zoho)}</td>
                  <td className={`${num} font-semibold`}>{money(r.difference)}</td>
                  <td className={`${td} text-[13px] text-muted`}>{r.from || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.rows.length > SHOWN && <p className="px-4 py-2.5 border-t border-line text-[13px] text-muted">Showing {count(SHOWN)} of {count(s.rows.length)}. The CSV has every one.</p>}
        </div>
      )}
    </Card>
  );
}
